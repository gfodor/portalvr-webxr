import type { XRDevice } from '../device/XRDevice.js';
import type { XRFrame } from '../frameloop/XRFrame.js';
import { CameraOffsetController } from './CameraOffsetController.js';
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

const KEY_FORWARD = 'KeyW';
const KEY_BACK = 'KeyS';
const KEY_LEFT = 'KeyA';
const KEY_RIGHT = 'KeyD';
const KEY_UP = 'KeyQ';
const KEY_DOWN = 'KeyE';
const KEY_YAW_LEFT = 'KeyZ';
const KEY_YAW_RIGHT = 'KeyC';
const KEY_PITCH_UP = 'KeyF';
const KEY_PITCH_DOWN = 'KeyV';

const DEFAULT_SPEED_MPS = 1.25;
const YAW_SPEED_RAD_S = degreesToRadians(60);
const PITCH_SPEED_RAD_S = degreesToRadians(30);
const Y_OFFSET_MIN = -1.5;
const Y_OFFSET_MAX = 1.5;

interface PortalPoseCameraInternalOptions {
  speed: number;
  cameraPitchRad: number;
  fixedDisplayLocked: boolean;
  debug: boolean;
}

export interface PortalPoseCameraOptions extends PortalPoseLoadOptions {
  /** Movement speed applied while a key is held, in metres per second. Default: 1.25. */
  speedMetersPerSecond?: number;
  /** Overrides the virtual camera pitch before offsets (degrees). Default: 45. */
  cameraPitchDegrees?: number;
  /** Treat the camera as fixed display-locked to avoid vertical coupling. Default: false. */
  fixedDisplayLocked?: boolean;
  /** Enables verbose diagnostics for camera nudges. Default: true in development builds. */
  debugLogging?: boolean;
}

class PortalPoseCameraNudger {
  private readonly module: PortalPoseModuleInstance;
  private readonly speed: number;
  private readonly cameraPitchRad: number;
  private readonly cameraPitchSin: number;
  private readonly fixedDisplayLocked: number;
  private readonly basePosition: Vec3Like;
  private readonly baseOrientation: QuatLike;
  private readonly debugEnabled: boolean;
  private readonly keyState: Record<string, boolean> = Object.create(null);
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

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.isMovementKey(event.code)) {
      return;
    }
    if (event.target instanceof HTMLElement) {
      const tag = event.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target.isContentEditable) {
        return;
      }
    }
    this.keyState[event.code] = true;
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    if (!this.isMovementKey(event.code)) {
      return;
    }
    this.keyState[event.code] = false;
  };

  constructor(
    module: PortalPoseModuleInstance,
    device: XRDevice,
    options: PortalPoseCameraInternalOptions,
  ) {
    this.module = module;
    this.speed = options.speed;
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

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  handleFrame(device: XRDevice, frame: XRFrame) {
    const dt = this.computeDeltaSeconds(frame);
    if (dt > 0) {
      const move = this.computeKeyboardDelta(dt);
      if (move.dx !== 0 || move.dy !== 0 || move.dz !== 0) {
        this.applyKeyboardDelta(move.dx, move.dy, move.dz);
      }
      const dYaw = this.computeYawDelta(dt);
      if (dYaw !== 0) {
        this.applyYawDelta(dYaw);
      }
      const dPitch = this.computePitchDelta(dt);
      if (dPitch !== 0) {
        this.offsetController.nudgePitchLocal(dPitch);
      }
    }
    const nowNs = this.nowNs();
    this.offsetController.stepSmoothing(nowNs);
    this.addPoseSample(nowNs);
    const predicted = this.poseSmoother.predict(nowNs);
    this.composeFinalPose(device, predicted);
  }

  public dispose() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.module._free(this.smoothedPosPtr);
    this.module._free(this.smoothedQuatPtr);
    this.module._free(this.uiOffsetPtr);
    this.module._free(this.deltaPtr);
    this.module._free(this.posePtr);
    this.module._free(this.yawResultPtr);
  }

  private isMovementKey(code: string): boolean {
    switch (code) {
      case KEY_FORWARD:
      case KEY_BACK:
      case KEY_LEFT:
      case KEY_RIGHT:
      case KEY_UP:
      case KEY_DOWN:
      case KEY_YAW_LEFT:
      case KEY_YAW_RIGHT:
      case KEY_PITCH_UP:
      case KEY_PITCH_DOWN:
        return true;
      default:
        return false;
    }
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

  private computeKeyboardDelta(dt: number): { dx: number; dy: number; dz: number } {
    const forward = this.keyState[KEY_FORWARD] ? 1 : 0;
    const backward = this.keyState[KEY_BACK] ? 1 : 0;
    const left = this.keyState[KEY_LEFT] ? 1 : 0;
    const right = this.keyState[KEY_RIGHT] ? 1 : 0;
    const up = this.keyState[KEY_UP] ? 1 : 0;
    const down = this.keyState[KEY_DOWN] ? 1 : 0;

    const axisZ = backward - forward;
    const axisX = left - right;
    const axisY = up - down;

    if (axisX === 0 && axisY === 0 && axisZ === 0) {
      return { dx: 0, dy: 0, dz: 0 };
    }

    const length = Math.hypot(axisX, axisY, axisZ) || 1;
    const scale = (this.speed * dt) / length;
    return { dx: axisX * scale, dy: axisY * scale, dz: axisZ * scale };
  }

  private applyKeyboardDelta(dx: number, dy: number, dz: number) {
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
    this.offsetController.accumulateWorldDelta(delta);
    this.debug('nudge-delta', { input: { dx, dy, dz }, delta, targets: this.offsetController.copyOffset() });
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

  private computeYawDelta(dt: number): number {
    const left = this.keyState[KEY_YAW_LEFT] ? 1 : 0;
    const right = this.keyState[KEY_YAW_RIGHT] ? 1 : 0;
    const axis = left - right;
    if (axis === 0) {
      return 0;
    }
    return axis * YAW_SPEED_RAD_S * dt;
  }

  private computePitchDelta(dt: number): number {
    const up = this.keyState[KEY_PITCH_UP] ? 1 : 0;
    const down = this.keyState[KEY_PITCH_DOWN] ? 1 : 0;
    const axis = up - down;
    if (axis === 0) {
      return 0;
    }
    return axis * PITCH_SPEED_RAD_S * dt;
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
    // eslint-disable-next-line no-console
    console.debug(`[PortalPoseCamera] ${tag}`, payload);
  }
}

export class PortalPoseCameraController {
  private controller: PortalPoseCameraNudger | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private readonly options: PortalPoseCameraOptions;

  constructor(private readonly device: XRDevice, options: PortalPoseCameraOptions = {}) {
    this.options = { ...options };
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

  /** Dispose controller resources and detach listeners. */
  dispose() {
    this.disposed = true;
    this.controller?.dispose();
    this.controller = null;
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
    const {
      speedMetersPerSecond,
      cameraPitchDegrees,
      fixedDisplayLocked,
      debugLogging,
      ...loadOptions
    } = this.options;

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
      return;
    }

    const internalOptions: PortalPoseCameraInternalOptions = {
      speed: speedMetersPerSecond ?? DEFAULT_SPEED_MPS,
      cameraPitchRad:
        cameraPitchDegrees != null ? degreesToRadians(cameraPitchDegrees) : DEFAULT_CAMERA_PITCH_RAD,
      fixedDisplayLocked: fixedDisplayLocked ?? true,
      debug: debugEnabled,
    };

    this.controller = new PortalPoseCameraNudger(module, this.device, internalOptions);
  }
}
