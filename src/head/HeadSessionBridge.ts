/**
 * HeadSessionBridge - TypeScript wrapper for native portal_head_session (WASM).
 *
 * This is the WebXR analogue of Kotlin's HeadSessionBridge.kt.
 * It provides a unified interface to all head session operations including:
 * - Camera offset state (translation, yaw, pitch)
 * - Nudge smoothing (TAU blend)
 * - Drag state machine (BUTTON/AIM mode switching)
 * - Camera drag computation
 * - Momentum (decay after BUTTON drag release)
 */

import type { Vec3Like, QuatLike } from '../types/geometry.js';

/** Pose representation matching WASM format: position + orientation. */
export interface PoseLike {
  position: Vec3Like;
  orientation: QuatLike;
}

/** Result from advanceSmoothing() */
export interface SmoothingResult {
  /** Delta offset to apply to pose smoother history */
  delta: Vec3Like;
  /** Current smoothed offset */
  offset: Vec3Like;
  /** Smoothed yaw in radians */
  yaw: number;
  /** Smoothed pitch in radians */
  pitch: number;
}

/** Result from advanceMomentum() */
export interface MomentumResult {
  dx: number;
  dy: number;
  dz: number;
  dYaw: number;
  dPitch: number;
}

/** Result from advanceDragStateMachine() */
export interface DragStateResult {
  /** Current active mode: 0=NONE, 1=BUTTON, 2=AIM */
  activeMode: number;
  /** Previous mode before this update */
  previousMode: number;
  /** True if mode changed this frame */
  modeChanged: boolean;
  /** True if hand changed while in AIM mode */
  handChanged: boolean;
  /** True if momentum was armed on mode exit */
  momentumArmed: boolean;
}

/** Result from computeCameraDragIncrements() */
export interface CameraDragIncrements {
  incY: number;
  incYaw: number;
  incPitch: number;
  incX: number;
  incZ: number;
}

/** Drag mode constants matching C enum */
export const DRAG_MODE_NONE = 0;
export const DRAG_MODE_BUTTON = 1;
export const DRAG_MODE_AIM = 2;

/** Hand constants matching C enum */
export const HAND_RIGHT = 0;
export const HAND_LEFT = 1;

/**
 * Interface for the embind-generated PortalHeadSessionHandle class.
 * This is what we get from the WASM module.
 */
interface PortalHeadSessionHandle {
  getCameraOffset(): Vec3Like;
  getCameraYaw(): number;
  getOffsetMagnitude(): number;
  applyCameraNudge(params: {
    dx: number;
    dy: number;
    dz: number;
    orientation: QuatLike;
    cameraPitchRad: number;
    cameraPitchSin: number;
    fixedDisplayLocked: boolean;
  }): void;
  nudgeCameraYaw(dYawRad: number, smoothedPose: PoseLike, finalPose: PoseLike): boolean;
  nudgeCameraPitch(dPitchRad: number): void;
  resetCameraOffset(): void;
  advanceSmoothing(nowNs: number): SmoothingResult;
  composeFinalPose(smoothedPose: PoseLike): PoseLike;
  composeFinalPoseFromTargets(smoothedPose: PoseLike): PoseLike;
  setDragButtonPressed(pressed: boolean): void;
  advanceMomentum(nowNs: number, arPoseActive: boolean): MomentumResult;
  cancelMomentum(): void;
  recordDragIncrement(params: {
    incY: number;
    incYaw: number;
    incPitch: number;
    incX: number;
    incZ: number;
    nowNs: number;
    targetHz: number;
  }): void;
  advanceDragStateMachine(params: {
    displayLocked: boolean;
    aimWeight: number;
    hand: number;
    targetHz: number;
  }): DragStateResult;
  beginCameraDrag(options: {
    controllerPose: PoseLike;
    cameraQuat: QuatLike;
    baseUiYawRad: number;
    mode: number;
    hand: number;
  }): void;
  computeCameraDragIncrements(frameState: {
    controllerPose: PoseLike;
    nowSeconds: number;
  }): CameraDragIncrements | null;
  endCameraDrag(): void;
  applyDragStretchParams(params: {
    stretchMinDistance?: number;
    stretchMinDist?: number;
    stretchLerpRange?: number;
    stretchLerp?: number;
    armScaling?: number;
  }): void;
  setPoseSession(poseSessionPtr: number): void;
  submitPose(rawPose: PoseLike, timestampNs: number): PoseLike;
  setSmootherMode(mode: number): void;
  getSmootherMode(): number;
  setOutlierRejection(enabled: boolean): void;
  resetSmoother(): void;
  delete?(): void;
}

