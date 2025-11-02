import type { PortalPoseModuleInstance } from './portal-pose/portal_pose.js';
import { loadPortalPoseModule, type PortalPoseLoadOptions } from './PortalPoseLoader.js';
import type { ControllerState } from '../webrtc/controllerParser.js';
import { PoseSmoother, type PoseArray } from '../head/PoseSmoother.js';

interface PortalPose {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

interface CameraDragIncrements {
  incY: number;
  incYaw: number;
  incPitch: number;
  incX: number;
  incZ: number;
  mode: 'button' | 'aim';
}

interface PortalCameraDragBeginParams {
  controllerPose: PortalPose;
  cameraQuat: PortalPose['orientation'];
  baseUiYawRad: number;
  mode: number;
}

interface PortalCameraDragComputeParams {
  controllerPose: PortalPose;
  nowSeconds: number;
}

interface PortalCameraDragComputeResult {
  incY?: number;
  incYaw?: number;
  incPitch?: number;
  incX?: number;
  incZ?: number;
}

type PortalCameraDragDisplayDelta = PortalPose['position'] | null;

interface PortalCameraDragHandle {
  setDisplayDeltaCallback(cb: () => PortalCameraDragDisplayDelta): void;
  begin(params: PortalCameraDragBeginParams): void;
  compute(params: PortalCameraDragComputeParams): PortalCameraDragComputeResult | null | undefined;
  end(): void;
}

interface PortalControllerUpdate {
  finalPose: PortalPose;
  unblendedPose: PortalPose;
  aimWeight: number;
  headWeight: number;
  stretchAmount: number;
  cameraDrag?: CameraDragIncrements; // NEW: controller-driven camera-drag increments for this frame
}

interface HeadPoseInput {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

type ActiveHand = 'left' | 'right';
type DragMode = 'none' | 'button' | 'aim';

const SIZEOF_PORTAL_POSEF = 28;
const SIZEOF_PORTAL_POSE_INPUTS = 192;
const SIZEOF_PORTAL_POSE_RESULT = 228;

const OFF_INPUTS_RAW_LENS_POSE = 0;
const OFF_INPUTS_SCREEN_CENTER_OFFSET = 28;
const OFF_INPUTS_HEAD = 40;
const OFF_HEAD_VALID = 0;
const OFF_HEAD_POSE_PITCHED = 4;
const OFF_HEAD_POSE_UNPITCHED = 32;
const OFF_HEAD_LEFT_EYE_FOV = 60;
const OFF_INPUTS_DELTA = 116;
const OFF_DELTA_VALID = 0;
const OFF_DELTA_POSE = 4;
const OFF_INPUTS_FLAGS = 148;
const OFF_INPUTS_TRIGGER = 156;
const OFF_INPUTS_SQUEEZE = 160;
const OFF_INPUTS_NEUTRAL_ROLL = 164;
const OFF_INPUTS_NEUTRAL_PITCH = 168;
const OFF_INPUTS_NEUTRAL_YAW = 172;
const OFF_INPUTS_HAND_TO_HEAD = 176;
const OFF_INPUTS_ACTIVE_HAND = 180;
const OFF_INPUTS_TIME_NOW = 184;

const OFF_RESULT_FINAL_POSE = 0;
const OFF_RESULT_UNBLENDED_POSE = 28;
const OFF_RESULT_STRETCH_AMOUNT = 60;
const OFF_RESULT_HEAD_WEIGHT = 76;
const OFF_RESULT_AIM_WEIGHT = 80;

const FLOAT_SIZE = 4;

const DEFAULT_YAW_ROLL_AMPLIFY = 1.4;
const DEFAULT_ROLL_ZERO_OFFSET_DEG = 200.0;
const DEFAULT_ROLL_AMPLIFY_START_DEG = 20.0;

const CONTROLLER_NEUTRAL_ROLL_DEG = 60.0;
const CONTROLLER_NEUTRAL_PITCH_DEG = 0.0;
const CONTROLLER_NEUTRAL_YAW_DEG = -30.0;

const ANDROID_PLAYER_HAND_TO_HEAD_HEIGHT_METERS = 0.3;
const ANDROID_PLAYER_MAX_ARM_DISTANCE = 0.75;
const ANDROID_PLAYER_ARM_STRETCH_MIN_DIST = 0.325;
const ANDROID_PLAYER_ARM_STRETCH_LERP_RANGE = 0.35;
const ANDROID_PLAYER_ARM_SCALING = 3.0;
const FIXED_DISPLAY_TORSO_DISTANCE_PROPORTION = 0.5;
const FIXED_DISPLAY_ARM_LENGTH = 0.35;

const DEFAULT_HALF_FOV_RAD = Math.PI / 4;

const DISPLAY_LOCK_TIMEOUT_MS = 1500;

const AIM_ENTER_W = 0.999;

const enum PortalHandEnum {
  Right = 0,
  Left = 1,
}

interface ButtonState {
  trigger: boolean;
  squeeze: boolean;
  action1: boolean;
  action2: boolean;
  stickClick: boolean;
  menu: boolean;
}

const AIM_EXIT_W = 0.98;

export class PortalControllerRuntime {
  public static async create(options?: PortalPoseLoadOptions): Promise<PortalControllerRuntime> {
    const Module = await loadPortalPoseModule(options);
    return new PortalControllerRuntime(Module);
  }

