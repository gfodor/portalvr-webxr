import type { XRDevice } from '../device/XRDevice.js';
import type { XRFrame } from '../frameloop/XRFrame.js';
import { CameraOffsetController, Y_OFFSET_MIN, Y_OFFSET_MAX } from './CameraOffsetController.js';
import { PoseSmoother, type PoseArray } from './PoseSmoother.js';
import type { PortalPoseModuleInstance } from '../wasm/portal-pose/portal_pose.js';
import {
  DEFAULT_CAMERA_PITCH_RAD,
  degreesToRadians,
  loadPortalPoseModule,
  type PortalPoseLoadOptions,
} from '../wasm/PortalPoseLoader.js';
import type { QuatLike, Vec3Like } from '../types/geometry.js';

const FLOAT_SIZE_BYTES = 4;
const QUAT_COMPONENTS = 4;
const VEC3_COMPONENTS = 3;
const QUAT_SIZE_BYTES = QUAT_COMPONENTS * FLOAT_SIZE_BYTES; // 16
const VEC3_SIZE_BYTES = VEC3_COMPONENTS * FLOAT_SIZE_BYTES; // 12
const POSE_SIZE_BYTES = QUAT_SIZE_BYTES + VEC3_SIZE_BYTES; // 28 (float-aligned)

interface PortalPoseCameraInternalOptions {
  cameraPitchRad: number;
  fixedDisplayLocked: boolean;
  debug: boolean;
}

export interface PortalPoseCameraOptions extends PortalPoseLoadOptions {
  /** Overrides the virtual camera pitch before offsets (degrees). Default: 45. */
  cameraPitchDegrees?: number;
  /** Treat the camera as fixed display-locked to avoid vertical coupling. Default: false. */
  fixedDisplayLocked?: boolean;
  /** Enables verbose diagnostics for camera nudges. Default: true in development builds. */
  debugLogging?: boolean;
}

class PortalPoseCameraNudger {
  private readonly module: PortalPoseModuleInstance;
  private readonly cameraPitchRad: number;
  private readonly cameraPitchSin: number;
  private readonly fixedDisplayLocked: number;
  private readonly basePosition: Vec3Like;
  private readonly baseOrientation: QuatLike;
  private readonly debugEnabled: boolean;
  private readonly smoothedPosPtr: number;
  private readonly smoothedQuatPtr: number;
  private readonly uiOffsetPtr: number;
  private readonly deltaPtr: number;
  private readonly posePtr: number;
  private readonly yawResultPtr: number;
  private readonly offsetController = new CameraOffsetController();
  private readonly poseSmoother: PoseSmoother;
  private latestSmoothedPose: Float32Array;
  private latestFinalPose: Float32Array;
  private lastPredictedMs: number | null = null;
  private lastNowMs: number | null = null;

