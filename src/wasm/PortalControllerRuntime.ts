import type { PortalPoseModuleInstance } from './portal-pose/portal_pose.js';
import { loadPortalPoseModule, type PortalPoseLoadOptions } from './PortalPoseLoader.js';
import type { ControllerState } from '../webrtc/controllerParser.js';
import { PoseSmoother, PoseSmootherMode, type PoseArray } from '../head/PoseSmoother.js';
import { quat, vec3 } from 'gl-matrix';

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

interface PortalControllerPerHandUpdate {
  finalPose: PortalPose | null;
  unblendedPose: PortalPose | null;
}

interface PortalControllerUpdate {
  byHand: {
    left: PortalControllerPerHandUpdate;
    right: PortalControllerPerHandUpdate;
  };
  aimWeight: number;
  headWeight: number;
  stretchAmount: number;
  cameraDrag?: CameraDragIncrements;
  cameraFovDeg: number;
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

const FLOAT_SIZE = 4;

// Session sample structs (C: portal_pose_session_sample_in/out)
const SIZEOF_PORTAL_POSE_SESSION_SAMPLE_IN = 200;
const OFF_SAMPLE_IN_HAND = 0;
const OFF_SAMPLE_IN_INPUTS = 8;

const SIZEOF_PORTAL_POSE_SESSION_SAMPLE_OUT = 256;
const OFF_SAMPLE_OUT_RESULT = 0;
const OFF_SAMPLE_OUT_CAMERA_FOV_DEG =
  OFF_SAMPLE_OUT_RESULT + SIZEOF_PORTAL_POSE_RESULT;
const OFF_SAMPLE_OUT_STRETCH_AMOUNT = OFF_SAMPLE_OUT_CAMERA_FOV_DEG + FLOAT_SIZE;
const OFF_SAMPLE_OUT_STRETCH_ORIGIN_WORLD = OFF_SAMPLE_OUT_STRETCH_AMOUNT + FLOAT_SIZE;
const OFF_SAMPLE_OUT_HEAD_MODE_WEIGHT =
  OFF_SAMPLE_OUT_STRETCH_ORIGIN_WORLD + 3 * FLOAT_SIZE;
const OFF_SAMPLE_OUT_AIM_MODE_WEIGHT = OFF_SAMPLE_OUT_HEAD_MODE_WEIGHT + FLOAT_SIZE;

// Session-level config structs
const SIZEOF_PORTAL_POSE_SESSION_TUNING = 8 * FLOAT_SIZE; // 8 floats
const SIZEOF_PORTAL_ROLL_CONFIG = 3 * FLOAT_SIZE; // 3 floats

const SIZEOF_PORTAL_ALT_HAND_CONFIG = 16; // vec3f + 3 bools (+pad)
const OFF_ALT_HAND_CFG_OFFSET_WORLD = 0; // struct portal_vec3f (3 * float)
const OFF_ALT_HAND_CFG_OFFSET_VALID = 12; // bool
const OFF_ALT_HAND_CFG_DISPLAY_LOCK_ACTIVE = 13; // bool
const OFF_ALT_HAND_CFG_DUAL_TRACKED_ENABLED = 14; // bool

const SIZEOF_PORTAL_AIM_HAND_CONFIG = 12; // bool + enum + bool (+pad)
const OFF_AIM_HAND_CFG_EXPLICIT_SOURCE_VALID = 0; // bool
const OFF_AIM_HAND_CFG_EXPLICIT_SOURCE = 4; // enum portal_hand (int)
const OFF_AIM_HAND_CFG_DUAL_TRACKED_ENABLED = 8; // bool

// display-lock calibration: posef + posef[2] + bool[2] + (2 pad) + enum + 2 floats
const SIZEOF_PORTAL_DISPLAY_LOCK_CALIBRATION = 100;
const OFF_DISPLAY_LOCK_CAL_HEAD_POSE = 0;
const OFF_DISPLAY_LOCK_CAL_CTRL_POSE_RIGHT =
  OFF_DISPLAY_LOCK_CAL_HEAD_POSE + SIZEOF_PORTAL_POSEF; // 28
const OFF_DISPLAY_LOCK_CAL_CTRL_POSE_LEFT =
  OFF_DISPLAY_LOCK_CAL_CTRL_POSE_RIGHT + SIZEOF_PORTAL_POSEF; // 56
const OFF_DISPLAY_LOCK_CAL_CTRL_VALID =
  OFF_DISPLAY_LOCK_CAL_CTRL_POSE_LEFT + SIZEOF_PORTAL_POSEF; // 84, bool[2]
// 2 bytes padding at offset 86-87 for enum alignment
const OFF_DISPLAY_LOCK_CAL_CALIBRATING_HAND = 88; // enum portal_hand (4-byte aligned)
const OFF_DISPLAY_LOCK_CAL_ANCHOR_M = 92; // float
const OFF_DISPLAY_LOCK_CAL_HAND_TO_HEAD_HEIGHT_M = 96; // float

// Existing portal_pose_inputs / portal_pose_result offsets
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

type HandId = 'left' | 'right';

interface HandRuntimeState {
  smoother: PoseSmoother;
  lastSmoothedPose: PoseArray | null;
  buttonState: ButtonState;
  lastUnblendedPose: PortalPose | null;
}

const HAND_IDS: HandId[] = ['right', 'left'];

const GLOBAL_HAND_STATES: Record<HandId, HandRuntimeState> = {
  right: {
    // Disable outlier rejection for controllers - fast arm movements can exceed thresholds
    smoother: new PoseSmoother(90, 0, false),
    lastSmoothedPose: null,
    buttonState: {
      trigger: false,
      squeeze: false,
      action1: false,
      action2: false,
      stickClick: false,
      menu: false,
    },
    lastUnblendedPose: null,
  },
  left: {
    // Disable outlier rejection for controllers - fast arm movements can exceed thresholds
    smoother: new PoseSmoother(90, 0, false),
    lastSmoothedPose: null,
    buttonState: {
      trigger: false,
      squeeze: false,
      action1: false,
      action2: false,
      stickClick: false,
      menu: false,
    },
    lastUnblendedPose: null,
  },
};

GLOBAL_HAND_STATES.right.smoother.setMode(PoseSmootherMode.LOW);
GLOBAL_HAND_STATES.left.smoother.setMode(PoseSmootherMode.LOW);

const AIM_EXIT_W = 0.98;

const INTERACTION_MODE_BASE = 0x0;
const INTERACTION_MODE_DUAL_AXIS_GAMEPAD = 0x1;
const INTERACTION_MODE_DUALSHOCK_GAMEPAD = 0x2;
const INTERACTION_MODE_OPENXR_QUEST = 0x10;

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
  private readonly outPosePtr: number;
  private readonly vecPtr: number;