  private readonly Module: PortalPoseModuleInstance;
  private readonly stateBasePtr: number;
  private readonly statePtr: number;
  private readonly inputsPtr: number;
  private readonly resultPtr: number;
  private readonly headPosePtr: number;
  private readonly ctrlPosePtr: number;
  private readonly vecPtr: number;

  private readonly F32: Float32Array;
  private readonly U8: Uint8Array;
  private readonly I32: Int32Array;
  private readonly F64: Float64Array;
  private dragHandle: PortalCameraDragHandle | null = null;

  private readonly poseSmoother: PoseSmoother;
  private lastSmoothedPose: PoseArray | null = null;
  private lastUnblendedPose: PortalPose | null = null;
  private lastPacketNs: number | null = null;
  private lastPacketMs: number | null = null;

  private activeHand: ActiveHand = 'right';
  private wandMode: number = 0;
  private dualModeOpposed = false;
  private ephemeralSwapActive = false;
  private activeDragMode: DragMode = 'none';
  private buttonDragRequested = false;
  private aimDragRequested = false;

  private flags = {
    aimModeEnabled: false,
    armStretchEnabled: false,
    squeezePressed: false,
  };

  private buttonState: ButtonState = {
    trigger: false,
    squeeze: false,
    action1: false,
    action2: false,
    stickClick: false,
    menu: false,
  };


  private neutralRollDeg = CONTROLLER_NEUTRAL_ROLL_DEG;
  private neutralPitchDeg = CONTROLLER_NEUTRAL_PITCH_DEG;
  private neutralYawDeg = CONTROLLER_NEUTRAL_YAW_DEG;

  private displayLockActive = false;
  private displayLockPending = false;
  private displayLockHeadPose: PortalPose | null = null;
  private displayLockCtrlPose: PortalPose | null = null;
  private displayLockAnchorM = FIXED_DISPLAY_ARM_LENGTH;

  private altHandOffsetValid = false;
  private readonly altHandOffset = { x: 0, y: 0, z: 0 };

  private deltaTargetValid = false;
  private readonly deltaTargetPose: PortalPose = {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };

  private constructor(Module: PortalPoseModuleInstance) {
    this.Module = Module;
    this.F32 = Module.HEAPF32;
    this.U8 = Module.HEAPU8;
    this.I32 = Module.HEAP32;
    this.F64 = Module.HEAPF64;

    const stateSize = Module._portal_wasm_state_size();
    const stateAlign = Module._portal_wasm_state_alignment();
    this.stateBasePtr = Module._malloc(stateSize + stateAlign);
    this.statePtr = (this.stateBasePtr + (stateAlign - 1)) & ~(stateAlign - 1);
    Module._portal_wasm_state_init(this.statePtr);

    this.inputsPtr = Module._malloc(SIZEOF_PORTAL_POSE_INPUTS);
    this.resultPtr = Module._malloc(SIZEOF_PORTAL_POSE_RESULT);
    this.headPosePtr = Module._malloc(SIZEOF_PORTAL_POSEF);
    this.ctrlPosePtr = Module._malloc(SIZEOF_PORTAL_POSEF);
    this.vecPtr = Module._malloc(3 * FLOAT_SIZE);

    this.poseSmoother = new PoseSmoother(90);

    // NEW: create PortalCameraDragHandle and wire display-delta callback
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const DragCtor = (this.Module as any).PortalCameraDragHandle;
      if (typeof DragCtor === 'function') {
        this.dragHandle = new DragCtor() as PortalCameraDragHandle;
        this.dragHandle.setDisplayDeltaCallback(() => {
          if (!this.lastUnblendedPose) {
            return null;
          }
          this.writePose(this.ctrlPosePtr, this.lastUnblendedPose);
          const ok = this.Module._portal_wasm_compute_display_delta(this.statePtr, this.ctrlPosePtr, this.vecPtr);
          if (!ok) {
            return null;
          }
          const base = this.vecPtr >>> 2;
          return {
            x: this.F32[base + 0],
            y: this.F32[base + 1],
            z: this.F32[base + 2],
          };
        });
      }
    } catch {
      // If unavailable (older wasm), we just won't have display-delta (raw fallback stays active).
      this.dragHandle = null;
    }

    this.applyStaticConfig();
  }

  destroy(): void {
    this.Module._free(this.stateBasePtr);
    this.Module._free(this.inputsPtr);
    this.Module._free(this.resultPtr);
    this.Module._free(this.headPosePtr);
    this.Module._free(this.ctrlPosePtr);
    this.Module._free(this.vecPtr);
  }

  ingestPacket(state: ControllerState): void {
    this.lastPacketNs = state.timestampNs;
    this.lastPacketMs = performance.now();

    this.setWandMode(state.wandMode);

    const tNs = state.timestampNs || Math.floor(performance.now() * 1e6);
    this.poseSmoother.addSample(
      state.position.x,
      state.position.y,
      state.position.z,
      state.quaternion.x,
      state.quaternion.y,
      state.quaternion.z,
      state.quaternion.w,
      tNs,
    );

    this.flags.aimModeEnabled = state.flags.aim;
    this.flags.armStretchEnabled = state.flags.stretch;

    this.buttonState = {
      trigger: state.buttons.trigger,
      squeeze: state.buttons.squeeze,
      action1: state.buttons.action1,
      action2: state.buttons.action2,
      stickClick: state.buttons.stick,
      menu: state.buttons.menu,
    };
    this.flags.squeezePressed = state.buttons.squeeze;

    // NEW: track virtual camera drag button request (held = requested)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.buttonDragRequested = !!(state.buttons as any).cameraDrag;
  }

  setWandMode(mode: number): void {
    this.wandMode = mode;
    switch (mode) {
      case 1: // Left persistent
        this.activeHand = 'left';
        this.ephemeralSwapActive = false;
        this.dualModeOpposed = false;
        break;
      case 2: // Right ephemeral
        this.activeHand = 'right';
        this.ephemeralSwapActive = true;
        this.dualModeOpposed = false;
        break;
      case 3: // Left ephemeral
        this.activeHand = 'left';
        this.ephemeralSwapActive = true;
        this.dualModeOpposed = false;
        break;
      case 4: // Dual mirrored
        this.activeHand = 'right';
        this.ephemeralSwapActive = false;
        this.dualModeOpposed = false;
        break;
      case 5: // Dual opposed
        this.activeHand = 'right';
        this.ephemeralSwapActive = false;
        this.dualModeOpposed = true;
        break;
      case 0: // Right persistent
      default:
        this.activeHand = 'right';
        this.ephemeralSwapActive = false;
        this.dualModeOpposed = false;
        break;
    }
  }