  constructor(
    module: PortalPoseModuleInstance,
    device: XRDevice,
    options: PortalPoseCameraInternalOptions,
  ) {
    this.module = module;
    this.cameraPitchRad = options.cameraPitchRad;
    this.cameraPitchSin = Math.sin(this.cameraPitchRad);
    this.fixedDisplayLocked = options.fixedDisplayLocked ? 1 : 0;
    this.debugEnabled = options.debug;
    this.basePosition = {
      x: device.position.x,
      y: device.position.y,
      z: device.position.z,
    };
    this.baseOrientation = {
      x: device.quaternion.x,
      y: device.quaternion.y,
      z: device.quaternion.z,
      w: device.quaternion.w,
    };

    this.smoothedPosPtr = module._malloc(QUAT_SIZE_BYTES); // allocate >=12 bytes
    this.smoothedQuatPtr = module._malloc(QUAT_SIZE_BYTES);
    this.uiOffsetPtr = module._malloc(QUAT_SIZE_BYTES); // extra padding for alignment
    this.deltaPtr = module._malloc(QUAT_SIZE_BYTES);
    this.posePtr = module._malloc(POSE_SIZE_BYTES + FLOAT_SIZE_BYTES); // pad to 32 bytes
    this.yawResultPtr = module._malloc(FLOAT_SIZE_BYTES);

    this.poseSmoother = new PoseSmoother(90);

    const initNs = this.nowNs();
    this.offsetController.stepSmoothing(initNs);
    const initOffset = this.offsetController.copySmoothedOffset();
    const samplePos = {
      x: this.basePosition.x + initOffset.x,
      y: this.basePosition.y + initOffset.y,
      z: this.basePosition.z + initOffset.z,
    };
    this.poseSmoother.addSample(
      samplePos.x,
      samplePos.y,
      samplePos.z,
      this.baseOrientation.x,
      this.baseOrientation.y,
      this.baseOrientation.z,
      this.baseOrientation.w,
      initNs,
    );
    this.latestSmoothedPose = new Float32Array([
      samplePos.x,
      samplePos.y,
      samplePos.z,
      this.baseOrientation.x,
      this.baseOrientation.y,
      this.baseOrientation.z,
      this.baseOrientation.w,
    ]);
    this.latestFinalPose = new Float32Array(this.latestSmoothedPose);

  }

  public getYawOffsetRad(): number {
    return this.offsetController.getYawRad();
  }

  handleFrame(device: XRDevice, frame: XRFrame) {
    void this.computeDeltaSeconds(frame);
    const nowNs = this.nowNs();
    this.offsetController.stepSmoothing(nowNs);
    this.addPoseSample(nowNs);
    const predicted = this.poseSmoother.predict(nowNs);
    this.composeFinalPose(device, predicted);
  }

  // NEW: map per-frame camera-drag increments into existing yaw/pitch/offset nudges
  public applyCameraDragIncrements(inc: { incY: number; incYaw: number; incPitch: number; incX: number; incZ: number }): void {
    if (!inc) {
      return;
    }

    // 1) Vertical translation along screen-up
    if (Math.abs(inc.incY) > 1e-6) {
      this.applyTranslationDelta(0, inc.incY, 0);
    }

    // 2) Yaw (use RAW-baselined continuity path already implemented by applyYawDelta)
    if (Math.abs(inc.incYaw) > 1e-6) {
      this.applyYawDelta(inc.incYaw);
    }

    // 3) Pitch around camera-right
    if (Math.abs(inc.incPitch) > 1e-6) {
      this.offsetController.nudgePitchLocal(inc.incPitch);
    }

    // 4) Horizontal camera-local translation (X/Z)
    if (Math.abs(inc.incX) > 1e-6 || Math.abs(inc.incZ) > 1e-6) {
      this.applyTranslationDelta(inc.incX, 0, inc.incZ);
    }
  }

  public resetOrientation() {
    this.offsetController.resetAll();
    const sample: PoseArray = [
      this.basePosition.x,
      this.basePosition.y,
      this.basePosition.z,
      this.baseOrientation.x,
      this.baseOrientation.y,
      this.baseOrientation.z,
      this.baseOrientation.w,
    ] as PoseArray;
    const nowNs = this.nowNs();
    this.offsetController.stepSmoothing(nowNs);
    this.poseSmoother.reset(sample, nowNs);
    this.latestSmoothedPose = new Float32Array(sample);
    this.latestFinalPose = new Float32Array(sample);
  }

  public dispose() {
    this.module._free(this.smoothedPosPtr);
    this.module._free(this.smoothedQuatPtr);
    this.module._free(this.uiOffsetPtr);
    this.module._free(this.deltaPtr);
    this.module._free(this.posePtr);
    this.module._free(this.yawResultPtr);
  }

