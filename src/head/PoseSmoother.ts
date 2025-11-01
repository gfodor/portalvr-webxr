import { OneEuroFilter } from './OneEuroFilter.js';
import { logToQuat, quatToLog } from './QuaternionUtils.js';

export type PoseArray = [number, number, number, number, number, number, number];

export enum PoseSmootherMode {
  HIGH = 'HIGH',
  LOW = 'LOW',
  VERY_HIGH = 'VERY_HIGH',
}

interface PoseSample {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  tNs: number;
  recordedNs: number;
}

function nowNs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() * 1e6;
  }
  return Date.now() * 1e6;
}

export class PoseSmoother {
  public static ENABLE_SMOOTHING = true;

  private mode: PoseSmootherMode = PoseSmootherMode.LOW;
  private lastVelocity = 0;

  private readonly buffer: PoseSample[] = [];

  private readonly euroX: OneEuroFilter;
  private readonly euroY: OneEuroFilter;
  private readonly euroZ: OneEuroFilter;
  private readonly rotX: OneEuroFilter;
  private readonly rotY: OneEuroFilter;
  private readonly rotZ: OneEuroFilter;

  constructor(displayHz = 90, private readonly latencyFrames = 0) {
    const freq = Math.max(1, displayHz);
    this.euroX = new OneEuroFilter(freq, 1.0, 250.0, 1.0);
    this.euroY = new OneEuroFilter(freq, 1.0, 250.0, 1.0);
    this.euroZ = new OneEuroFilter(freq, 1.0, 250.0, 1.0);
    this.rotX = new OneEuroFilter(freq, 1.0, 10.0, 1.0);
    this.rotY = new OneEuroFilter(freq, 1.0, 10.0, 1.0);
    this.rotZ = new OneEuroFilter(freq, 1.0, 10.0, 1.0);
  }

  public setMode(newMode: PoseSmootherMode): void {
    if (newMode === this.mode) {
      return;
    }
    this.mode = newMode;
    const beta = (() => {
      switch (newMode) {
        case PoseSmootherMode.VERY_HIGH:
          return 0.001;
        case PoseSmootherMode.HIGH:
          return 1.0;
        case PoseSmootherMode.LOW:
        default:
          return 75.0;
      }
    })();
    this.euroX.setBeta(beta);
    this.euroY.setBeta(beta);
    this.euroZ.setBeta(beta);
    this.rotX.setBeta(beta);
    this.rotY.setBeta(beta);
    this.rotZ.setBeta(beta);
  }

  public getMode(): PoseSmootherMode {
    return this.mode;
  }

  public addSample(
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    tNs: number,
  ): void {
    let posX = px;
    let posY = py;
    let posZ = pz;

    if (this.buffer.length > 0) {
      const maxLinVel = 15;
      const maxLinAcc = 50;

      const last = this.buffer[this.buffer.length - 1];
      const dt = Math.max((tNs - last.tNs) * 1e-9, 1e-9);
      const dx = px - last.x;
      const dy = py - last.y;
      const dz = pz - last.z;
      const linVel = Math.hypot(dx, dy, dz) / dt;
      const linAcc = Math.abs(linVel - this.lastVelocity) / dt;

      const rejectPosition = tNs !== last.tNs && (linVel >= maxLinVel || linAcc >= maxLinAcc);
      if (rejectPosition) {
        posX = last.x;
        posY = last.y;
        posZ = last.z;
      } else {
        this.lastVelocity = linVel;
      }

      const dot = qx * last.qx + qy * last.qy + qz * last.qz + qw * last.qw;
      if (dot < 0) {
        qx = -qx;
        qy = -qy;
        qz = -qz;
        qw = -qw;
      }
    } else {
      this.lastVelocity = 0;
    }

    this.buffer.push({
      x: posX,
      y: posY,
      z: posZ,
      qx,
      qy,
      qz,
      qw,
      tNs,
      recordedNs: nowNs(),
    });

    const maxSamples = Math.max(this.latencyFrames + 1, 2);
    if (this.buffer.length > maxSamples) {
      this.buffer.shift();
    }
  }

  public translateHistory(dx: number, dy: number, dz: number): void {
    if (dx === 0 && dy === 0 && dz === 0) {
      return;
    }
    if (this.buffer.length === 0) {
      return;
    }
    for (let i = 0; i < this.buffer.length; i++) {
      const sample = this.buffer[i];
      this.buffer[i] = {
        ...sample,
        x: sample.x + dx,
        y: sample.y + dy,
        z: sample.z + dz,
      };
    }
    this.euroX.shift(dx);
    this.euroY.shift(dy);
    this.euroZ.shift(dz);
  }

  public reset(initialPose?: PoseArray, timestampNs?: number): void {
    this.buffer.length = 0;
    this.lastVelocity = 0;
    const filters = [this.euroX, this.euroY, this.euroZ, this.rotX, this.rotY, this.rotZ];
    filters.forEach((filter) => filter.reset());
    if (initialPose) {
      const tNs = timestampNs ?? nowNs();
      this.addSample(
        initialPose[0],
        initialPose[1],
        initialPose[2],
        initialPose[3],
        initialPose[4],
        initialPose[5],
        initialPose[6],
        tNs,
      );
    }
  }

  public predict(nowTimestampNs = nowNs()): PoseArray | null {
    if (!PoseSmoother.ENABLE_SMOOTHING) {
      const newest = this.buffer[this.buffer.length - 1];
      if (!newest) {
        return null;
      }
      return [
        newest.x,
        newest.y,
        newest.z,
        newest.qx,
        newest.qy,
        newest.qz,
        newest.qw,
      ];
    }

    if (this.buffer.length < 2) {
      return null;
    }

    const newest = this.buffer[this.buffer.length - 1];
    const timeSeconds = nowTimestampNs * 1e-9;

    const smX = this.euroX.filter(newest.x, timeSeconds);
    const smY = this.euroY.filter(newest.y, timeSeconds);
    const smZ = this.euroZ.filter(newest.z, timeSeconds);

    const [logX, logY, logZ] = quatToLog(newest.qx, newest.qy, newest.qz, newest.qw);
    const smRx = this.rotX.filter(logX, timeSeconds);
    const smRy = this.rotY.filter(logY, timeSeconds);
    const smRz = this.rotZ.filter(logZ, timeSeconds);
    const [qx, qy, qz, qw] = logToQuat(smRx, smRy, smRz);

    return [smX, smY, smZ, qx, qy, qz, qw];
  }
}