  updateFrame(nowNs: number, headPose: HeadPoseInput): PortalControllerUpdate | null {
    if (this.lastPacketNs == null) {
      return null;
    }

    const predicted =
      this.poseSmoother.predict(nowNs) ??
      (this.lastSmoothedPose ??
        [
          0, 0, 0,
          0, 0, 0, 1,
        ]);

    this.lastSmoothedPose = predicted;

    this.writeInputs(predicted, headPose, nowNs);
    this.applyDynamicConfig();

    this.Module._portal_wasm_update(this.inputsPtr, this.statePtr, this.resultPtr);

    const finalPose = this.readPose(this.resultPtr + OFF_RESULT_FINAL_POSE);
    const unblendedPose = this.readPose(this.resultPtr + OFF_RESULT_UNBLENDED_POSE);
    const stretchAmount = this.F32[(this.resultPtr + OFF_RESULT_STRETCH_AMOUNT) >> 2];
    const headWeight = this.F32[(this.resultPtr + OFF_RESULT_HEAD_WEIGHT) >> 2];
    const aimWeight = this.F32[(this.resultPtr + OFF_RESULT_AIM_WEIGHT) >> 2];

    // NEW: keep last unblended for display-delta callback
    this.lastUnblendedPose = unblendedPose;

    if (this.displayLockPending) {
      this.commitDisplayLock(headPose, unblendedPose);
    }

    // NEW: update/compute camera drag increments
    const cameraDrag = this.computeCameraDrag(nowNs, headPose, unblendedPose, aimWeight);

    return {
      finalPose,
      unblendedPose,
      stretchAmount,
      headWeight,
      aimWeight,
      cameraDrag,
    };
  }

  handleOrientationReset(): void {
    this.displayLockPending = true;
  }

  clearDisplayLock(): void {
    this.displayLockActive = false;
    this.displayLockPending = false;
    this.displayLockHeadPose = null;
    this.displayLockCtrlPose = null;
    this.Module._portal_wasm_set_display_lock_calibration(this.statePtr, 0, 0, 0);
  }

  handleDisconnect(): void {
    this.poseSmoother.reset();
    this.lastSmoothedPose = null;
    this.lastPacketNs = null;
    this.lastPacketMs = null;
    this.displayLockActive = false;
    this.displayLockPending = false;
    this.displayLockHeadPose = null;
    this.displayLockCtrlPose = null;

    // NEW: tear down active drag
    try { this.dragHandle?.end(); } catch {}
    this.activeDragMode = 'none';
    this.buttonDragRequested = false;
    this.aimDragRequested = false;
    this.lastUnblendedPose = null;
  }

  hasRecentPacket(nowMs: number): boolean {
    return this.lastPacketMs != null && nowMs - this.lastPacketMs <= DISPLAY_LOCK_TIMEOUT_MS;
  }

  getActiveHand(): ActiveHand {
    return this.activeHand;
  }

  getWandMode(): number {
    return this.wandMode;
  }