  private computeDeltaSeconds(frame: XRFrame): number {
    const predicted = frame.predictedDisplayTime;
    if (Number.isFinite(predicted)) {
      let dtMs = 0;
      if (this.lastPredictedMs != null) {
        dtMs = predicted - this.lastPredictedMs;
      }
      this.lastPredictedMs = predicted;
      return dtMs > 0 ? dtMs / 1000 : 0;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let dtMs = 0;
    if (this.lastNowMs != null) {
      dtMs = now - this.lastNowMs;
    }
    this.lastNowMs = now;
    return dtMs > 0 ? dtMs / 1000 : 0;
  }

  private applyTranslationDelta(dx: number, dy: number, dz: number) {
    const orientation = this.latestSmoothedPose ?? new Float32Array([
      this.basePosition.x,
      this.basePosition.y,
      this.basePosition.z,
      this.baseOrientation.x,
      this.baseOrientation.y,
      this.baseOrientation.z,
      this.baseOrientation.w,
    ]);
    this.writeQuat(this.smoothedQuatPtr, {
      x: orientation[3],
      y: orientation[4],
      z: orientation[5],
      w: orientation[6],
    });
    const ok = this.module._portal_wasm_head_offset_calculate_nudge_delta(
      dx,
      dy,
      dz,
      this.smoothedQuatPtr,
      this.offsetController.getYawRad(),
      this.offsetController.getSmoothedPitchRad(),
      this.cameraPitchRad,
      this.cameraPitchSin,
      this.fixedDisplayLocked,
      this.deltaPtr,
    );
    if (!ok) {
      this.debug('nudge-delta-failed', { dx, dy, dz });
      return;
    }
    const delta = this.readVec3(this.deltaPtr);
    const prevOffset = this.offsetController.copyOffset();
    this.offsetController.accumulateWorldDelta(delta);
    const newOffset = this.offsetController.copyOffset();
    const appliedShift = {
      x: newOffset.x - prevOffset.x,
      y: newOffset.y - prevOffset.y,
      z: newOffset.z - prevOffset.z,
    };
    const shiftMagnitude = Math.abs(appliedShift.x) + Math.abs(appliedShift.y) + Math.abs(appliedShift.z);
    if (shiftMagnitude > 1e-6) {
      this.poseSmoother.translateHistory(appliedShift.x, appliedShift.y, appliedShift.z);
      this.shiftCachedPoses(appliedShift);
    }
    this.debug('nudge-delta', {
      input: { dx, dy, dz },
      delta,
      appliedShift,
      targets: this.offsetController.copyOffset(),
    });
  }

  private applyYawDelta(dYawRad: number) {
    const smoothedPose = this.latestSmoothedPose;
    const finalPose = this.latestFinalPose;
    if (!smoothedPose || !finalPose) {
      return;
    }
    this.writeVec3(this.smoothedPosPtr, {
      x: smoothedPose[0],
      y: smoothedPose[1],
      z: smoothedPose[2],
    });
    this.writeQuat(this.smoothedQuatPtr, {
      x: smoothedPose[3],
      y: smoothedPose[4],
      z: smoothedPose[5],
      w: smoothedPose[6],
    });
    const currentOffset = this.offsetController.copySmoothedOffset();
    this.writeVec3(this.uiOffsetPtr, currentOffset);
    this.writeQuat(this.posePtr, {
      x: finalPose[3],
      y: finalPose[4],
      z: finalPose[5],
      w: finalPose[6],
    });
    this.writeVec3(this.posePtr + QUAT_SIZE_BYTES, {
      x: finalPose[0],
      y: finalPose[1],
      z: finalPose[2],
    });
    const currentFinalPosPtr = this.posePtr + QUAT_SIZE_BYTES;
    const ok = this.module._portal_wasm_head_calculate_yaw_nudge(
      this.offsetController.getYawRad(),
      this.uiOffsetPtr,
      dYawRad,
      this.smoothedPosPtr,
      currentFinalPosPtr,
      Y_OFFSET_MIN,
      Y_OFFSET_MAX,
      this.yawResultPtr,
      this.deltaPtr,
    );

    if (!ok) {
      this.debug('yaw-nudge-failed', { dYawRad });
      return;
    }

    const adjust = this.readVec3(this.deltaPtr);
    const newYaw = this.module.HEAPF32[this.yawResultPtr >>> 2];
    this.offsetController.applyYawAdjust(newYaw, adjust);
    this.debug('yaw-nudge', { dYawRad, newYaw, adjust });
  }

  private composeFinalPose(device: XRDevice, predicted: PoseArray | null) {
    const pose = predicted ?? this.latestSmoothedPose;
    if (!pose) {
      return;
    }
    const yawRad = this.offsetController.getYawRad();
    const pitchRad = this.offsetController.getSmoothedPitchRad();
    const smOffset = this.offsetController.copySmoothedOffset();

    this.writeVec3(this.smoothedPosPtr, { x: pose[0], y: pose[1], z: pose[2] });
    this.writeQuat(this.smoothedQuatPtr, {
      x: pose[3],
      y: pose[4],
      z: pose[5],
      w: pose[6],
    });
    this.writeVec3(this.uiOffsetPtr, smOffset);
    this.module._portal_wasm_head_compose_final_pose(
      this.smoothedPosPtr,
      this.smoothedQuatPtr,
      yawRad,
      pitchRad,
      this.uiOffsetPtr,
      this.posePtr,
    );

    const finalQuat = this.readQuat(this.posePtr);
    const finalPos = this.readVec3(this.posePtr + QUAT_SIZE_BYTES);
    device.quaternion.set(finalQuat.x, finalQuat.y, finalQuat.z, finalQuat.w);
    device.position.set(finalPos.x, finalPos.y, finalPos.z);

    this.latestSmoothedPose = new Float32Array([
      pose[0],
      pose[1],
      pose[2],
      pose[3],
      pose[4],
      pose[5],
      pose[6],
    ]);
    this.latestFinalPose = new Float32Array([
      finalPos.x,
      finalPos.y,
      finalPos.z,
      finalQuat.x,
      finalQuat.y,
      finalQuat.z,
      finalQuat.w,
    ]);

    this.debug('compose-final', {
      finalPos,
      finalQuat,
      uiOffset: smOffset,
      yawRad,
      pitchRad,
    });
  }

  private addPoseSample(nowNs: number) {
    const smOffset = this.offsetController.copySmoothedOffset();
    const samplePos = {
      x: this.basePosition.x + smOffset.x,
      y: this.basePosition.y + smOffset.y,
      z: this.basePosition.z + smOffset.z,
    };
    this.poseSmoother.addSample(
      samplePos.x,
      samplePos.y,
      samplePos.z,
      this.baseOrientation.x,
      this.baseOrientation.y,
      this.baseOrientation.z,
      this.baseOrientation.w,
      nowNs,
    );
  }

  private shiftCachedPoses(shift: Vec3Like) {
    const { x, y, z } = shift;
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6) {
      return;
    }
    if (this.latestSmoothedPose) {
      this.latestSmoothedPose[0] += x;
      this.latestSmoothedPose[1] += y;
      this.latestSmoothedPose[2] += z;
    }
    if (this.latestFinalPose) {
      this.latestFinalPose[0] += x;
      this.latestFinalPose[1] += y;
      this.latestFinalPose[2] += z;
    }
  }

