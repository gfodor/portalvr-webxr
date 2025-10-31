import type { XRDevice, XRDeviceHooks } from '../device/XRDevice.js';
import type { XRFrame } from '../frameloop/XRFrame.js';
import type { PortalPoseModuleInstance } from '../wasm/portal-pose/portal_pose.js';
import {
  DEFAULT_CAMERA_PITCH_RAD,
  degreesToRadians,
  loadPortalPoseModule,
  type PortalPoseLoadOptions,
} from '../wasm/PortalPoseLoader.js';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface QuatLike extends Vec3Like {
  w: number;
}

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
const PITCH_LIMIT_RAD = degreesToRadians(45);
const Y_OFFSET_MIN = -1.5;
const Y_OFFSET_MAX = 1.5;

interface PortalPoseCameraInternalOptions {
  speed: number;
  cameraPitchRad: number;
  fixedDisplayLocked: boolean;
  debug: boolean;
}

export interface PortalPoseCameraHookOptions extends PortalPoseLoadOptions {
  /** Movement speed applied while a key is held, in metres per second. Default: 1.25. */
  speedMetersPerSecond?: number;
  /** Overrides the virtual camera pitch before offsets (degrees). Default: 45. */
  cameraPitchDegrees?: number;
  /** Treat the camera as fixed display-locked to avoid vertical coupling. Default: false. */
  fixedDisplayLocked?: boolean;
  /** Optional delegate hooks that run after the WASM nudge logic. */
  delegateHooks?: Partial<XRDeviceHooks>;
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
  private headPosition: Vec3Like;
  private readonly keyState: Record<string, boolean> = Object.create(null);
  private readonly smoothedPosPtr: number;
  private readonly smoothedQuatPtr: number;
  private readonly uiOffsetPtr: number;
  private readonly deltaPtr: number;
  private readonly posePtr: number;
  private readonly yawResultPtr: number;
  private yawOffsetRad = 0;
  private pitchOffsetRad = 0;
  private uiOffset: Vec3Like = { x: 0, y: 0, z: 0 };
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
    this.headPosition = { ...this.basePosition };

