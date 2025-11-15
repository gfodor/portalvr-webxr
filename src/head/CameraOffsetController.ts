import type { Vec3Like } from '../types/geometry.js';

const Y_OFFSET_MIN = -1.5;
const Y_OFFSET_MAX = 1.5;

const TAU_OFFSET_SECONDS = 0.05;
const TAU_PITCH_SECONDS = 0.05;
const PITCH_LIMIT_RAD = (77.5 * Math.PI) / 180;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function copyVec(vec: Vec3Like): Vec3Like {
  return { x: vec.x, y: vec.y, z: vec.z };
}

export class CameraOffsetController {
  private readonly uiOffsetWorld: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly smoothedOffset: Vec3Like = { x: 0, y: 0, z: 0 };

  private pitchOffsetRad = 0;
  private smoothedPitchRad = 0;

  private yawOffsetRad = 0;
  private lastUpdateNs = 0;

  private alphaFor(dtSec: number, tauSec: number): number {
    if (tauSec <= 1e-6) return 1;
    if (dtSec <= 0) return 0;
    const a = 1 - Math.exp(-dtSec / tauSec);
    return clamp(a, 0, 1);
  }

  public stepSmoothing(nowNs: number): void {
    if (this.lastUpdateNs === 0) {
      this.smoothedOffset.x = this.uiOffsetWorld.x;
      this.smoothedOffset.y = this.uiOffsetWorld.y;
      this.smoothedOffset.z = this.uiOffsetWorld.z;
      this.smoothedPitchRad = this.pitchOffsetRad;
      this.lastUpdateNs = nowNs;
      return;
    }
    const dtSec = Math.max((nowNs - this.lastUpdateNs) * 1e-9, 0);
    this.lastUpdateNs = nowNs;

    const alphaOffset = this.alphaFor(dtSec, TAU_OFFSET_SECONDS);
    const alphaPitch = this.alphaFor(dtSec, TAU_PITCH_SECONDS);

    this.smoothedOffset.x += alphaOffset * (this.uiOffsetWorld.x - this.smoothedOffset.x);
    this.smoothedOffset.y += alphaOffset * (this.uiOffsetWorld.y - this.smoothedOffset.y);
    this.smoothedOffset.z += alphaOffset * (this.uiOffsetWorld.z - this.smoothedOffset.z);

    this.smoothedPitchRad += alphaPitch * (this.pitchOffsetRad - this.smoothedPitchRad);
  }

  public copyOffset(): Vec3Like {
    return copyVec(this.uiOffsetWorld);
  }

  public copySmoothedOffset(): Vec3Like {
    return copyVec(this.smoothedOffset);
  }

  public getYawRad(): number {
    return this.yawOffsetRad;
  }

  public getPitchOffsetRad(): number {
    return this.pitchOffsetRad;
  }

  public getSmoothedPitchRad(): number {
    return this.smoothedPitchRad;
  }

  public setYawRad(value: number): void {
    this.yawOffsetRad = this.wrapPi(value);
  }

  public accumulateWorldDelta(delta: Vec3Like): void {
    this.uiOffsetWorld.x -= delta.x;
    this.uiOffsetWorld.y = clamp(this.uiOffsetWorld.y - delta.y, Y_OFFSET_MIN, Y_OFFSET_MAX);
    this.uiOffsetWorld.z -= delta.z;
  }

  public applyYawAdjust(newYawRad: number, adjust: Vec3Like): void {
    this.yawOffsetRad = this.wrapPi(newYawRad);
    adjust.x = -adjust.x;
    adjust.y = -adjust.y;
    adjust.z = -adjust.z;

    this.accumulateWorldDelta(adjust);
  }

  public nudgePitchLocal(deltaPitchRad: number): void {
    this.pitchOffsetRad = clamp(this.pitchOffsetRad + deltaPitchRad, -PITCH_LIMIT_RAD, PITCH_LIMIT_RAD);
  }

  public resetOffset(): void {
    const clampedY = clamp(this.uiOffsetWorld.y, Y_OFFSET_MIN, Y_OFFSET_MAX);
    this.uiOffsetWorld.x = 0;
    this.uiOffsetWorld.y = clampedY;
    this.uiOffsetWorld.z = 0;
  }

  public resetAll(): void {
    this.uiOffsetWorld.x = 0;
    this.uiOffsetWorld.y = 0;
    this.uiOffsetWorld.z = 0;
    this.smoothedOffset.x = 0;
    this.smoothedOffset.y = 0;
    this.smoothedOffset.z = 0;
    this.pitchOffsetRad = 0;
    this.smoothedPitchRad = 0;
    this.yawOffsetRad = 0;
    this.lastUpdateNs = 0;
  }

  public magnitude(): number {
    return Math.hypot(this.uiOffsetWorld.x, this.uiOffsetWorld.y, this.uiOffsetWorld.z);
  }

  public hasHorizontalOffset(epsilon: number): boolean {
    const mag = Math.hypot(this.uiOffsetWorld.x, this.uiOffsetWorld.z);
    return mag > epsilon;
  }

  private wrapPi(value: number): number {
    const pi = Math.PI;
    let yaw = value;
    while (yaw <= -pi) yaw += 2 * pi;
    while (yaw > pi) yaw -= 2 * pi;
    return yaw;
  }
}