  private writeVec3(ptr: number, value: Vec3Like) {
    const heap = this.module.HEAPF32;
    const baseIndex = ptr >>> 2;
    heap[baseIndex] = value.x;
    heap[baseIndex + 1] = value.y;
    heap[baseIndex + 2] = value.z;
  }

  private writeQuat(ptr: number, value: QuatLike) {
    const heap = this.module.HEAPF32;
    const baseIndex = ptr >>> 2;
    heap[baseIndex] = value.x;
    heap[baseIndex + 1] = value.y;
    heap[baseIndex + 2] = value.z;
    heap[baseIndex + 3] = value.w;
  }

  private readVec3(ptr: number): Vec3Like {
    const heap = this.module.HEAPF32;
    const baseIndex = ptr >>> 2;
    return {
      x: heap[baseIndex],
      y: heap[baseIndex + 1],
      z: heap[baseIndex + 2],
    };
  }

  private readQuat(ptr: number): QuatLike {
    const heap = this.module.HEAPF32;
    const baseIndex = ptr >>> 2;
    return {
      x: heap[baseIndex],
      y: heap[baseIndex + 1],
      z: heap[baseIndex + 2],
      w: heap[baseIndex + 3],
    };
  }

  private nowNs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now() * 1e6;
    }
    return Date.now() * 1e6;
  }

  private debug(tag: string, payload: unknown) {
    if (!this.debugEnabled) {
      return;
    }
    void tag;
    void payload;
  }
}