  private writeInputs(pose: PoseArray, headPose: HeadPoseInput, nowNs: number): void {
    const basePosePtr = this.inputsPtr + OFF_INPUTS_RAW_LENS_POSE;
    this.writePose(basePosePtr, {
      position: { x: pose[0], y: pose[1], z: pose[2] },
      orientation: { x: pose[3], y: pose[4], z: pose[5], w: pose[6] },
    });

    const screenCenterPtr = this.inputsPtr + OFF_INPUTS_SCREEN_CENTER_OFFSET;
    this.writeVec3(screenCenterPtr, { x: 0, y: 0, z: 0 });

    const headPtr = this.inputsPtr + OFF_INPUTS_HEAD;
    this.U8[headPtr + OFF_HEAD_VALID] = 1;
    const headPosePortal: PortalPose = {
      position: { ...headPose.position },
      orientation: { ...headPose.orientation },
    };
    this.writePose(headPtr + OFF_HEAD_POSE_PITCHED, headPosePortal);
    this.writePose(headPtr + OFF_HEAD_POSE_UNPITCHED, headPosePortal);

    const fovPtr = headPtr + OFF_HEAD_LEFT_EYE_FOV;
    this.F32[fovPtr >> 2] = -DEFAULT_HALF_FOV_RAD;
    this.F32[(fovPtr >> 2) + 1] = DEFAULT_HALF_FOV_RAD;
    this.F32[(fovPtr >> 2) + 2] = DEFAULT_HALF_FOV_RAD;
    this.F32[(fovPtr >> 2) + 3] = -DEFAULT_HALF_FOV_RAD;

    const deltaPtr = this.inputsPtr + OFF_INPUTS_DELTA;
    this.U8[deltaPtr + OFF_DELTA_VALID] = this.deltaTargetValid ? 1 : 0;
    if (this.deltaTargetValid) {
      this.writePose(deltaPtr + OFF_DELTA_POSE, this.deltaTargetPose);
    }

    const flagsPtr = this.inputsPtr + OFF_INPUTS_FLAGS;
    this.U8[flagsPtr + 0] = this.flags.aimModeEnabled ? 1 : 0;
    this.U8[flagsPtr + 1] = this.flags.armStretchEnabled ? 1 : 0;
    this.U8[flagsPtr + 2] = this.displayLockActive ? 1 : 0;
    this.U8[flagsPtr + 3] = this.displayLockPending ? 1 : 0;
    this.U8[flagsPtr + 4] = this.ephemeralSwapActive ? 1 : 0;
    this.U8[flagsPtr + 5] = this.dualModeOpposed ? 1 : 0;
    this.U8[flagsPtr + 6] = this.flags.squeezePressed ? 1 : 0;

    this.F32[(this.inputsPtr + OFF_INPUTS_TRIGGER) >> 2] = this.buttonState.trigger ? 1 : 0;
    this.F32[(this.inputsPtr + OFF_INPUTS_SQUEEZE) >> 2] = this.buttonState.squeeze ? 1 : 0;
    this.F32[(this.inputsPtr + OFF_INPUTS_NEUTRAL_ROLL) >> 2] = this.neutralRollDeg;
    this.F32[(this.inputsPtr + OFF_INPUTS_NEUTRAL_PITCH) >> 2] = this.neutralPitchDeg;
    this.F32[(this.inputsPtr + OFF_INPUTS_NEUTRAL_YAW) >> 2] = this.neutralYawDeg;
    this.F32[(this.inputsPtr + OFF_INPUTS_HAND_TO_HEAD) >> 2] = ANDROID_PLAYER_HAND_TO_HEAD_HEIGHT_METERS;
    this.I32[(this.inputsPtr + OFF_INPUTS_ACTIVE_HAND) >> 2] =
      this.activeHand === 'right' ? PortalHandEnum.Right : PortalHandEnum.Left;
    this.F64[(this.inputsPtr + OFF_INPUTS_TIME_NOW) >> 3] = nowNs * 1e-9;
  }

  private applyStaticConfig(): void {
    this.Module._portal_wasm_set_roll_config(
      this.statePtr,
      DEFAULT_YAW_ROLL_AMPLIFY,
      DEFAULT_ROLL_ZERO_OFFSET_DEG,
      DEFAULT_ROLL_AMPLIFY_START_DEG,
    );
    this.Module._portal_wasm_set_fov_defaults(
      this.statePtr,
      90,
      60,
      60,
    );
    this.Module._portal_wasm_set_arm_params(
      this.statePtr,
      ANDROID_PLAYER_MAX_ARM_DISTANCE,
      ANDROID_PLAYER_ARM_STRETCH_MIN_DIST,
      ANDROID_PLAYER_ARM_STRETCH_LERP_RANGE,
      ANDROID_PLAYER_ARM_SCALING,
      FIXED_DISPLAY_TORSO_DISTANCE_PROPORTION,
    );
  }

  private applyDynamicConfig(): void {
    if (this.altHandOffsetValid) {
      this.writeVec3(this.vecPtr, this.altHandOffset);
      this.Module._portal_wasm_set_alt_hand_offset(this.statePtr, 1, this.vecPtr);
    } else {
      this.Module._portal_wasm_set_alt_hand_offset(this.statePtr, 0, 0);
    }

    if (this.deltaTargetValid) {
      this.writePose(this.ctrlPosePtr, this.deltaTargetPose);
      this.Module._portal_wasm_set_delta_target(this.statePtr, 1, this.ctrlPosePtr);
    } else {
      this.Module._portal_wasm_set_delta_target(this.statePtr, 0, 0);
    }

    if (this.displayLockActive && this.displayLockHeadPose && this.displayLockCtrlPose) {
      this.writePose(this.headPosePtr, this.displayLockHeadPose);
      this.writePose(this.ctrlPosePtr, this.displayLockCtrlPose);
      this.Module._portal_wasm_set_display_lock_calibration(
        this.statePtr,
        this.headPosePtr,
        this.ctrlPosePtr,
        this.displayLockAnchorM,
      );
    } else if (!this.displayLockPending) {
      this.Module._portal_wasm_set_display_lock_calibration(this.statePtr, 0, 0, 0);
    }
  }

