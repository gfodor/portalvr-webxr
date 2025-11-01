import type { PortalPoseModuleInstance } from '../../src/wasm/portal-pose/portal_pose.js';

export interface PortalPoseLoadOptions {
  wasmBaseURL?: string;
  locateFile?: (path: string, prefix: string) => string;
  [key: string]: unknown;
}

const HEAP_SIZE_FLOATS = 512;
const heap = new Float32Array(HEAP_SIZE_FLOATS);
let nextPtrBytes = 0;

const asModuleInstance: PortalPoseModuleInstance = {
  HEAPF32: heap,
  _malloc(sizeBytes: number): number {
    const ptr = nextPtrBytes;
    nextPtrBytes += sizeBytes;
    if ((nextPtrBytes >>> 2) >= HEAP_SIZE_FLOATS) {
      throw new Error('mock portal pose heap exhausted');
    }
    return ptr;
  },
  _free() {
    // no-op for tests
  },
  _portal_wasm_head_offset_calculate_nudge_delta(
    _dx: number,
    _dy: number,
    _dz: number,
    _smoothedQuatPtr: number,
    _currentYaw: number,
    _currentPitch: number,
    _cameraPitch: number,
    _cameraPitchSin: number,
    _fixedDisplayLocked: number,
    deltaPtr: number,
  ): boolean {
    const base = deltaPtr >>> 2;
    heap[base] = 0;
    heap[base + 1] = 0;
    heap[base + 2] = 0;
    return true;
  },
  _portal_wasm_head_calculate_yaw_nudge(
    currentYaw: number,
    _uiOffsetPtr: number,
    dYawRad: number,
    _smoothedPosPtr: number,
    _currentFinalPosPtr: number,
    _yOffsetMin: number,
    _yOffsetMax: number,
    yawResultPtr: number,
    deltaPtr: number,
  ): boolean {
    heap[yawResultPtr >>> 2] = currentYaw + dYawRad;
    const base = deltaPtr >>> 2;
    heap[base] = 0;
    heap[base + 1] = 0;
    heap[base + 2] = 0;
    return true;
  },
  _portal_wasm_head_compose_final_pose(
    smoothedPosPtr: number,
    smoothedQuatPtr: number,
    _yawRad: number,
    _pitchRad: number,
    _uiOffsetPtr: number,
    posePtr: number,
  ) {
    copyHeap(smoothedQuatPtr, posePtr, 4);
    copyHeap(smoothedPosPtr, posePtr + 16, 3);
  },
} as unknown as PortalPoseModuleInstance;

function copyHeap(srcPtr: number, destPtr: number, count: number) {
  const src = srcPtr >>> 2;
  const dest = destPtr >>> 2;
  for (let i = 0; i < count; i += 1) {
    heap[dest + i] = heap[src + i] ?? 0;
  }
}

export async function loadPortalPoseModule(
  _options: PortalPoseLoadOptions = {},
): Promise<PortalPoseModuleInstance> {
  return asModuleInstance;
}

export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export const DEFAULT_CAMERA_PITCH_RAD = 0;

