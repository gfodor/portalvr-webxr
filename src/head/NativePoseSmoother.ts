/**
 * NativePoseSmoother - TypeScript wrapper for native portal_pose_smoother (WASM).
 *
 * This replaces the pure-TypeScript PoseSmoother class with calls to the
 * native One-Euro filter implementation via WASM.
 */

export type PoseArray = [number, number, number, number, number, number, number];

export enum PoseSmootherMode {
  HIGH = 0,      // Most responsive (beta=1.0)
  LOW = 1,       // Balanced, default (beta=75.0)
  VERY_HIGH = 2, // Maximum smoothing (beta=0.001)
}

/**
 * Interface for the embind-generated PortalPoseSmootherHandle class.
 */
interface PortalPoseSmootherHandle {
  addSample(
    px: number, py: number, pz: number,
    qx: number, qy: number, qz: number, qw: number,
    timestampNs: number
  ): void;
  predict(nowNs: number): number[] | null;
  translateHistory(dx: number, dy: number, dz: number): void;
  setMode(mode: number): void;
  getMode(): number;
  reset(): void;
  delete?(): void;
}

/** Module instance with embind class constructor */
interface ModuleWithPoseSmoother {
  PortalPoseSmootherHandle: new (displayHz: number, latencyFrames: number, enableOutlierRejection: boolean) => PortalPoseSmootherHandle;
}

// Cached module reference for creating new instances
let cachedModule: ModuleWithPoseSmoother | null = null;

/**
 * Set the WASM module to use for creating pose smoothers.
 * Call this once after loading the portal_pose WASM module.
 */
export function setNativePoseSmootherModule(module: unknown): void {
  cachedModule = module as ModuleWithPoseSmoother;
}

/**
 * NativePoseSmoother wraps the WASM PortalPoseSmootherHandle and provides
 * an API compatible with the old TypeScript PoseSmoother class.
 */
export class NativePoseSmoother {
  private readonly handle: PortalPoseSmootherHandle;
  private destroyed = false;
  private mode: PoseSmootherMode = PoseSmootherMode.LOW;

  constructor(
    displayHz = 90,
    latencyFrames = 0,
    enableOutlierRejection = true,
  ) {
    if (!cachedModule) {
      throw new Error('[NativePoseSmoother] Module not set. Call setNativePoseSmootherModule() first.');
    }
    if (!cachedModule.PortalPoseSmootherHandle) {
      throw new Error('[NativePoseSmoother] Module does not have PortalPoseSmootherHandle');
    }
    this.handle = new cachedModule.PortalPoseSmootherHandle(displayHz, latencyFrames, enableOutlierRejection);
  }

  /**
   * Creates a new pose smoother using the cached module.
   * @returns NativePoseSmoother instance, or null if creation failed
   */
  static create(
    displayHz = 90,
    latencyFrames = 0,
    enableOutlierRejection = true,
  ): NativePoseSmoother | null {
    try {
      return new NativePoseSmoother(displayHz, latencyFrames, enableOutlierRejection);
    } catch (e) {
      console.error('[NativePoseSmoother] Failed to create smoother:', e);
      return null;
    }
  }

  /**
   * Check if the native smoother module is available.
   */
  static isAvailable(): boolean {
    return cachedModule !== null && cachedModule.PortalPoseSmootherHandle !== undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.handle.delete) {
      this.handle.delete();
    }
  }

  setMode(newMode: PoseSmootherMode): void {
    if (this.destroyed) return;
    if (newMode === this.mode) return;
    this.mode = newMode;
    this.handle.setMode(newMode);
  }

  getMode(): PoseSmootherMode {
    return this.mode;
  }

  addSample(
    px: number, py: number, pz: number,
    qx: number, qy: number, qz: number, qw: number,
    timestampNs: number,
  ): void {
    if (this.destroyed) return;
    this.handle.addSample(px, py, pz, qx, qy, qz, qw, timestampNs);
  }

  translateHistory(dx: number, dy: number, dz: number): void {
    if (this.destroyed) return;
    if (dx === 0 && dy === 0 && dz === 0) return;
    this.handle.translateHistory(dx, dy, dz);
  }

  reset(initialPose?: PoseArray, timestampNs?: number): void {
    if (this.destroyed) return;
    this.handle.reset();
    if (initialPose) {
      const tNs = timestampNs ?? performance.now() * 1e6;
      this.addSample(
        initialPose[0], initialPose[1], initialPose[2],
        initialPose[3], initialPose[4], initialPose[5], initialPose[6],
        tNs,
      );
    }
  }

  predict(nowTimestampNs = performance.now() * 1e6): PoseArray | null {
    if (this.destroyed) return null;
    const result = this.handle.predict(nowTimestampNs);
    if (!result || result.length < 7) return null;
    return [result[0], result[1], result[2], result[3], result[4], result[5], result[6]] as PoseArray;
  }
}
