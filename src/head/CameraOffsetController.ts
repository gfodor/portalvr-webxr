import type { Vec3Like } from '../types/geometry.js';

export const Y_OFFSET_MIN = -0.5;
export const Y_OFFSET_MAX = 1.5;

const PITCH_LIMIT_RAD = (85 * Math.PI) / 180;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function copyVec(vec: Vec3Like): Vec3Like {
  return { x: vec.x, y: vec.y, z: vec.z };
}

export class CameraOffsetController {
  private readonly uiOffsetWorld: Vec3Like = { x: 0, y: 0, z: 0 };

  private pitchOffsetRad = 0;

  private yawOffsetRad = 0;

  public copyOffset(): Vec3Like {
    return copyVec(this.uiOffsetWorld);
  }

  public getYawRad(): number {
    return this.yawOffsetRad;
  }

  public getPitchOffsetRad(): number {
    return this.pitchOffsetRad;
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
    this.pitchOffsetRad = 0;
    this.yawOffsetRad = 0;
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
