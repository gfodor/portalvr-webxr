/**
 * Face tracking + head pose module
 * --------------------------------
 * Engine-agnostic outputs suitable for VV, three.js, etc.
 *
 * Emits:
 *  - eyeCenterCm: average of left/right iris centers in centimeters, camera frame
 *  - leftIrisCm/rightIrisCm: individual iris positions in centimeters
 *  - headQuat: absolute head orientation (from MediaPipe facial transformation matrix)
 *  - neutralQuat: user-calibrated neutral head orientation
 *  - deltaQuat: headQuat * conjugate(neutralQuat)
 *  - faceVisible: boolean
 *
 * Coordinate frame (centimeters):
 *  - +X: right     (screen-right)
 *  - +Y: up        (screen-up)
 *  - +Z: forward   (towards the camera)
 *
 * NOTE: You are expected to map these outputs to your renderer.
 * For three.js, see `lib/updatePortalCamera.ts` (already in this repo).
 */

import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export type OneEuroParams = {
  /** Base cutoff frequency in Hz (lower -> stronger smoothing) */
  minCutoff: number;
  /** Speed coefficient (higher -> less smoothing when moving faster) */
  beta: number;
  /** Derivative cutoff frequency in Hz */
  dCutoff: number;
};

export type FaceTrackerConfig = {
  /** Webcam horizontal FOV in degrees. Defaults to 60 if not provided. */
  hfovDeg?: number;
  /** MediaPipe wasm path. Defaults to CDN if not provided. */
  wasmPath?: string;
  /** MediaPipe face landmarker model path. Defaults to latest float16 if not provided. */
  modelAssetPath?: string;
  /** Number of faces (we use 1). */
  numFaces?: number;
  /** Initial One-Euro params (optional). */
  smooth?: OneEuroParams;
  /**
   * Exponential distance smoothing base (same math as the page: 1 - base^dt).
   * Default: 0.99
   */
  distanceSmoothingBase?: number;
};

export type FaceTrackerOutputs = {
  faceVisible: boolean;
  leftIrisCm: Vec3 | null;
  rightIrisCm: Vec3 | null;
  eyeCenterCm: Vec3 | null;
  headQuat: Quat | null;
  neutralQuat: Quat | null;
  deltaQuat: Quat | null;
  timestampMs: number;
};

// ---------------- Math helpers ----------------

const quatNormalize = (q: Quat): Quat => {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};
const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const quatMultiply = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const quatFromMat4 = (m: Float32Array | number[]): Quat => {
  const m00 = m[0], m01 = m[1], m02 = m[2];
  const m10 = m[4], m11 = m[5], m12 = m[6];
  const m20 = m[8], m21 = m[9], m22 = m[10];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return quatNormalize(q);
};

// --------------- One-Euro filters --------------

class OneEuro1D {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private xHat: number | null = null;
  private dxHat = 0;
  private tPrev: number | null = null;

  constructor(params: OneEuroParams) {
    this.minCutoff = params.minCutoff;
    this.beta = params.beta;
    this.dCutoff = params.dCutoff;
  }
  private alpha(dt: number, cutoff: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / Math.max(dt, 1e-6));
  }
  private lowpass(prev: number, value: number, a: number): number {
    return a * value + (1 - a) * prev;
  }
  updateParams(params: OneEuroParams) {
    this.minCutoff = params.minCutoff;
    this.beta = params.beta;
    this.dCutoff = params.dCutoff;
  }
  filter(value: number, t: number): number {
    if (this.xHat === null || this.tPrev === null) {
      this.xHat = value;
      this.dxHat = 0;
      this.tPrev = t;
      return value;
    }
    const dt = Math.max(t - this.tPrev, 1e-3);
    const derivative = (value - this.xHat) / dt;
    const aD = this.alpha(dt, this.dCutoff);
    this.dxHat = this.lowpass(this.dxHat, derivative, aD);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxHat);
    const a = this.alpha(dt, cutoff);
    this.xHat = this.lowpass(this.xHat, value, a);
    this.tPrev = t;
    return this.xHat;
  }
}