  private readonly F32: Float32Array;
  private readonly U8: Uint8Array;
  private readonly I32: Int32Array;
  private readonly F64: Float64Array;
  private dragHandle: PortalCameraDragHandle | null = null;
  private dragButtonSetter: ((active: boolean) => void) | null = null;
  private dragButtonActive = false;

  private readonly poseSmoother: PoseSmoother;
  private lastSmoothedPose: PoseArray | null = null;
  private lastUnblendedPose: PortalPose | null = null;
  private lastPacketNs: number | null = null;
  private lastPacketMs: number | null = null;
  private dualTrackedRequested = false;

  private activeHand: ActiveHand = 'right';
  private wandMode: number = 0;
  private dualModeOpposed = false;
  private ephemeralSwapActive = false;
  private activeDragMode: DragMode = 'none';
  private buttonDragRequested = false;
  private aimDragRequested = false;
  private externalUiYawRad: number = 0;

  // NEW: track current interaction mode
  private interactionMode: number = INTERACTION_MODE_BASE;

  private flags = {
    aimModeEnabled: false,
    armStretchEnabled: false,
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

  private explicitAimHand: HandId | null = null;
  private currentPoseModeBlend = { headWeight: 1, aimWeight: 0 };

  private dragSource: HandId | null = null;
  private lastButtonDragRight = false;
  private lastButtonDragLeft = false;

  private displayLockCalibrationHand: HandId = 'right';

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

    if (typeof Module._portal_wasm_controller_set_drag_button_active === 'function') {
      this.dragButtonSetter = (active: boolean): void => {
        Module._portal_wasm_controller_set_drag_button_active(active ? 1 : 0);
      };
    }

    this.stateBasePtr = 0;

    const sessionPtr = Module._portal_wasm_pose_session_create(2);
    (this as any).sessionPtr = sessionPtr;

    // Treat statePtr as the right-hand portal_pose_state*
    this.statePtr = Module._portal_wasm_pose_session_get_hand_state(
      sessionPtr,
      PortalHandEnum.Right,
    );
    (this as any).stateLeftPtr = Module._portal_wasm_pose_session_get_hand_state(
      sessionPtr,
      PortalHandEnum.Left,
    );

    const sampleInPtr = Module._malloc(SIZEOF_PORTAL_POSE_SESSION_SAMPLE_IN);
    const sampleOutPtr = Module._malloc(SIZEOF_PORTAL_POSE_SESSION_SAMPLE_OUT);
    (this as any).sampleInPtr = sampleInPtr;
    (this as any).sampleOutPtr = sampleOutPtr;

    // inputsPtr/resultPtr now point into the embedded portal_pose_inputs / portal_pose_result
    this.inputsPtr = sampleInPtr + OFF_SAMPLE_IN_INPUTS;
    this.resultPtr = sampleOutPtr + OFF_SAMPLE_OUT_RESULT;

    this.headPosePtr = Module._malloc(SIZEOF_PORTAL_POSEF);
    this.ctrlPosePtr = Module._malloc(SIZEOF_PORTAL_POSEF);
    this.outPosePtr = Module._malloc(SIZEOF_PORTAL_POSEF);
    this.vecPtr = Module._malloc(3 * FLOAT_SIZE);

    // Legacy alias (right-hand smoother) kept for compatibility
    this.poseSmoother = GLOBAL_HAND_STATES.right.smoother;
    this.poseSmoother.setMode(PoseSmootherMode.LOW);

    // NEW: create PortalCameraDragHandle and wire display-delta callback
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const DragCtor = (this.Module as any).PortalCameraDragHandle;
      if (typeof DragCtor === 'function') {
        this.dragHandle = new DragCtor() as PortalCameraDragHandle;
        this.dragHandle.setDisplayDeltaCallback(() => {
          const hand: HandId = this.dragSource ?? 'right';
          const pose = GLOBAL_HAND_STATES[hand].lastUnblendedPose;
          if (!pose) {
            return null;
          }
          this.writePose(this.ctrlPosePtr, pose);
          const statePtr = this.getStatePtrForHand(hand);
          const ok = this.Module._portal_wasm_pose_state_compute_display_delta(
            statePtr,
            this.ctrlPosePtr,
            this.vecPtr,
          );
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
    // Ensure neutral orientation and roll config reflect default BASE behavior
    this.applyInteractionMode(INTERACTION_MODE_BASE);
    // Initialise session-level alt-hand and aim-hand configuration
    this.syncSessionAltHandConfig();
    this.syncSessionPoseModeConfig();
  }

  destroy(): void {
    this.requestDragButtonActive(false);
    const selfAny = this as any;
    if (selfAny.sampleInPtr) {
      this.Module._free(selfAny.sampleInPtr);
    }
    if (selfAny.sampleOutPtr) {
      this.Module._free(selfAny.sampleOutPtr);
    }
    this.Module._free(this.headPosePtr);
    this.Module._free(this.ctrlPosePtr);
    this.Module._free(this.outPosePtr);
    this.Module._free(this.vecPtr);
  }

  ingestPacket(state: ControllerState): void {
    this.lastPacketNs = state.timestampNs;
    this.lastPacketMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    this.setWandMode(state.wandMode);

    // Update runtime when interaction mode changes
    if (
      typeof state.interactionMode === 'number' &&
      state.interactionMode !== this.interactionMode
    ) {
      this.applyInteractionMode(state.interactionMode);
    }

    const tNs =
      state.timestampNs != null
        ? state.timestampNs
        : Math.floor(
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now()) * 1e6,
          );

    // Right-hand pose and buttons (primary stream body)
    const right = GLOBAL_HAND_STATES.right;
    right.smoother.addSample(
      state.position.x,
      state.position.y,
      state.position.z,
      state.quaternion.x,
      state.quaternion.y,
      state.quaternion.z,
      state.quaternion.w,
      tNs,
    );
    right.buttonState = {
      trigger: state.buttons.trigger,
      squeeze: state.buttons.squeeze,
      action1: state.buttons.action1,
      action2: state.buttons.action2,
      stickClick: state.buttons.stick,
      menu: state.buttons.menu,
    };

    // Optional left-hand tail (dual-tracked v4 packets)
    if (state.left) {
      const left = GLOBAL_HAND_STATES.left;
      left.smoother.addSample(
        state.left.position.x,
        state.left.position.y,
        state.left.position.z,
        state.left.quaternion.x,
        state.left.quaternion.y,
        state.left.quaternion.z,
        state.left.quaternion.w,
        tNs,
      );
      left.buttonState = {
        trigger: state.left.buttons.trigger,
        squeeze: state.left.buttons.squeeze,
        action1: state.left.buttons.action1,
        action2: state.left.buttons.action2,
        stickClick: state.left.buttons.stick,
        menu: state.left.buttons.menu,
      };
    }

    // Session-level flags (mirrored to both hands for now)
    this.flags.aimModeEnabled = state.flags.aim;
    this.flags.armStretchEnabled = state.flags.stretch;

    // Legacy global buttonState kept for callers that inspect active-hand buttons
    this.buttonState = {
      trigger: state.buttons.trigger,
      squeeze: state.buttons.squeeze,
      action1: state.buttons.action1,
      action2: state.buttons.action2,
      stickClick: state.buttons.stick,
      menu: state.buttons.menu,
    };

    const rightDrag = !!(state.buttons as any).cameraDrag;
    const leftDrag = !!state.left?.buttons.cameraDrag;
    const dualTracked = !!state.dualTrackedRequested;

    if (!dualTracked) {
      // Single-hand / legacy dual modes: right hand is always the drag source when pressed.
      this.dragSource = rightDrag ? 'right' : null;
    } else {
      // Dual-tracked: sticky selection between hands based on press edges.
      if (rightDrag && !this.lastButtonDragRight) {
        this.dragSource = 'right';
      } else if (leftDrag && !this.lastButtonDragLeft) {
        this.dragSource = 'left';
      } else if (this.dragSource === 'right' && !rightDrag) {
        this.dragSource = null;
      } else if (this.dragSource === 'left' && !leftDrag) {
        this.dragSource = null;
      }
    }

    this.lastButtonDragRight = rightDrag;
    this.lastButtonDragLeft = leftDrag;

    // Expose whether any drag button is currently active to the camera-drag pipeline.
    this.buttonDragRequested = this.dragSource != null;
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

  setDualTrackedRequested(enabled: boolean): void {
    this.dualTrackedRequested = !!enabled;
    this.syncSessionAltHandConfig();
    this.syncSessionPoseModeConfig();
  }

  getDualTrackedRequested(): boolean {
    return this.dualTrackedRequested;
  }

  updateFrame(
    nowNs: number,
    headPose: HeadPoseInput,
  ): PortalControllerUpdate | null {
    if (this.lastPacketNs == null) {
      return null;
    }

    const result: PortalControllerUpdate = {
      byHand: {
        left: { finalPose: null, unblendedPose: null },
        right: { finalPose: null, unblendedPose: null },
      },
      stretchAmount: 0,
      headWeight: 0,
      aimWeight: 0,
      cameraFovDeg: 0,
    };

    const sessionPtr = this.getSessionPtr();
    const sampleOutPtr = this.getSampleOutPtr();

    // Always submit the right hand
    const predictedRight = this.predictPoseForHand('right', nowNs);
    this.writeInputsToSample('right', PortalHandEnum.Right, predictedRight, headPose, nowNs);
    this.applyDynamicConfig();

    let ok = this.Module._portal_wasm_pose_session_submit_sample(
      sessionPtr,
      this.getSampleInPtr(),
      sampleOutPtr,
    );
    if (!ok) {
      return null;
    }

    let resultPtrInner = this.resultPtr;
    let finalPose = this.readPose(resultPtrInner + OFF_RESULT_FINAL_POSE);
    let unblendedPose = this.readPose(
      resultPtrInner + OFF_RESULT_UNBLENDED_POSE,
    );
    GLOBAL_HAND_STATES.right.lastUnblendedPose = unblendedPose;
    result.byHand.right.finalPose = finalPose;
    result.byHand.right.unblendedPose = unblendedPose;

    // Session-level aggregates (identical for all hands)
    result.stretchAmount =
      this.F32[(resultPtrInner + OFF_RESULT_STRETCH_AMOUNT) >> 2];
    result.headWeight =
      this.F32[
        (sampleOutPtr + OFF_SAMPLE_OUT_HEAD_MODE_WEIGHT) >> 2
      ];
    result.aimWeight =
      this.F32[(sampleOutPtr + OFF_SAMPLE_OUT_AIM_MODE_WEIGHT) >> 2];
    result.cameraFovDeg =
      this.F32[(sampleOutPtr + OFF_SAMPLE_OUT_CAMERA_FOV_DEG) >> 2];

    this.currentPoseModeBlend.headWeight = result.headWeight;
    this.currentPoseModeBlend.aimWeight = result.aimWeight;

    // Optionally submit left-hand when dual-tracked is requested
    if (this.dualTrackedRequested) {
      const predictedLeft = this.predictPoseForHand('left', nowNs);
      this.writeInputsToSample(
        'left',
        PortalHandEnum.Left,
        predictedLeft,
        headPose,
        nowNs,
      );
      this.applyDynamicConfig();
      ok = this.Module._portal_wasm_pose_session_submit_sample(
        sessionPtr,
        this.getSampleInPtr(),
        sampleOutPtr,
      );
      if (ok) {
        resultPtrInner = this.resultPtr;
        finalPose = this.readPose(resultPtrInner + OFF_RESULT_FINAL_POSE);
        unblendedPose = this.readPose(
          resultPtrInner + OFF_RESULT_UNBLENDED_POSE,
        );
        GLOBAL_HAND_STATES.left.lastUnblendedPose = unblendedPose;
        result.byHand.left.finalPose = finalPose;
        result.byHand.left.unblendedPose = unblendedPose;

        // Aggregates updated (should be identical across hands)
        result.stretchAmount =
          this.F32[(resultPtrInner + OFF_RESULT_STRETCH_AMOUNT) >> 2];
        result.headWeight =
          this.F32[
            (sampleOutPtr + OFF_SAMPLE_OUT_HEAD_MODE_WEIGHT) >> 2
          ];
        result.aimWeight =
          this.F32[
            (sampleOutPtr + OFF_SAMPLE_OUT_AIM_MODE_WEIGHT) >> 2
          ];
        result.cameraFovDeg =
          this.F32[
            (sampleOutPtr + OFF_SAMPLE_OUT_CAMERA_FOV_DEG) >> 2
          ];

        this.currentPoseModeBlend.headWeight = result.headWeight;
        this.currentPoseModeBlend.aimWeight = result.aimWeight;
      }
    }

    const rightUnblended = result.byHand.right.unblendedPose;
    const leftUnblended = result.byHand.left.unblendedPose;
    if (this.displayLockPending && rightUnblended) {
      // In dual-tracked mode we always want to feed any available left-hand
      // unblended pose into the display-lock calibration so the portal core
      // can compute the correct per-hand relative offsets. This mirrors the
      // Android display_lock_commit_calibration behaviour and avoids falling
      // back to the manual centering path that collapses both hands onto the
      // same anchor when the left smoother has not fully warmed up.
      const useLeftForCalibration =
        this.dualTrackedRequested && !!leftUnblended;

      this.commitDisplayLock(
        headPose,
        rightUnblended,
        useLeftForCalibration ? leftUnblended : null,
      );
      // Ensure alt-hand offsets are disabled while display-lock is active.
      this.syncSessionAltHandConfig();
    }

    const cameraDrag = rightUnblended
      ? this.computeCameraDrag(nowNs, headPose, rightUnblended, result.aimWeight)
      : undefined;
    if (cameraDrag) {
      result.cameraDrag = cameraDrag;
    }

    this.lastUnblendedPose = rightUnblended ?? null;

    return result;
  }

  handleOrientationReset(calibratingHand: 'left' | 'right' = 'right'): void {
    this.displayLockPending = true;
    this.displayLockCalibrationHand = calibratingHand;
  }

  clearDisplayLock(): void {
    this.displayLockActive = false;
    this.displayLockPending = false;
    this.displayLockHeadPose = null;
    this.displayLockCtrlPose = null;
    const sessionPtr = this.getSessionPtr();
    if (sessionPtr) {
      this.Module._portal_wasm_pose_session_clear_display_lock(sessionPtr);
    }
    // Reset per-hand relative offsets so future frames are not influenced by
    // previous display-lock centering.
    this.clearRelOffsets();
    this.syncSessionAltHandConfig();
  }

  handleDisconnect(): void {
    for (const hand of HAND_IDS) {
      GLOBAL_HAND_STATES[hand].smoother.reset();
      GLOBAL_HAND_STATES[hand].lastSmoothedPose = null;
      GLOBAL_HAND_STATES[hand].lastUnblendedPose = null;
      GLOBAL_HAND_STATES[hand].buttonState = {
        trigger: false,
        squeeze: false,
        action1: false,
        action2: false,
        stickClick: false,
        menu: false,
      };
    }
    this.lastSmoothedPose = null;
    this.lastPacketNs = null;
    this.lastPacketMs = null;
    this.displayLockActive = false;
    this.displayLockPending = false;
    this.displayLockHeadPose = null;
    this.displayLockCtrlPose = null;

    try {
      this.dragHandle?.end();
    } catch {
      // ignore
    }
    this.activeDragMode = 'none';
    this.buttonDragRequested = false;
    this.aimDragRequested = false;
    this.dragSource = null;
    this.lastButtonDragRight = false;
    this.lastButtonDragLeft = false;
    this.lastUnblendedPose = null;
    this.requestDragButtonActive(false);
  }

  hasRecentPacket(nowMs: number): boolean {
    return (
      this.lastPacketMs != null &&
      nowMs - this.lastPacketMs <= DISPLAY_LOCK_TIMEOUT_MS
    );
  }

  getActiveHand(): ActiveHand {
    return this.activeHand;
  }

  getWandMode(): number {
    return this.wandMode;
  }

  private getSessionPtr(): number {
    return (this as any).sessionPtr as number;
  }

  private getSampleInPtr(): number {
    return (this as any).sampleInPtr as number;
  }

  private getSampleOutPtr(): number {
    return (this as any).sampleOutPtr as number;
  }

  private getStatePtrForHand(hand: HandId): number {
    if (hand === 'right') {
      return this.statePtr;
    }
    return (this as any).stateLeftPtr as number;
  }

  private predictPoseForHand(hand: HandId, nowNs: number): PoseArray {
    const state = GLOBAL_HAND_STATES[hand];
    const predicted =
      state.smoother.predict(nowNs) ??
      (state.lastSmoothedPose ?? [0, 0, 0, 0, 0, 0, 1]);
    state.lastSmoothedPose = predicted;
    return predicted;
  }

  private writeInputsToSample(
    hand: HandId,
    handEnum: PortalHandEnum,
    pose: PoseArray,
    headPose: HeadPoseInput,
    nowNs: number,
  ): void {
    const sampleInPtr = this.getSampleInPtr();
    // Write enum portal_hand hand
    this.I32[(sampleInPtr + OFF_SAMPLE_IN_HAND) >> 2] = handEnum;

    const inputsPtr = this.inputsPtr;

    const basePosePtr = inputsPtr + OFF_INPUTS_RAW_LENS_POSE;
    this.writePose(basePosePtr, {
      position: { x: pose[0], y: pose[1], z: pose[2] },
      orientation: { x: pose[3], y: pose[4], z: pose[5], w: pose[6] },
    });

    const screenCenterPtr = inputsPtr + OFF_INPUTS_SCREEN_CENTER_OFFSET;
    this.writeVec3(screenCenterPtr, { x: 0, y: 0, z: 0 });

    const headPtr = inputsPtr + OFF_INPUTS_HEAD;
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

    const deltaPtr = inputsPtr + OFF_INPUTS_DELTA;
    this.U8[deltaPtr + OFF_DELTA_VALID] = this.deltaTargetValid ? 1 : 0;
    if (this.deltaTargetValid) {
      this.writePose(deltaPtr + OFF_DELTA_POSE, this.deltaTargetPose);
    }

    const flagsPtr = inputsPtr + OFF_INPUTS_FLAGS;
    this.U8[flagsPtr + 0] = this.flags.aimModeEnabled ? 1 : 0;
    this.U8[flagsPtr + 1] = this.flags.armStretchEnabled ? 1 : 0;
    this.U8[flagsPtr + 2] = this.displayLockActive ? 1 : 0;
    this.U8[flagsPtr + 3] = this.displayLockPending ? 1 : 0;
    this.U8[flagsPtr + 4] = this.ephemeralSwapActive ? 1 : 0;
    this.U8[flagsPtr + 5] = this.dualModeOpposed ? 1 : 0;
    const handState = GLOBAL_HAND_STATES[hand];
    this.U8[flagsPtr + 6] = handState.buttonState.squeeze ? 1 : 0;

    this.F32[(inputsPtr + OFF_INPUTS_TRIGGER) >> 2] =
      handState.buttonState.trigger ? 1 : 0;
    this.F32[(inputsPtr + OFF_INPUTS_SQUEEZE) >> 2] =
      handState.buttonState.squeeze ? 1 : 0;
    this.F32[(inputsPtr + OFF_INPUTS_NEUTRAL_ROLL) >> 2] =
      this.neutralRollDeg;
    this.F32[(inputsPtr + OFF_INPUTS_NEUTRAL_PITCH) >> 2] =
      this.neutralPitchDeg;
    this.F32[(inputsPtr + OFF_INPUTS_NEUTRAL_YAW) >> 2] =
      this.neutralYawDeg;
    this.F32[(inputsPtr + OFF_INPUTS_HAND_TO_HEAD) >> 2] =
      ANDROID_PLAYER_HAND_TO_HEAD_HEIGHT_METERS;
    // In dual-tracked mode, active_hand must match the hand being submitted so
    // the core looks up the correct rel_off index. In non-dual-tracked mode,
    // active_hand determines anchor lateral placement and should match wand mode.
    const activeHandValue = this.dualTrackedRequested
      ? handEnum
      : (this.activeHand === 'right' ? PortalHandEnum.Right : PortalHandEnum.Left);
    this.I32[(inputsPtr + OFF_INPUTS_ACTIVE_HAND) >> 2] = activeHandValue;
    this.F64[(inputsPtr + OFF_INPUTS_TIME_NOW) >> 3] = nowNs * 1e-9;
  }

  private applyStaticConfig(): void {
    const sessionPtr = this.getSessionPtr();

    const tuningPtr = this.Module._malloc(SIZEOF_PORTAL_POSE_SESSION_TUNING);
    const base = tuningPtr >> 2;
    // fov_head_deg, fov_arm_stretch_deg, fov_aim_deg
    this.F32[base + 0] = 90;
    this.F32[base + 1] = 60;
    this.F32[base + 2] = 60;
    // max_arm_distance_m, stretch_min_dist_m, stretch_lerp_range_m, arm_scaling, torso_distance_proportion
    this.F32[base + 3] = ANDROID_PLAYER_MAX_ARM_DISTANCE;
    this.F32[base + 4] = ANDROID_PLAYER_ARM_STRETCH_MIN_DIST;
    this.F32[base + 5] = ANDROID_PLAYER_ARM_STRETCH_LERP_RANGE;
    this.F32[base + 6] = ANDROID_PLAYER_ARM_SCALING;
    this.F32[base + 7] = FIXED_DISPLAY_TORSO_DISTANCE_PROPORTION;
    this.Module._portal_wasm_pose_session_apply_tuning(sessionPtr, tuningPtr);
    this.Module._free(tuningPtr);

    const rollCfgPtr = this.Module._malloc(SIZEOF_PORTAL_ROLL_CONFIG);
    const rb = rollCfgPtr >> 2;
    this.F32[rb + 0] = DEFAULT_YAW_ROLL_AMPLIFY;
    this.F32[rb + 1] = DEFAULT_ROLL_ZERO_OFFSET_DEG;
    this.F32[rb + 2] = DEFAULT_ROLL_AMPLIFY_START_DEG;
    this.Module._portal_wasm_pose_session_set_roll_config(sessionPtr, rollCfgPtr);
    this.Module._free(rollCfgPtr);

    // Apply FOV and arm params per-hand
    const leftStatePtr = this.getStatePtrForHand('left');
    this.Module._portal_wasm_pose_state_set_fov_defaults(
      this.statePtr,
      90,
      60,
      60,
    );
    this.Module._portal_wasm_pose_state_set_fov_defaults(
      leftStatePtr,
      90,
      60,
      60,
    );

    this.Module._portal_wasm_pose_state_set_arm_params(
      this.statePtr,
      ANDROID_PLAYER_MAX_ARM_DISTANCE,
      ANDROID_PLAYER_ARM_STRETCH_MIN_DIST,
      ANDROID_PLAYER_ARM_STRETCH_LERP_RANGE,
      ANDROID_PLAYER_ARM_SCALING,
      FIXED_DISPLAY_TORSO_DISTANCE_PROPORTION,
    );
    this.Module._portal_wasm_pose_state_set_arm_params(
      leftStatePtr,
      ANDROID_PLAYER_MAX_ARM_DISTANCE,
      ANDROID_PLAYER_ARM_STRETCH_MIN_DIST,
      ANDROID_PLAYER_ARM_STRETCH_LERP_RANGE,
      ANDROID_PLAYER_ARM_SCALING,
      FIXED_DISPLAY_TORSO_DISTANCE_PROPORTION,
    );
  }

  private applyInteractionMode(mode: number): void {
    this.interactionMode = mode;

    let amplify = DEFAULT_YAW_ROLL_AMPLIFY;
    if (
      mode === INTERACTION_MODE_DUAL_AXIS_GAMEPAD ||
      mode === INTERACTION_MODE_DUALSHOCK_GAMEPAD
    ) {
      // Gamepad-style modes: neutral at 0/0/-90 and no roll amplification
      this.neutralRollDeg = 0.0;
      this.neutralPitchDeg = 0.0;
      this.neutralYawDeg = -90.0;
      amplify = 1.0;
    } else if (mode === INTERACTION_MODE_OPENXR_QUEST) {
      // OpenXR Quest mode: controller pose already aligned
      this.neutralRollDeg = 120.0;
      this.neutralPitchDeg = 180.0;
      this.neutralYawDeg = 180.0;
      amplify = 1.0;
    } else {
      // BASE: keep existing constants and default roll amplification
      this.neutralRollDeg = CONTROLLER_NEUTRAL_ROLL_DEG;
      this.neutralPitchDeg = CONTROLLER_NEUTRAL_PITCH_DEG;
      this.neutralYawDeg = CONTROLLER_NEUTRAL_YAW_DEG;
      amplify = DEFAULT_YAW_ROLL_AMPLIFY;
    }

    const rollCfgPtr = this.Module._malloc(SIZEOF_PORTAL_ROLL_CONFIG);
    const base = rollCfgPtr >> 2;
    this.F32[base + 0] = amplify;
    this.F32[base + 1] = DEFAULT_ROLL_ZERO_OFFSET_DEG;
    this.F32[base + 2] = DEFAULT_ROLL_AMPLIFY_START_DEG;
    this.Module._portal_wasm_pose_session_set_roll_config(
      this.getSessionPtr(),
      rollCfgPtr,
    );
    this.Module._free(rollCfgPtr);
  }

  private applyDynamicConfig(): void {
    const rightStatePtr = this.getStatePtrForHand('right');
    const leftStatePtr = this.getStatePtrForHand('left');

    if (this.deltaTargetValid) {
      this.writePose(this.ctrlPosePtr, this.deltaTargetPose);
      this.Module._portal_wasm_pose_state_set_delta_target(
        rightStatePtr,
        1,
        this.ctrlPosePtr,
      );
      this.Module._portal_wasm_pose_state_set_delta_target(
        leftStatePtr,
        1,
        this.ctrlPosePtr,
      );
    } else {
      this.Module._portal_wasm_pose_state_set_delta_target(
        rightStatePtr,
        0,
        0,
      );
      this.Module._portal_wasm_pose_state_set_delta_target(
        leftStatePtr,
        0,
        0,
      );
    }
  }

  public setCameraLock(
    hand: 'left' | 'right',
    valid: boolean,
    offset?: PortalPose | null,
  ): void {
    const handEnum =
      hand === 'right' ? PortalHandEnum.Right : PortalHandEnum.Left;
    const statePtr = this.getStatePtrForHand(hand);
    if (!statePtr) {
      return;
    }

    if (valid && offset) {
      this.writePose(this.ctrlPosePtr, offset);
      this.Module._portal_wasm_pose_state_set_camera_lock(
        statePtr,
        handEnum,
        1,
        this.ctrlPosePtr,
      );
    } else {
      this.Module._portal_wasm_pose_state_set_camera_lock(
        statePtr,
        handEnum,
        0,
        0,
      );
    }
  }

  public updateCameraLockedPose(
    hand: 'left' | 'right',
    headPose: PortalPose,
    currentPose: PortalPose,
  ): PortalPose | null {
    const handEnum =
      hand === 'right' ? PortalHandEnum.Right : PortalHandEnum.Left;
    const statePtr = this.getStatePtrForHand(hand);
    if (!statePtr) {
      return null;
    }

    this.writePose(this.headPosePtr, headPose);
    this.writePose(this.ctrlPosePtr, currentPose);
    const ok = this.Module._portal_wasm_pose_state_update_camera_locked_pose(
      statePtr,
      handEnum,
      this.headPosePtr,
      this.ctrlPosePtr,
      this.outPosePtr,
    );
    if (!ok) {
      return null;
    }
    return this.readPose(this.outPosePtr);
  }

  public setExternalUiYawRad(yawRad: number): void {
    if (Number.isFinite(yawRad)) {
      this.externalUiYawRad = yawRad;
    }
  }

  public setAltHandSpawnFromHead(headPose: PortalPose, baselineM = 0.25): void {
    this.writePose(this.headPosePtr, headPose);
    this.Module._portal_wasm_compute_alt_hand_spawn_offset(
      this.headPosePtr,
      baselineM,
      this.vecPtr,
    );
    const base = this.vecPtr >> 2;
    this.altHandOffset.x = this.F32[base + 0];
    this.altHandOffset.y = this.F32[base + 1];
    this.altHandOffset.z = this.F32[base + 2];
    this.altHandOffsetValid = true;
    this.syncSessionAltHandConfig();
  }

  private syncSessionAltHandConfig(): void {
    const sessionPtr = this.getSessionPtr();
    if (!sessionPtr) {
      return;
    }

    const cfgPtr = this.Module._malloc(SIZEOF_PORTAL_ALT_HAND_CONFIG);

    // offset_world (vec3f)
    const vecBase = (cfgPtr + OFF_ALT_HAND_CFG_OFFSET_WORLD) >> 2;
    this.F32[vecBase + 0] = this.altHandOffset.x;
    this.F32[vecBase + 1] = this.altHandOffset.y;
    this.F32[vecBase + 2] = this.altHandOffset.z;

    const offsetValid =
      this.altHandOffsetValid &&
      !this.displayLockActive &&
      !this.dualTrackedRequested;

    this.U8[cfgPtr + OFF_ALT_HAND_CFG_OFFSET_VALID] = offsetValid ? 1 : 0;
    this.U8[cfgPtr + OFF_ALT_HAND_CFG_DISPLAY_LOCK_ACTIVE] =
      this.displayLockActive ? 1 : 0;
    this.U8[cfgPtr + OFF_ALT_HAND_CFG_DUAL_TRACKED_ENABLED] =
      this.dualTrackedRequested ? 1 : 0;

    this.Module._portal_wasm_pose_session_update_alt_hand_offsets(
      sessionPtr,
      cfgPtr,
    );
    this.Module._free(cfgPtr);
  }

  private syncSessionPoseModeConfig(): void {
    const sessionPtr = this.getSessionPtr();
    if (!sessionPtr) {
      return;
    }

    const cfgPtr = this.Module._malloc(SIZEOF_PORTAL_AIM_HAND_CONFIG);

    const sourceHand: HandId =
      this.explicitAimHand ?? this.activeHand ?? 'right';
    const sourceEnum =
      sourceHand === 'right' ? PortalHandEnum.Right : PortalHandEnum.Left;

    // explicit_source_valid
    this.U8[cfgPtr + OFF_AIM_HAND_CFG_EXPLICIT_SOURCE_VALID] = 1;
    // explicit_source enum
    this.I32[(cfgPtr + OFF_AIM_HAND_CFG_EXPLICIT_SOURCE) >> 2] = sourceEnum;
    // dual_tracked_enabled
    this.U8[cfgPtr + OFF_AIM_HAND_CFG_DUAL_TRACKED_ENABLED] =
      this.dualTrackedRequested ? 1 : 0;

    this.Module._portal_wasm_pose_session_set_aim_hand_config(
      sessionPtr,
      cfgPtr,
    );
    this.Module._free(cfgPtr);
  }

  public setAimActiveHand(hand: HandId): void {
    this.explicitAimHand = hand;
    this.syncSessionPoseModeConfig();
  }

  public clearAimActiveHand(): void {
    this.explicitAimHand = null;
    this.syncSessionPoseModeConfig();
  }

  private requestDragButtonActive(active: boolean): void {
    if (!this.dragButtonSetter) {
      return;
    }
    if (this.dragButtonActive === active) {
      return;
    }
    try {
      this.dragButtonSetter(active);
      this.dragButtonActive = active;
    } catch {
      this.dragButtonSetter = null;
      this.dragButtonActive = false;
    }
  }

  private computeCameraDrag(
    nowNs: number,
    headPose: HeadPoseInput,
    unblendedPose: PortalPose,
    aimWeight: number,
  ): CameraDragIncrements | undefined {
    if (!this.dragHandle) {
      this.requestDragButtonActive(false);
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

    const sourceHand: HandId = this.dragSource ?? 'right';
    const sourcePose =
      GLOBAL_HAND_STATES[sourceHand].lastUnblendedPose ?? unblendedPose;

    if (desired !== this.activeDragMode) {
      // Switch modes.
      if (this.activeDragMode !== 'none') {
        try {
          this.dragHandle.end();
        } catch {
          // ignore
        }
      }
      this.activeDragMode = desired;
      if (this.activeDragMode !== 'none' && sourcePose) {
        try {
          this.dragHandle.begin({
            controllerPose: {
              position: { ...sourcePose.position },
              orientation: { ...sourcePose.orientation },
            },
            cameraQuat: { ...headPose.orientation },
            baseUiYawRad: this.externalUiYawRad,
            mode: this.activeDragMode === 'aim' ? 1 : 0,
          });
        } catch {
          // If begin fails, disable drag this frame.
          this.activeDragMode = 'none';
        }
      }
    }

    this.requestDragButtonActive(this.activeDragMode === 'button');

    if (this.activeDragMode === 'none' || !sourcePose) {
      return undefined;
    }

    try {
      const res = this.dragHandle.compute({
        controllerPose: {
          position: { ...sourcePose.position },
          orientation: { ...sourcePose.orientation },
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
        mode: this.activeDragMode,
      };
    } catch {
      return undefined;
    }
  }

  private commitDisplayLock(
    headPose: HeadPoseInput,
    rightCtrlPose: PortalPose,
    leftCtrlPose: PortalPose | null,
  ): void {
    this.displayLockPending = false;
    this.displayLockActive = true;
    this.displayLockHeadPose = {
      position: { ...headPose.position },
      orientation: { ...headPose.orientation },
    };
    this.displayLockCtrlPose = {
      position: { ...rightCtrlPose.position },
      orientation: { ...rightCtrlPose.orientation },
    };

    const sessionPtr = this.getSessionPtr();
    if (!sessionPtr) {
      return;
    }

    const calPtr = this.Module._malloc(
      SIZEOF_PORTAL_DISPLAY_LOCK_CALIBRATION,
    );

    // Common head/anchor fields used for all calibration requests.
    this.writePose(
      calPtr + OFF_DISPLAY_LOCK_CAL_HEAD_POSE,
      this.displayLockHeadPose,
    );
    this.F32[(calPtr + OFF_DISPLAY_LOCK_CAL_ANCHOR_M) >> 2] =
      this.displayLockAnchorM;
    this.F32[
      (calPtr + OFF_DISPLAY_LOCK_CAL_HAND_TO_HEAD_HEIGHT_M) >> 2
    ] = ANDROID_PLAYER_HAND_TO_HEAD_HEIGHT_METERS;

    const rightPosePtr = calPtr + OFF_DISPLAY_LOCK_CAL_CTRL_POSE_RIGHT;
    const leftPosePtr = calPtr + OFF_DISPLAY_LOCK_CAL_CTRL_POSE_LEFT;
    const ctrlValidPtr = calPtr + OFF_DISPLAY_LOCK_CAL_CTRL_VALID;

    const hasDualTrackedCalibration =
      this.dualTrackedRequested && !!leftCtrlPose;

    if (hasDualTrackedCalibration && leftCtrlPose) {
      // Dual-tracked mode: pass BOTH controller poses and per-hand validity to
      // the portal session in a single calibration call. The core will compute
      // the correct per-hand rel_offsets so the non-calibrating hand stays
      // visually fixed when the calibrating hand recenters, matching Android.
      this.writePose(rightPosePtr, rightCtrlPose);
      this.writePose(leftPosePtr, leftCtrlPose);

      // ctrl_valid[RIGHT], ctrl_valid[LEFT]
      this.U8[ctrlValidPtr + 0] = 1;
      this.U8[ctrlValidPtr + 1] = 1;

      const calibratingHandEnum =
        this.displayLockCalibrationHand === 'left'
          ? PortalHandEnum.Left
          : PortalHandEnum.Right;
      this.I32[
        (calPtr + OFF_DISPLAY_LOCK_CAL_CALIBRATING_HAND) >> 2
      ] = calibratingHandEnum;

      this.Module._portal_wasm_pose_session_apply_display_lock_calibration(
        sessionPtr,
        calPtr,
      );
    } else {
      // Single-controller / mirrored modes: calibrate BOTH portal hands from
      // the same physical wand by submitting two independent one-hand
      // calibrations. This mirrors android_ble_controller.c where dual-tracked
      // is disabled: no manual rel_offset math is needed here.

      // Right hand calibration
      this.writePose(rightPosePtr, rightCtrlPose);
      this.writePose(leftPosePtr, {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      });
      this.U8[ctrlValidPtr + 0] = 1; // right valid
      this.U8[ctrlValidPtr + 1] = 0; // left invalid
      this.I32[
        (calPtr + OFF_DISPLAY_LOCK_CAL_CALIBRATING_HAND) >> 2
      ] = PortalHandEnum.Right;
      this.Module._portal_wasm_pose_session_apply_display_lock_calibration(
        sessionPtr,
        calPtr,
      );

      // Left hand calibration
      this.writePose(leftPosePtr, rightCtrlPose);
      this.writePose(rightPosePtr, {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      });
      this.U8[ctrlValidPtr + 0] = 0; // right invalid
      this.U8[ctrlValidPtr + 1] = 1; // left valid
      this.I32[
        (calPtr + OFF_DISPLAY_LOCK_CAL_CALIBRATING_HAND) >> 2
      ] = PortalHandEnum.Left;
      this.Module._portal_wasm_pose_session_apply_display_lock_calibration(
        sessionPtr,
        calPtr,
      );
    }

    this.Module._free(calPtr);
  }

  private clearRelOffsets(): void {
    const rightStatePtr = this.getStatePtrForHand('right');
    const leftStatePtr = this.getStatePtrForHand('left');

    if (rightStatePtr) {
      this.Module._portal_wasm_pose_state_set_rel_offset(
        rightStatePtr,
        PortalHandEnum.Right,
        0,
        0,
      );
    }

    if (leftStatePtr) {
      this.Module._portal_wasm_pose_state_set_rel_offset(
        leftStatePtr,
        PortalHandEnum.Left,
        0,
        0,
      );
    }
  }

  /**
   * Calculates and applies a horizontal centering shift so both hands appear
   * symmetric on screen. This matches the Android implementation.
   */
  private applyCenteringShift(
    headPose: HeadPoseInput,
    rightCtrlPose: PortalPose,
    leftCtrlPose: PortalPose | null,
  ): void {
    const sessionPtr = this.getSessionPtr();
    if (!sessionPtr) {
      return;
    }

    const PORTAL_FIXED_DISPLAY_HAND_SEPARATION = 0.12;

    // Determine primary/secondary based on active hand
    const primaryIsRight = this.activeHand === 'right';
    const primaryPose = primaryIsRight ? rightCtrlPose : (leftCtrlPose ?? rightCtrlPose);
    const secondaryPose = primaryIsRight ? leftCtrlPose : rightCtrlPose;

    // Base X position for primary hand
    const sep = PORTAL_FIXED_DISPLAY_HAND_SEPARATION;
    const primaryBaseX = (primaryIsRight ? 1.0 : -1.0) * sep;

    let shiftX = 0;

    if (secondaryPose) {
      // Calculate vector from primary to secondary in world space
      const diffWorld: vec3 = vec3.fromValues(
        secondaryPose.position.x - primaryPose.position.x,
        secondaryPose.position.y - primaryPose.position.y,
        secondaryPose.position.z - primaryPose.position.z,
      );

      // Transform to head/local space by rotating with head quaternion inverse
      const headQuat: quat = quat.fromValues(
        headPose.orientation.x,
        headPose.orientation.y,
        headPose.orientation.z,
        headPose.orientation.w,
      );
      const headQuatInv: quat = quat.create();
      quat.conjugate(headQuatInv, headQuat);

      const vLocal: vec3 = vec3.create();
      vec3.transformQuat(vLocal, diffWorld, headQuatInv);

      // Calculate centering shift
      shiftX = -primaryBaseX - vLocal[0] * 0.5;
    }

    // Apply shift to both hands via set_rel_offset
    const primaryOffsetPose: PortalPose = {
      position: { x: shiftX, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const rightHandEnum = PortalHandEnum.Right;
    const leftHandEnum = PortalHandEnum.Left;

    // Set right hand rel_offset
    const rightStatePtr = this.getStatePtrForHand('right');
    if (primaryIsRight) {
      // Right is primary - just apply centering shift
      this.writePose(this.ctrlPosePtr, primaryOffsetPose);
    } else if (leftCtrlPose) {
      // Right is secondary - apply relative offset + centering shift
      const diffWorld: vec3 = vec3.fromValues(
        rightCtrlPose.position.x - leftCtrlPose.position.x,
        rightCtrlPose.position.y - leftCtrlPose.position.y,
        rightCtrlPose.position.z - leftCtrlPose.position.z,
      );
      const headQuat: quat = quat.fromValues(
        headPose.orientation.x,
        headPose.orientation.y,
        headPose.orientation.z,
        headPose.orientation.w,
      );
      const headQuatInv: quat = quat.create();
      quat.conjugate(headQuatInv, headQuat);
      const vLocal: vec3 = vec3.create();
      vec3.transformQuat(vLocal, diffWorld, headQuatInv);
      this.writePose(this.ctrlPosePtr, {
        position: { x: vLocal[0] + shiftX, y: vLocal[1], z: vLocal[2] },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      });
    } else {
      this.writePose(this.ctrlPosePtr, primaryOffsetPose);
    }
    this.Module._portal_wasm_pose_state_set_rel_offset(
      rightStatePtr,
      rightHandEnum,
      1,
      this.ctrlPosePtr,
    );

    // Set left hand rel_offset
    if (leftCtrlPose) {
      const leftStatePtr = this.getStatePtrForHand('left');
      if (!primaryIsRight) {
        // Left is primary - just apply centering shift
        this.writePose(this.ctrlPosePtr, primaryOffsetPose);
      } else {
        // Left is secondary - apply relative offset + centering shift
        const diffWorld: vec3 = vec3.fromValues(
          leftCtrlPose.position.x - rightCtrlPose.position.x,
          leftCtrlPose.position.y - rightCtrlPose.position.y,
          leftCtrlPose.position.z - rightCtrlPose.position.z,
        );
        const headQuat: quat = quat.fromValues(
          headPose.orientation.x,
          headPose.orientation.y,
          headPose.orientation.z,
          headPose.orientation.w,
        );
        const headQuatInv: quat = quat.create();
        quat.conjugate(headQuatInv, headQuat);
        const vLocal: vec3 = vec3.create();
        vec3.transformQuat(vLocal, diffWorld, headQuatInv);
        this.writePose(this.ctrlPosePtr, {
          position: { x: vLocal[0] + shiftX, y: vLocal[1], z: vLocal[2] },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        });
      }
      this.Module._portal_wasm_pose_state_set_rel_offset(
        leftStatePtr,
        leftHandEnum,
        1,
        this.ctrlPosePtr,
      );
    }
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
