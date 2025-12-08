import type { PortalPoseModuleConfig, PortalPoseModuleInstance } from './portal-pose/portal_pose.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- the JS factory function is provided at runtime from the copied asset.
import PortalPoseModule from './portal-pose/portal_pose.js';
import { setNativePoseSmootherModule } from '../head/NativePoseSmoother.js';

const DEFAULT_CAMERA_PITCH_DEG = 0;

let modulePromise: Promise<PortalPoseModuleInstance> | null = null;

export interface PortalPoseLoadOptions extends PortalPoseModuleConfig {
  /** Optional absolute or relative URL that points to the directory containing portal_pose.wasm. */
  wasmBaseURL?: string;
  /** Optional data URL (or absolute URL) representing the portal_pose.wasm binary. */
  wasmDataUrl?: string;
}

export async function loadPortalPoseModule(
  options: PortalPoseLoadOptions = {},
): Promise<PortalPoseModuleInstance> {
  if (!modulePromise) {
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[PortalPoseLoader] PortalPoseModule typeof', typeof PortalPoseModule);
    }
    modulePromise = PortalPoseModule({
      ...options,
      locateFile: (path, prefix) => {
        if (path.endsWith('.wasm')) {
          if (options.wasmDataUrl) {
            return options.wasmDataUrl;
          }
          if (options.locateFile) {
            return options.locateFile(path, prefix);
          }
          if (options.wasmBaseURL) {
            return `${options.wasmBaseURL.replace(/\/$/, '')}/${path}`;
          }
          if (path === 'portal_pose.wasm') {
            const assetUrl = new URL('./portal-pose/portal_pose.wasm', import.meta.url);
            return assetUrl.href;
          }
          const fallback = new URL(`./portal-pose/${path}`, import.meta.url);
          return fallback.href;
        }
        return options.locateFile ? options.locateFile(path, prefix) : path;
      },
    } as PortalPoseModuleConfig).then((mod) => {
      // Initialize the native pose smoother module for use by NativePoseSmoother
      setNativePoseSmootherModule(mod);
      return mod;
    });
  }
  return modulePromise;
}

export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export const DEFAULT_CAMERA_PITCH_RAD = degreesToRadians(DEFAULT_CAMERA_PITCH_DEG);