class OneEuro3D {
  x = new OneEuro1D({ minCutoff: 1.0, beta: 0.0, dCutoff: 1.0 });
  y = new OneEuro1D({ minCutoff: 1.0, beta: 0.0, dCutoff: 1.0 });
  z = new OneEuro1D({ minCutoff: 1.0, beta: 0.0, dCutoff: 1.0 });
  updateParams(params: OneEuroParams) {
    this.x.updateParams(params);
    this.y.updateParams(params);
    this.z.updateParams(params);
  }
  filter(pt: { x: number; y: number; z?: number }, t: number) {
    return {
      x: this.x.filter(pt.x, t),
      y: this.y.filter(pt.y, t),
      z: pt.z !== undefined ? this.z.filter(pt.z, t) : undefined,
    };
  }
}

// --------------- Tracking internals ------------

type DetectedLandmark = { x: number; y: number; z?: number };
type Pt2 = { x: number; y: number };
type Iris = { center: Pt2; edges: Pt2[] };

const RIGHT_IRIS_INDICES = [468, 469, 470, 471, 472];
const LEFT_IRIS_INDICES = [473, 474, 475, 476, 477];
const REQUIRED_LANDMARK_INDICES = [...RIGHT_IRIS_INDICES, ...LEFT_IRIS_INDICES];

const DEFAULTS = {
  FOV_DEG: 60,
  WASM_PATH: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
  MODEL_PATH:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  DISTANCE_BASE: 0.99,
};

function focalLengthPixels(imageWidthPx: number, hFovDeg: number) {
  const a = (hFovDeg * Math.PI) / 180;
  return imageWidthPx / (2 * Math.tan(a / 2));
}
function toIris(landmarks: DetectedLandmark[] | undefined | null): Iris | null {
  if (!landmarks || landmarks.length < 5) return null;
  return {
    center: { x: landmarks[0].x, y: landmarks[0].y },
    edges: landmarks.slice(1, 5).map(({ x, y }) => ({ x, y })),
  };
}
function irisDistance(iris: Iris, video: HTMLVideoElement, hFovDeg: number): number {
  const IRIS_DIAMETER_MM = 11.7; // average
  const dx =
    ((iris.edges[0].x - iris.edges[2].x) + (iris.edges[1].x - iris.edges[3].x)) / 2.0 *
    video.videoWidth;
  const dy =
    ((iris.edges[0].y - iris.edges[2].y) + (iris.edges[1].y - iris.edges[3].y)) / 2.0 *
    video.videoHeight;
  const irisSize = Math.sqrt(dx * dx + dy * dy);
  const fpx = focalLengthPixels(video.videoWidth, hFovDeg);
  const irisDiamCm = IRIS_DIAMETER_MM / 10;
  return (fpx * irisDiamCm) / Math.max(irisSize, 1e-6);
}
function irisPosition(
  iris: Iris,
  distanceCm: number,
  video: HTMLVideoElement,
  hFovDeg: number,
): Vec3 {
  const W = video.videoWidth;
  const H = video.videoHeight;
  const fpx = focalLengthPixels(W, hFovDeg);
  const u = iris.center.x;
  const v = iris.center.y;
  const x = -(u * W - W / 2) * distanceCm / fpx;
  const y = -(v * H - H / 2) * distanceCm / fpx;
  const z = distanceCm;
  return { x, y, z };
}

// --------------- Public class ------------------

export class FaceTracker {
  private cfg: Required<FaceTrackerConfig>;
  private detector: FaceLandmarker | null = null;
  private detectorReady = false;
  private detectionInFlight = false;

  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId = 0;

  private filters = new Map<number, OneEuro3D>();
  private euroParams: OneEuroParams = { minCutoff: 5, beta: 75, dCutoff: 5 };

  private lastTime = -1;
  private lastVideoTime = -1;

  private irisDistRight: number | null = null;
  private irisDistLeft: number | null = null;

  private neutralQuat: Quat | null = null;

  private listeners = new Set<(o: FaceTrackerOutputs) => void>();