export class PortalPoseCameraController {
  private controller: PortalPoseCameraNudger | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private pendingOrientationReset = false;
  private readonly options: PortalPoseCameraOptions;

  constructor(private readonly device: XRDevice, options: PortalPoseCameraOptions = {}) {
    this.options = { ...options };
  }

  public getYawOffsetRad(): number {
    if (this.disposed) {
      return 0;
    }
    return this.controller?.getYawOffsetRad() ?? 0;
  }

  /**
   * Apply controller-driven camera drag increments (forwarded from PortalControllerRuntime).
   */
  public applyCameraDragIncrements(inc: { incY: number; incYaw: number; incPitch: number; incX: number; incZ: number }): void {
    if (this.disposed) {
      return;
    }
    this.controller?.applyCameraDragIncrements(inc);
  }

  /**
   * Advance the portal pose camera simulation for the current frame.
   * Lazy-loads the WASM module on first use.
   */
  update(frame: XRFrame) {
    if (this.disposed) {
      return;
    }
    if (!this.controller) {
      this.ensureInitialized();
      return;
    }
    this.controller.handleFrame(this.device, frame);
  }

  handleOrientationReset() {
    if (this.disposed) {
      return;
    }
    if (this.controller) {
      this.pendingOrientationReset = false;
      this.controller.resetOrientation();
      return;
    }
    this.pendingOrientationReset = true;
    this.ensureInitialized();
  }

  /** Dispose controller resources and detach listeners. */
  dispose() {
    this.disposed = true;
    this.pendingOrientationReset = false;
    this.controller?.dispose();
    this.controller = null;
    this.initPromise = null;
  }

  private ensureInitialized() {
    if (this.controller || this.initPromise || this.disposed) {
      return;
    }
    this.initPromise = this.initialize().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[PortalPoseCamera] failed to initialize controller', error);
      this.initPromise = null;
    });
  }

  private async initialize() {
    const { cameraPitchDegrees, fixedDisplayLocked, debugLogging, ...loadOptions } = this.options;

    const module = await loadPortalPoseModule(loadOptions);
    const debugEnabled =
      debugLogging ??
      (typeof process !== 'undefined' && typeof process.env !== 'undefined'
        ? process.env.NODE_ENV !== 'production'
        : true);

    if (debugEnabled) {
      // eslint-disable-next-line no-console
      console.debug('[PortalPoseCamera] module exports', Object.keys(module));
    }

    if (this.disposed) {
      this.initPromise = null;
      return;
    }

    const internalOptions: PortalPoseCameraInternalOptions = {
      cameraPitchRad:
        cameraPitchDegrees != null ? degreesToRadians(cameraPitchDegrees) : DEFAULT_CAMERA_PITCH_RAD,
      fixedDisplayLocked: fixedDisplayLocked ?? true,
      debug: debugEnabled,
    };

    this.controller = new PortalPoseCameraNudger(module, this.device, internalOptions);
    if (this.pendingOrientationReset && this.controller) {
      this.controller.resetOrientation();
      this.pendingOrientationReset = false;
    }
    this.initPromise = null;
  }
}