    this.smoothedPosPtr = module._malloc(QUAT_SIZE_BYTES); // allocate >=12 bytes
    this.smoothedQuatPtr = module._malloc(QUAT_SIZE_BYTES);
    this.uiOffsetPtr = module._malloc(QUAT_SIZE_BYTES); // extra padding for alignment
    this.deltaPtr = module._malloc(QUAT_SIZE_BYTES);
    this.posePtr = module._malloc(POSE_SIZE_BYTES + FLOAT_SIZE_BYTES); // pad to 32 bytes
    this.yawResultPtr = module._malloc(FLOAT_SIZE_BYTES);

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
        this.applyPitchDelta(dPitch);
      }
    }
    this.composeFinalPose(device);
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

    const axisZ = backward - forward; // +Z moves backwards (camera forward is -Z)
    const axisX = right - left;
    const axisY = up - down;

    if (axisX === 0 && axisY === 0 && axisZ === 0) {
      return { dx: 0, dy: 0, dz: 0 };
    }

    const length = Math.hypot(axisX, axisY, axisZ) || 1;
    const scale = (this.speed * dt) / length;
    return { dx: axisX * scale, dy: axisY * scale, dz: axisZ * scale };
  }

  private applyKeyboardDelta(dx: number, dy: number, dz: number) {
    this.writeQuat(this.smoothedQuatPtr, this.baseOrientation);
    const ok = this.module._portal_wasm_head_offset_calculate_nudge_delta(
      dx,
      dy,
      dz,
      this.smoothedQuatPtr,
      this.yawOffsetRad,
      this.pitchOffsetRad,
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
    const nextYOffset = this.clampYOffset(this.uiOffset.y - delta.y);
    this.uiOffset = {
      x: this.uiOffset.x - delta.x,
      y: nextYOffset,
      z: this.uiOffset.z - delta.z,
    };
    this.updateHeadPositionFromOffset();
    this.debug('nudge-delta', { input: { dx, dy, dz }, delta, uiOffset: this.uiOffset });
  }

  private applyYawDelta(dYawRad: number) {
    this.writeVec3(this.smoothedPosPtr, this.headPosition);
    this.writeQuat(this.smoothedQuatPtr, this.baseOrientation);
    this.writeVec3(this.uiOffsetPtr, this.uiOffset);

    this.module._portal_wasm_head_compose_final_pose(
      this.smoothedPosPtr,
      this.smoothedQuatPtr,
      this.yawOffsetRad,
      this.pitchOffsetRad,
      this.uiOffsetPtr,
      this.posePtr,
    );

    const currentFinalPosPtr = this.posePtr + QUAT_SIZE_BYTES;
    const ok = this.module._portal_wasm_head_calculate_yaw_nudge(
      this.yawOffsetRad,
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
    const nextYOffset = this.clampYOffset(this.uiOffset.y - adjust.y);

    this.yawOffsetRad = newYaw;
    this.uiOffset = {
      x: this.uiOffset.x - adjust.x,
      y: nextYOffset,
      z: this.uiOffset.z - adjust.z,
    };
    this.updateHeadPositionFromOffset();
    this.debug('yaw-nudge', {
      dYawRad,
      newYaw,
      adjust,
      uiOffset: this.uiOffset,
    });
  }

  private applyPitchDelta(dPitchRad: number) {
    const unclamped = this.pitchOffsetRad + dPitchRad;
    const clamped = Math.min(Math.max(unclamped, -PITCH_LIMIT_RAD), PITCH_LIMIT_RAD);
    if (clamped === this.pitchOffsetRad) {
      if (dPitchRad !== 0) {
        this.debug('pitch-nudge-clamped', { dPitchRad, pitchOffsetRad: this.pitchOffsetRad });
      }
      return;
    }
    this.pitchOffsetRad = clamped;
    this.debug('pitch-nudge', { dPitchRad, pitchOffsetRad: this.pitchOffsetRad });
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

  private updateHeadPositionFromOffset() {
    this.headPosition = {
      x: this.basePosition.x - this.uiOffset.x,
      y: this.basePosition.y - this.uiOffset.y,
      z: this.basePosition.z - this.uiOffset.z,
    };
  }

  private clampYOffset(value: number): number {
    return Math.min(Math.max(value, Y_OFFSET_MIN), Y_OFFSET_MAX);
  }

  private composeFinalPose(device: XRDevice) {
    this.writeVec3(this.smoothedPosPtr, this.headPosition);
    this.writeQuat(this.smoothedQuatPtr, this.baseOrientation);
    this.writeVec3(this.uiOffsetPtr, this.uiOffset);

    this.module._portal_wasm_head_compose_final_pose(
      this.smoothedPosPtr,
      this.smoothedQuatPtr,
      this.yawOffsetRad,
      this.pitchOffsetRad,
      this.uiOffsetPtr,
      this.posePtr,
    );

    const finalQuat = this.readQuat(this.posePtr);
    const finalPos = this.readVec3(this.posePtr + QUAT_SIZE_BYTES);
    device.quaternion.set(finalQuat.x, finalQuat.y, finalQuat.z, finalQuat.w);
    device.position.set(finalPos.x, finalPos.y, finalPos.z);
    this.debug('compose-final', {
      finalPos,
      finalQuat,
      uiOffset: this.uiOffset,
      headPosition: this.headPosition,
    });
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

  private debug(tag: string, payload: unknown) {
    if (!this.debugEnabled) {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug(`[PortalPoseCamera] ${tag}`, payload);
  }
}

const controllerRegistry = new WeakMap<XRDevice, PortalPoseCameraNudger>();

export async function installPortalPoseCameraHooks(
  device: XRDevice,
  options: PortalPoseCameraHookOptions = {},
): Promise<void> {
  if (controllerRegistry.has(device)) {
    return;
  }

  const isDevEnv =
    typeof process !== 'undefined' && typeof process.env !== 'undefined'
      ? process.env.NODE_ENV !== 'production'
      : true;
  const debugEnabled = options.debugLogging ?? isDevEnv;
  const module = await loadPortalPoseModule(options);
  if (debugEnabled) {
    // eslint-disable-next-line no-console
    console.debug('[PortalPoseCamera] module exports', Object.keys(module));
  }
  const internalOptions: PortalPoseCameraInternalOptions = {
    speed: options.speedMetersPerSecond ?? DEFAULT_SPEED_MPS,
    cameraPitchRad: options.cameraPitchDegrees
      ? degreesToRadians(options.cameraPitchDegrees)
      : DEFAULT_CAMERA_PITCH_RAD,
    fixedDisplayLocked: options.fixedDisplayLocked ?? false,
    debug: debugEnabled,
  };

  const controller = new PortalPoseCameraNudger(module, device, internalOptions);
  controllerRegistry.set(device, controller);

  const delegate = options.delegateHooks;

  device.installHooks({
    onHeadPose(dev, frame) {
      controller.handleFrame(dev, frame);
      delegate?.onHeadPose?.(dev, frame);
    },
    onControllerPose(input, frame) {
      delegate?.onControllerPose?.(input, frame);
    },
    onControllerButtons(input, frame) {
      delegate?.onControllerButtons?.(input, frame);
    },
  });
}

export function uninstallPortalPoseCameraHooks(device: XRDevice) {
  const controller = controllerRegistry.get(device);
  if (!controller) {
    return;
  }
  controllerRegistry.delete(device);
  controller.dispose();
}