  constructor(config: FaceTrackerConfig = {}) {
    this.cfg = {
      hfovDeg: config.hfovDeg ?? DEFAULTS.FOV_DEG,
      wasmPath: config.wasmPath ?? DEFAULTS.WASM_PATH,
      modelAssetPath: config.modelAssetPath ?? DEFAULTS.MODEL_PATH,
      numFaces: config.numFaces ?? 1,
      smooth: config.smooth ?? { minCutoff: 5, beta: 75, dCutoff: 5 },
      distanceSmoothingBase: config.distanceSmoothingBase ?? DEFAULTS.DISTANCE_BASE,
    };
    this.euroParams = { ...this.cfg.smooth };
  }

  setFiltering(params: OneEuroParams) {
    this.euroParams = { ...params };
    for (const f of this.filters.values()) f.updateParams(this.euroParams);
  }

  calibrateNeutral() {
    // Will be set on next successful headQuat
    if (this.lastHeadQuat) {
      this.neutralQuat = quatNormalize(this.lastHeadQuat);
    }
  }

  onUpdate(cb: (o: FaceTrackerOutputs) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async start(videoEl: HTMLVideoElement) {
    this.video = videoEl;
    await this.initDetector();
    this.ensureFilters();
    this.running = true;
    this.lastTime = -1;
    this.lastVideoTime = -1;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.detectionInFlight = false;
    this.clearFilters();

    const detector = this.detector;
    this.detector = null;
    this.detectorReady = false;
    detector?.close?.();

    this.video = null;
    this.irisDistRight = null;
    this.irisDistLeft = null;
    this.neutralQuat = null;
    this.lastHeadQuat = null;
  }

  // ------------- internals -------------

  private lastHeadQuat: Quat | null = null;

  private ensureFilters() {
    for (const index of REQUIRED_LANDMARK_INDICES) {
      if (!this.filters.has(index)) {
        const f = new OneEuro3D();
        f.updateParams(this.euroParams);
        this.filters.set(index, f);
      }
    }
  }
  private clearFilters() {
    this.filters.clear();
  }

  private emit(o: FaceTrackerOutputs) {
    for (const cb of this.listeners) {
      try {
        cb(o);
      } catch {}
    }
  }

  private initDetector = async () => {
    const mp = await import('@mediapipe/tasks-vision');
    const { FilesetResolver, FaceLandmarker } = mp;
    const vision = await FilesetResolver.forVisionTasks(this.cfg.wasmPath);
    const baseOptions = { modelAssetPath: this.cfg.modelAssetPath, delegate: 'GPU' as const };
    const options = {
      baseOptions,
      runningMode: 'VIDEO' as const,
      numFaces: this.cfg.numFaces,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    };

    try {
      this.detector = await FaceLandmarker.createFromOptions(vision, options);
      this.detectorReady = true;
      // eslint-disable-next-line no-console
      console.info('[FaceTracker] FaceLandmarker using GPU');
    } catch (gpuError) {
      // fallback to CPU
      this.detector = await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: this.cfg.modelAssetPath, delegate: 'CPU' },
      });
      this.detectorReady = true;
      const reason =
        gpuError instanceof Error ? gpuError.message : String(gpuError ?? 'unknown');
      // eslint-disable-next-line no-console
      console.info(`[FaceTracker] FaceLandmarker using CPU (fallback: ${reason})`);
    }
  };

  private processDetection = (
    result: FaceLandmarkerResult | undefined,
    timestampMs: number,
  ) => {
    const faces = result?.faceLandmarks;
    if (!faces || faces.length === 0) {
      this.clearFilters();
      this.emit({
        faceVisible: false,
        leftIrisCm: null,
        rightIrisCm: null,
        eyeCenterCm: null,
        headQuat: null,
        neutralQuat: this.neutralQuat,
        deltaQuat: null,
        timestampMs,
      });
      return;
    }

    this.ensureFilters();

    const landmarks = faces[0] as DetectedLandmark[];
    const tSec = timestampMs / 1000.0;

    const rightSmoothed = RIGHT_IRIS_INDICES.map((i) =>
      this.filters.get(i)!.filter(landmarks[i], tSec),
    );
    const leftSmoothed = LEFT_IRIS_INDICES.map((i) =>
      this.filters.get(i)!.filter(landmarks[i], tSec),
    );

    const videoEl = this.video!;
    const irisRight = toIris(rightSmoothed as DetectedLandmark[]);
    const irisLeft = toIris(leftSmoothed as DetectedLandmark[]);
    let eyeCenter: Vec3 | null = null;
    let leftCm: Vec3 | null = null;
    let rightCm: Vec3 | null = null;

    if (irisRight && irisLeft) {
      const irisTargetDistRight = irisDistance(irisRight, videoEl, this.cfg.hfovDeg);
      const irisTargetDistLeft = irisDistance(irisLeft, videoEl, this.cfg.hfovDeg);

      const now = performance.now();
      const dt = this.lastTime >= 0 ? now - this.lastTime : 16.67;
      this.lastTime = now;

      const distanceDecay = 1.0 - Math.pow(this.cfg.distanceSmoothingBase, dt);

      const rPrev = this.irisDistRight;
      const lPrev = this.irisDistLeft;

      const rSm =
        rPrev != null
          ? rPrev + (irisTargetDistRight - rPrev) * distanceDecay
          : irisTargetDistRight;
      const lSm =
        lPrev != null
          ? lPrev + (irisTargetDistLeft - lPrev) * distanceDecay
          : irisTargetDistLeft;

      this.irisDistRight = rSm;
      this.irisDistLeft = lSm;

      const minDist = Math.min(rSm, lSm);

      rightCm = irisPosition(irisRight, minDist, videoEl, this.cfg.hfovDeg);
      leftCm = irisPosition(irisLeft, minDist, videoEl, this.cfg.hfovDeg);
      eyeCenter = {
        x: (rightCm.x + leftCm.x) / 2,
        y: (rightCm.y + leftCm.y) / 2,
        z: (rightCm.z + leftCm.z) / 2,
      };
    }

    let headQuat: Quat | null = null;
    let deltaQuat: Quat | null = null;

    const mats = (result as any)?.facialTransformationMatrixes;
    if (mats && mats.length > 0 && mats[0]?.data && mats[0].data.length >= 16) {
      headQuat = quatFromMat4(mats[0].data as Float32Array);
      this.lastHeadQuat = headQuat;
      if (!this.neutralQuat) {
        this.neutralQuat = quatNormalize(headQuat);
      }
      if (this.neutralQuat) {
        deltaQuat = quatMultiply(
          quatNormalize(headQuat),
          quatConjugate(this.neutralQuat),
        );
      }
    }

    this.emit({
      faceVisible: !!eyeCenter,
      leftIrisCm: leftCm,
      rightIrisCm: rightCm,
      eyeCenterCm: eyeCenter,
      headQuat,
      neutralQuat: this.neutralQuat,
      deltaQuat,
      timestampMs,
    });
  };

  private runDetection = async (timestampMs: number) => {
    const detector = this.detector;
    const videoEl = this.video;
    if (!detector || !videoEl) return;

    this.detectionInFlight = true;
    try {
      const detectorWithAsync = detector as FaceLandmarker & {
        detectAsync?: (
          video: HTMLVideoElement,
          timestamp: number,
        ) => Promise<FaceLandmarkerResult>;
      };
      const result =
        typeof detectorWithAsync.detectAsync === 'function'
          ? await detectorWithAsync.detectAsync.call(detector, videoEl, timestampMs)
          : detector.detectForVideo(videoEl, timestampMs);
      this.processDetection(result, timestampMs);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[FaceTracker] detection failed', err);
    } finally {
      this.detectionInFlight = false;
    }
  };

  private loop = () => {
    if (!this.running) return;

    const videoEl = this.video;
    if (
      videoEl &&
      this.detectorReady &&
      this.detector &&
      !this.detectionInFlight &&
      videoEl.currentTime !== this.lastVideoTime
    ) {
      const ts = Math.round(videoEl.currentTime * 1000);
      void this.runDetection(ts);
      this.lastVideoTime = videoEl.currentTime;
    }

    this.rafId = requestAnimationFrame(this.loop);
  };
}