/** Module instance with embind class constructor */
interface ModuleWithHeadSession {
  PortalHeadSessionHandle: new () => PortalHeadSessionHandle;
}

/**
 * HeadSessionBridge wraps the WASM PortalHeadSessionHandle and provides
 * a clean TypeScript API matching Kotlin's HeadSessionBridge.kt.
 */
export class HeadSessionBridge {
  private readonly handle: PortalHeadSessionHandle;
  private destroyed = false;

  private constructor(handle: PortalHeadSessionHandle) {
    this.handle = handle;
  }

  /**
   * Creates a new head session bridge.
   * @param module The loaded WASM module instance
   * @returns HeadSessionBridge instance, or null if creation failed
   */
  static create(module: unknown): HeadSessionBridge | null {
    try {
      const mod = module as ModuleWithHeadSession;
      if (!mod.PortalHeadSessionHandle) {
        console.error('[HeadSessionBridge] Module does not have PortalHeadSessionHandle');
        return null;
      }
      const handle = new mod.PortalHeadSessionHandle();
      return new HeadSessionBridge(handle);
    } catch (e) {
      console.error('[HeadSessionBridge] Failed to create session:', e);
      return null;
    }
  }

  /**
   * Destroys the native session. Instance should not be used after this call.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.handle.delete) {
      this.handle.delete();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Camera offset state queries
  // ─────────────────────────────────────────────────────────────────────────

  getCameraOffset(): Vec3Like {
    if (this.destroyed) return { x: 0, y: 0, z: 0 };
    return this.handle.getCameraOffset();
  }

  getCameraYaw(): number {
    if (this.destroyed) return 0;
    return this.handle.getCameraYaw();
  }

  getOffsetMagnitude(): number {
    if (this.destroyed) return 0;
    return this.handle.getOffsetMagnitude();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Camera nudge operations
  // ─────────────────────────────────────────────────────────────────────────

  applyCameraNudge(
    dx: number,
    dy: number,
    dz: number,
    orientation: QuatLike,
    cameraPitchRad: number,
    cameraPitchSin: number,
    fixedDisplayLocked: boolean,
  ): void {
    if (this.destroyed) return;
    this.handle.applyCameraNudge({
      dx,
      dy,
      dz,
      orientation,
      cameraPitchRad,
      cameraPitchSin,
      fixedDisplayLocked,
    });
  }

  nudgeCameraYaw(dYawRad: number, smoothedPose: PoseLike, finalPose: PoseLike): boolean {
    if (this.destroyed) return false;
    return this.handle.nudgeCameraYaw(dYawRad, smoothedPose, finalPose);
  }

  nudgeCameraPitch(dPitchRad: number): void {
    if (this.destroyed) return;
    this.handle.nudgeCameraPitch(dPitchRad);
  }

  resetCameraOffset(): void {
    if (this.destroyed) return;
    this.handle.resetCameraOffset();
  }

  advanceSmoothing(nowNs: number): SmoothingResult {
    if (this.destroyed) {
      return {
        delta: { x: 0, y: 0, z: 0 },
        offset: { x: 0, y: 0, z: 0 },
        yaw: 0,
        pitch: 0,
      };
    }
    return this.handle.advanceSmoothing(nowNs);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pose composition
  // ─────────────────────────────────────────────────────────────────────────

  composeFinalPose(smoothedPose: PoseLike): PoseLike | null {
    if (this.destroyed) return null;
    return this.handle.composeFinalPose(smoothedPose);
  }

  /** Compose final pose using TARGET yaw/pitch/offset (for yaw-continuity calculations). */
  composeFinalPoseFromTargets(smoothedPose: PoseLike): PoseLike | null {
    if (this.destroyed) return null;
    return this.handle.composeFinalPoseFromTargets(smoothedPose);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Drag state machine
  // ─────────────────────────────────────────────────────────────────────────

  setDragButtonPressed(pressed: boolean): void {
    if (this.destroyed) return;
    this.handle.setDragButtonPressed(pressed);
  }

  advanceDragStateMachine(
    displayLocked: boolean,
    aimWeight: number,
    hand: number,
    targetHz: number,
  ): DragStateResult | null {
    if (this.destroyed) return null;
    return this.handle.advanceDragStateMachine({
      displayLocked,
      aimWeight,
      hand,
      targetHz,
    });
  }

  recordDragIncrement(
    incY: number,
    incYaw: number,
    incPitch: number,
    incX: number,
    incZ: number,
    nowNs: number,
    targetHz: number,
  ): void {
    if (this.destroyed) return;
    this.handle.recordDragIncrement({
      incY,
      incYaw,
      incPitch,
      incX,
      incZ,
      nowNs,
      targetHz,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Camera drag computation
  // ─────────────────────────────────────────────────────────────────────────

  beginCameraDrag(
    basePos: Vec3Like,
    baseQuat: QuatLike,
    baseCamQuat: QuatLike,
    baseUiYaw: number,
    mode: number,
    hand: number,
  ): void {
    if (this.destroyed) return;
    this.handle.beginCameraDrag({
      controllerPose: { position: basePos, orientation: baseQuat },
      cameraQuat: baseCamQuat,
      baseUiYawRad: baseUiYaw,
      mode,
      hand,
    });
  }

  computeCameraDragIncrements(
    curPos: Vec3Like,
    curQuat: QuatLike,
    nowSec: number,
  ): CameraDragIncrements | null {
    if (this.destroyed) return null;
    return this.handle.computeCameraDragIncrements({
      controllerPose: { position: curPos, orientation: curQuat },
      nowSeconds: nowSec,
    });
  }

  endCameraDrag(): void {
    if (this.destroyed) return;
    this.handle.endCameraDrag();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Momentum
  // ─────────────────────────────────────────────────────────────────────────

  advanceMomentum(nowNs: number, arPoseActive: boolean): MomentumResult {
    if (this.destroyed) {
      return { dx: 0, dy: 0, dz: 0, dYaw: 0, dPitch: 0 };
    }
    return this.handle.advanceMomentum(nowNs, arPoseActive);
  }

  cancelMomentum(): void {
    if (this.destroyed) return;
    this.handle.cancelMomentum();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  applyDragStretchParams(
    stretchMinDist: number,
    stretchLerpRange: number,
    armScaling: number,
  ): void {
    if (this.destroyed) return;
    this.handle.applyDragStretchParams({
      stretchMinDistance: stretchMinDist,
      stretchLerpRange: stretchLerpRange,
      armScaling: armScaling,
    });
  }

  /**
   * Associate a pose session for internal display-delta computation during camera drag.
   * When set, the head session automatically computes display-space deltas without
   * requiring an external callback.
   *
   * @param poseSessionPtr Raw WASM pointer to portal_pose_session, or 0 to clear
   */
  setPoseSession(poseSessionPtr: number): void {
    if (this.destroyed) return;
    this.handle.setPoseSession(poseSessionPtr);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // One-Euro pose filtering (Euro Filter Plan)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Submit a raw pose sample and get the filtered + composed final pose.
   * This single call replaces the previous multi-step dance:
   *   addSample -> advanceSmoothing -> translateHistory -> predict -> composeFinalPose
   *
   * @param rawPose Raw camera pose (from ARCore or neutral)
   * @param timestampNs Timestamp in nanoseconds
   * @returns The filtered and composed final pose
   */
  submitPose(rawPose: PoseLike, timestampNs: number): PoseLike | null {
    if (this.destroyed) return null;
    return this.handle.submitPose(rawPose, timestampNs);
  }

  /**
   * Set the pose smoother mode (filtering aggressiveness).
   * @param mode 0=HIGH (responsive), 1=LOW (balanced, default), 2=VERY_HIGH (smooth)
   */
  setSmootherMode(mode: number): void {
    if (this.destroyed) return;
    this.handle.setSmootherMode(mode);
  }

  /**
   * Get the current pose smoother mode.
   */
  getSmootherMode(): number {
    if (this.destroyed) return 1; // LOW
    return this.handle.getSmootherMode();
  }

  /**
   * Enable or disable outlier rejection in the pose smoother.
   */
  setOutlierRejection(enabled: boolean): void {
    if (this.destroyed) return;
    this.handle.setOutlierRejection(enabled);
  }

  /**
   * Reset the pose smoother state (clears filter history).
   */
  resetSmoother(): void {
    if (this.destroyed) return;
    this.handle.resetSmoother();
  }
}
