import type { XRDevice } from '../device/XRDevice.js';
import type { XRFrame } from '../frameloop/XRFrame.js';
import {
  HeadSessionBridge,
  type PoseLike,
  type DragStateResult,
  type CameraDragIncrements,
  DRAG_MODE_NONE,
  DRAG_MODE_BUTTON,
  DRAG_MODE_AIM,
} from './HeadSessionBridge.js';
import { PoseSmoother, type PoseArray } from './PoseSmoother.js';
import {
  DEFAULT_CAMERA_PITCH_RAD,
  degreesToRadians,
  loadPortalPoseModule,
  type PortalPoseLoadOptions,
} from '../wasm/PortalPoseLoader.js';
import type { Vec3Like, QuatLike } from '../types/geometry.js';

/** Input for drag state machine advancement */
export interface DragStateMachineInput {
  /** Whether display is locked (AIM drag requires this) */
  displayLocked: boolean;
  /** AIM weight from pose blending (0-1) */
  aimWeight: number;
  /** Hand identifier (0=right, 1=left) */
  hand: number;
  /** Target frame rate for scaling */
  targetHz: number;
}

/** Input for beginning a camera drag session */
export interface BeginCameraDragInput {
  /** Controller position */
  controllerPos: Vec3Like;
  /** Controller orientation */
  controllerQuat: QuatLike;
  /** Camera orientation */
  cameraQuat: QuatLike;
  /** Base UI yaw in radians */
  baseUiYawRad: number;
  /** Drag mode (0=BUTTON, 1=AIM) */
  mode: number;
  /** Hand (0=right, 1=left) */
  hand: number;
}

/** Input for computing camera drag increments */
export interface ComputeCameraDragInput {
  /** Current controller position */
  controllerPos: Vec3Like;
  /** Current controller orientation */
  controllerQuat: QuatLike;
  /** Current time in seconds */
  nowSeconds: number;
}