  private computeCameraDrag(nowNs: number, headPose: HeadPoseInput, unblendedPose: PortalPose, aimWeight: number): CameraDragIncrements | undefined {
    if (!this.dragHandle) {
      return undefined;
    }

    // Aim-drag request toggling mirrors Android: only when display-lock is active.
    if (this.displayLockActive) {
      if (!this.aimDragRequested && aimWeight >= AIM_ENTER_W) {
        this.aimDragRequested = true;
      } else if (this.aimDragRequested && aimWeight <= AIM_EXIT_W) {
        this.aimDragRequested = false;
      }
    } else {
      this.aimDragRequested = false;
    }

    let desired: DragMode = 'none';
    if (this.aimDragRequested) {
      desired = 'aim';
    } else if (this.buttonDragRequested) {
      desired = 'button';
    }

    if (desired !== this.activeDragMode) {
      // Switch modes.
      if (this.activeDragMode !== 'none') {
        try { this.dragHandle.end(); } catch {}
      }
      this.activeDragMode = desired;
      if (this.activeDragMode !== 'none') {
        try {
          this.dragHandle.begin({
            controllerPose: {
              position: { ...unblendedPose.position },
              orientation: { ...unblendedPose.orientation },
            },
            cameraQuat: { ...headPose.orientation },
            baseUiYawRad: 0.0,           // Web path: use 0 baseline; yaw continuity handled on apply
            mode: this.activeDragMode === 'aim' ? 1 : 0,
          });
        } catch {
          // If begin fails, disable drag this frame.
          this.activeDragMode = 'none';
        }
      }
    }

    if (this.activeDragMode === 'none') {
      return undefined;
    }

    try {
      const res = this.dragHandle.compute({
        controllerPose: {
          position: { ...unblendedPose.position },
          orientation: { ...unblendedPose.orientation },
        },
        nowSeconds: nowNs * 1e-9,
      });
      if (!res) {
        return undefined;
      }
      return {
        incY: res.incY ?? 0,
        incYaw: res.incYaw ?? 0,
        incPitch: res.incPitch ?? 0,
        incX: res.incX ?? 0,
        incZ: res.incZ ?? 0,
        mode: this.activeDragMode === 'aim' ? 'aim' : 'button',
      };
    } catch {
      return undefined;
    }
  }

  private commitDisplayLock(headPose: HeadPoseInput, ctrlPose: PortalPose): void {
    this.displayLockPending = false;
    this.displayLockActive = true;
    this.displayLockHeadPose = {
      position: { ...headPose.position },
      orientation: { ...headPose.orientation },
    };
    this.displayLockCtrlPose = {
      position: { ...ctrlPose.position },
      orientation: { ...ctrlPose.orientation },
    };
    this.writePose(this.headPosePtr, this.displayLockHeadPose);
    this.writePose(this.ctrlPosePtr, this.displayLockCtrlPose);
    this.Module._portal_wasm_set_display_lock_calibration(
      this.statePtr,
      this.headPosePtr,
      this.ctrlPosePtr,
      this.displayLockAnchorM,
    );
  }

  private writePose(ptr: number, pose: PortalPose): void {
    const base = ptr >> 2;
    this.F32[base + 0] = pose.orientation.x;
    this.F32[base + 1] = pose.orientation.y;
    this.F32[base + 2] = pose.orientation.z;
    this.F32[base + 3] = pose.orientation.w;
    this.F32[base + 4] = pose.position.x;
    this.F32[base + 5] = pose.position.y;
    this.F32[base + 6] = pose.position.z;
  }

  private readPose(ptr: number): PortalPose {
    const base = ptr >> 2;
    return {
      orientation: {
        x: this.F32[base + 0],
        y: this.F32[base + 1],
        z: this.F32[base + 2],
        w: this.F32[base + 3],
      },
      position: {
        x: this.F32[base + 4],
        y: this.F32[base + 5],
        z: this.F32[base + 6],
      },
    };
  }

  private writeVec3(ptr: number, vec: { x: number; y: number; z: number }): void {
    const base = ptr >> 2;
    this.F32[base + 0] = vec.x;
    this.F32[base + 1] = vec.y;
    this.F32[base + 2] = vec.z;
  }
}

export type { PortalPose, PortalControllerUpdate };