export { DragStateResult, CameraDragIncrements, DRAG_MODE_NONE, DRAG_MODE_BUTTON, DRAG_MODE_AIM };

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
  private readonly headSession: HeadSessionBridge;
  private readonly cameraPitchRad: number;
  private readonly cameraPitchSin: number;
  private readonly fixedDisplayLocked: boolean;
  private readonly basePosition: Vec3Like;
  private readonly baseOrientation: PoseLike['orientation'];
  private readonly debugEnabled: boolean;
  private readonly poseSmoother: PoseSmoother;
  private latestSmoothedPose: PoseLike;
  private latestFinalPose: PoseLike;
  private lastPredictedMs: number | null = null;
  private lastNowMs: number | null = null;
  /** Whether drag button is currently pressed (for momentum arming on release) */
  private dragButtonPressed = false;

  constructor(
    headSession: HeadSessionBridge,
    device: XRDevice,
    options: PortalPoseCameraInternalOptions,
  ) {
    this.headSession = headSession;
    this.cameraPitchRad = options.cameraPitchRad;
    this.cameraPitchSin = Math.sin(this.cameraPitchRad);
    this.fixedDisplayLocked = options.fixedDisplayLocked;
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

    this.poseSmoother = new PoseSmoother(90);

    const initNs = this.nowNs();
    // Initialize session smoothing
    const smoothingResult = this.headSession.advanceSmoothing(initNs);
    const initOffset = smoothingResult.offset;
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
    this.latestSmoothedPose = {
      position: { x: samplePos.x, y: samplePos.y, z: samplePos.z },
      orientation: { ...this.baseOrientation },
    };
    this.latestFinalPose = { ...this.latestSmoothedPose };
  }

  public getYawOffsetRad(): number {
    return this.headSession.getCameraYaw();
  }

  public getOffsetMagnitude(): number {
    return this.headSession.getOffsetMagnitude();
  }

  handleFrame(device: XRDevice, frame: XRFrame) {
    void this.computeDeltaSeconds(frame);
    const nowNs = this.nowNs();

    // Advance momentum (decaying after BUTTON drag release)
    // This is done BEFORE nudge smoothing, mirroring HeadPoseProvider.predictedPose()
    const momentumResult = this.headSession.advanceMomentum(nowNs, false);
    if (momentumResult) {
      const { dx, dy, dz, dYaw, dPitch } = momentumResult;
      // Apply momentum increments directly to nudge targets
      if (Math.abs(dy) > 1e-6) {
        this.applyTranslationDelta(0, dy, 0);
      }
      if (Math.abs(dYaw) > 1e-6) {
        this.applyYawDelta(dYaw);
      }
      if (Math.abs(dPitch) > 1e-6) {
        this.headSession.nudgeCameraPitch(dPitch);
      }
      if (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6) {
        this.applyTranslationDelta(dx, 0, dz);
      }
    }

    // Advance session smoothing (TAU blend toward targets)
    const smoothingResult = this.headSession.advanceSmoothing(nowNs);

    // Translate pose history if offset delta is significant
    const { delta } = smoothingResult;
    const deltaMag = Math.abs(delta.x) + Math.abs(delta.y) + Math.abs(delta.z);
    if (deltaMag > 1e-6) {
      this.poseSmoother.translateHistory(delta.x, delta.y, delta.z);
      this.shiftCachedPoses(delta);
    }

    this.addPoseSample(nowNs, smoothingResult.offset);
    const predicted = this.poseSmoother.predict(nowNs);
    this.composeFinalPose(device, predicted);
  }

  public applyCameraDragIncrements(
    inc: { incY: number; incYaw: number; incPitch: number; incX: number; incZ: number },
    isButtonDrag = false,
    targetHz = 90,
  ): void {
    if (!inc) {
      return;
    }

    // Record drag increment for momentum seeding (BUTTON drag only)
    if (isButtonDrag) {
      const nowNs = this.nowNs();
      this.headSession.recordDragIncrement(
        inc.incY,
        inc.incYaw,
        inc.incPitch,
        inc.incX,
        inc.incZ,
        nowNs,
        targetHz,
      );
    }

    // With the pose session associated (via setPoseSession), the C code computes display-space
    // deltas internally using the display-delta path which applies correct "grab" semantics
    // (negative X/Y). This transforms controller positions into display-space coordinates,
    // properly handling head orientation at calibration (e.g., "up on screen" maps to ground
    // plane when looking down). No additional sign corrections are needed here.

    // 1) Vertical translation
    if (Math.abs(inc.incY) > 1e-6) {
      this.applyTranslationDelta(0, inc.incY, 0);
    }

    // 2) Yaw (use session's nudgeCameraYaw with continuity correction)
    if (Math.abs(inc.incYaw) > 1e-6) {
      this.applyYawDelta(inc.incYaw);
    }

    // 3) Pitch around camera-right
    if (Math.abs(inc.incPitch) > 1e-6) {
      this.headSession.nudgeCameraPitch(inc.incPitch);
    }

    // 4) Horizontal camera-local translation (X/Z)
    if (Math.abs(inc.incX) > 1e-6 || Math.abs(inc.incZ) > 1e-6) {
      this.applyTranslationDelta(inc.incX, 0, inc.incZ);
    }
  }

  /**
   * Set drag button pressed state. Momentum is armed on release.
   */
  public setDragButtonPressed(pressed: boolean): void {
    this.headSession.setDragButtonPressed(pressed);
    this.dragButtonPressed = pressed;
  }

  /**
   * Cancel any active momentum immediately.
   */
  public cancelMomentum(): void {
    this.headSession.cancelMomentum();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Drag state machine (Phase 5 migration)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Advance the drag state machine. Returns mode transition info.
   */
  public advanceDragStateMachine(input: DragStateMachineInput): DragStateResult | null {
    return this.headSession.advanceDragStateMachine(
      input.displayLocked,
      input.aimWeight,
      input.hand,
      input.targetHz,
    );
  }

  /**
   * Begin a camera drag session with the given baseline.
   */
  public beginCameraDrag(input: BeginCameraDragInput): void {
    this.headSession.beginCameraDrag(
      input.controllerPos,
      input.controllerQuat,
      input.cameraQuat,
      input.baseUiYawRad,
      input.mode,
      input.hand,
    );
  }

  /**
   * Compute camera drag increments for the current frame.
   */
  public computeCameraDragIncrements(input: ComputeCameraDragInput): CameraDragIncrements | null {
    return this.headSession.computeCameraDragIncrements(
      input.controllerPos,
      input.controllerQuat,
      input.nowSeconds,
    );
  }

  /**
   * End the current camera drag session.
   */
  public endCameraDrag(): void {
    this.headSession.endCameraDrag();
  }

  /**
   * Associate a pose session for internal display-delta computation during camera drag.
   * When set, the head session automatically computes display-space deltas using the
   * pose state's calibration data.
   *
   * @param poseSessionPtr Raw WASM pointer to portal_controller_session, or 0 to clear
   */
  public setPoseSession(poseSessionPtr: number): void {
    this.headSession.setPoseSession(poseSessionPtr);
  }

  public resetOrientation() {
    // Reset camera offset (preserves clamped Y)
    this.headSession.resetCameraOffset();

    const newOffset = this.headSession.getCameraOffset();
    const samplePos = {
      x: this.basePosition.x + newOffset.x,
      y: this.basePosition.y + newOffset.y,
      z: this.basePosition.z + newOffset.z,
    };
    const sample: PoseArray = [
      samplePos.x,
      samplePos.y,
      samplePos.z,
      this.baseOrientation.x,
      this.baseOrientation.y,
      this.baseOrientation.z,
      this.baseOrientation.w,
    ] as PoseArray;
    const nowNs = this.nowNs();
    this.headSession.advanceSmoothing(nowNs);
    this.poseSmoother.reset(sample, nowNs);
    this.latestSmoothedPose = {
      position: { x: samplePos.x, y: samplePos.y, z: samplePos.z },
      orientation: { ...this.baseOrientation },
    };
    this.latestFinalPose = { ...this.latestSmoothedPose };
  }

  public dispose() {
    this.headSession.destroy();
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
    const orientation = this.latestSmoothedPose.orientation;

    // Use session's applyCameraNudge which handles the delta calculation internally
    this.headSession.applyCameraNudge(
      dx,
      dy,
      dz,
      orientation,
      this.cameraPitchRad,
      this.cameraPitchSin,
      this.fixedDisplayLocked,
    );

    this.debug('nudge-delta', { input: { dx, dy, dz } });
  }

  private applyYawDelta(dYawRad: number) {
    const smoothedPose = this.latestSmoothedPose;
    if (!smoothedPose) {
      return;
    }

    // Compose using TARGET yaw/pitch/offset for the continuity baseline.
    // This must use targets (not smoothed) because nudgeCameraYaw modifies the targets,
    // and the continuity correction needs to be computed relative to those same values.
    const finalPoseFromTargets = this.headSession.composeFinalPoseFromTargets(smoothedPose);
    if (!finalPoseFromTargets) {
      return;
    }

    // Use session's nudgeCameraYaw with continuity correction
    this.headSession.nudgeCameraYaw(dYawRad, smoothedPose, finalPoseFromTargets);
    this.debug('yaw-nudge', { dYawRad });
  }

  private composeFinalPose(device: XRDevice, predicted: PoseArray | null) {
    const pose = predicted;
    if (!pose) {
      return;
    }

    const smoothedPose: PoseLike = {
      position: { x: pose[0], y: pose[1], z: pose[2] },
      orientation: { x: pose[3], y: pose[4], z: pose[5], w: pose[6] },
    };

    // Use session's composeFinalPose which applies yaw/pitch/offset internally
    const finalPose = this.headSession.composeFinalPose(smoothedPose);
    if (!finalPose) {
      return;
    }

    device.quaternion.set(
      finalPose.orientation.x,
      finalPose.orientation.y,
      finalPose.orientation.z,
      finalPose.orientation.w,
    );
    device.position.set(finalPose.position.x, finalPose.position.y, finalPose.position.z);

    this.latestSmoothedPose = smoothedPose;
    this.latestFinalPose = finalPose;

    this.debug('compose-final', { finalPose });
  }

  private addPoseSample(nowNs: number, smOffset: Vec3Like) {
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
    this.latestSmoothedPose.position.x += x;
    this.latestSmoothedPose.position.y += y;
    this.latestSmoothedPose.position.z += z;
    this.latestFinalPose.position.x += x;
    this.latestFinalPose.position.y += y;
    this.latestFinalPose.position.z += z;
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
   * @param inc The drag increments to apply
   * @param isButtonDrag Whether this is from BUTTON drag mode (for momentum seeding)
   * @param targetHz Target frame rate for momentum scaling
   */
  public applyCameraDragIncrements(
    inc: { incY: number; incYaw: number; incPitch: number; incX: number; incZ: number },
    isButtonDrag = false,
    targetHz = 90,
  ): void {
    if (this.disposed) {
      return;
    }
    this.controller?.applyCameraDragIncrements(inc, isButtonDrag, targetHz);
  }

  /**
   * Set drag button pressed state. Momentum is armed on release.
   */
  public setDragButtonPressed(pressed: boolean): void {
    if (this.disposed) {
      return;
    }
    this.controller?.setDragButtonPressed(pressed);
  }

  /**
   * Cancel any active momentum immediately.
   */
  public cancelMomentum(): void {
    if (this.disposed) {
      return;
    }
    this.controller?.cancelMomentum();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Drag state machine (Phase 5 migration)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Advance the drag state machine. Returns mode transition info.
   * Call this each frame with current display lock and aim weight state.
   */
  public advanceDragStateMachine(input: DragStateMachineInput): DragStateResult | null {
    if (this.disposed) {
      return null;
    }
    return this.controller?.advanceDragStateMachine(input) ?? null;
  }

  /**
   * Begin a camera drag session with the given baseline.
   */
  public beginCameraDrag(input: BeginCameraDragInput): void {
    if (this.disposed) {
      return;
    }
    this.controller?.beginCameraDrag(input);
  }

  /**
   * Compute camera drag increments for the current frame.
   */
  public computeCameraDragIncrements(input: ComputeCameraDragInput): CameraDragIncrements | null {
    if (this.disposed) {
      return null;
    }
    return this.controller?.computeCameraDragIncrements(input) ?? null;
  }

  /**
   * End the current camera drag session.
   */
  public endCameraDrag(): void {
    if (this.disposed) {
      return;
    }
    this.controller?.endCameraDrag();
  }

  /**
   * Associate a pose session for internal display-delta computation during camera drag.
   * When set, the head session automatically computes display-space deltas using the
   * pose state's calibration data.
   *
   * @param poseSessionPtr Raw WASM pointer to portal_controller_session, or 0 to clear
   */
  public setPoseSession(poseSessionPtr: number): void {
    if (this.disposed) {
      return;
    }
    this.controller?.setPoseSession(poseSessionPtr);
  }

  /**
   * Check if the controller is initialized.
   */
  public isInitialized(): boolean {
    return this.controller !== null;
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

    // Create head session bridge
    const headSession = HeadSessionBridge.create(module);
    if (!headSession) {
      // eslint-disable-next-line no-console
      console.error('[PortalPoseCamera] Failed to create HeadSessionBridge');
      this.initPromise = null;
      return;
    }

    const internalOptions: PortalPoseCameraInternalOptions = {
      cameraPitchRad:
        cameraPitchDegrees != null ? degreesToRadians(cameraPitchDegrees) : DEFAULT_CAMERA_PITCH_RAD,
      fixedDisplayLocked: fixedDisplayLocked ?? true,
      debug: debugEnabled,
    };

    this.controller = new PortalPoseCameraNudger(headSession, this.device, internalOptions);
    if (this.pendingOrientationReset && this.controller) {
      this.controller.resetOrientation();
      this.pendingOrientationReset = false;
    }
    this.initPromise = null;
  }
}
