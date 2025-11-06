import WebXRPolyfill from 'webxr-polyfill';

import {
  XRDevice,
  type DevUIConstructor,
} from './device/XRDevice.js';
import { metaQuest3 } from './device/configs/headset/meta.js';
import { getPortalPoseWasmDataURL } from './wasm/portal-pose/portal_pose_embed.js';
import { DevUI as PortalVRDevUI } from '../devui/lib/index.js';

const GLOBAL_STATE_KEY = '__PORTALVR_META_QUEST3_EMULATOR__';

type StandaloneState = {
  device: XRDevice;
  devUIInstalled: boolean;
  initializedAt: number;
};

export interface StandaloneOptions {
  /**
   * Forces reinstallation even if a previous device is cached.
   */
  forceReinstall?: boolean;
  /**
   * Skips detection of native immersive support. Useful for testing browser overrides.
   */
  skipNativeImmersiveCheck?: boolean;
  /**
   * Controls whether installRuntime is called with enforce=true.
   */
  enforceRuntime?: boolean;
  /**
   * Provides an alternative DevUI implementation. Set to null to disable.
   */
  devUIConstructor?: DevUIConstructor | null;
  /**
   * Controls whether the DevUI should be installed. Defaults to true.
   */
  installDevUI?: boolean;
  /**
   * Controls whether the Portal Pose camera integration is enabled.
   */
  enablePortalPoseCamera?: boolean;
  /**
   * Optionally override the Portal Pose WASM URL.
   */
  wasmDataUrl?: string;
  /**
   * Forces the polyfill to instantiate even if navigator.xr exists.
   */
  forcePolyfill?: boolean;
}

function storeState(state: StandaloneState) {
  (globalThis as Record<string, unknown>)[GLOBAL_STATE_KEY] = state;
}

export function getStandaloneState(): StandaloneState | null {
  const raw = (globalThis as Record<string, unknown>)[GLOBAL_STATE_KEY];
  if (raw && typeof raw === 'object' && 'device' in raw) {
    const state = raw as Partial<StandaloneState>;
    return {
      device: state.device as XRDevice,
      devUIInstalled: Boolean(state.devUIInstalled),
      initializedAt: state.initializedAt ?? Date.now(),
    };
  }
  return null;
}

async function detectImmersiveVRSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.xr) {
    return false;
  }
  try {
    return await navigator.xr.isSessionSupported('immersive-vr');
  } catch (_err) {
    return false;
  }
}

function ensurePolyfillInstalled(force = false) {
  if (typeof navigator === 'undefined') {
    return;
  }
  if (!force && navigator.xr) {
    return;
  }
  // Instantiate polyfill synchronously if available.
  if (typeof WebXRPolyfill === 'function') {
    // eslint-disable-next-line no-new
    new WebXRPolyfill();
  }
}

function markCustomPolyfillFlag() {
  if (typeof window === 'undefined') {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore Assign global flag used by reference implementations.
  window.CustomWebXRPolyfill = true;
}

function resolveDevUIConstructor(
  options: StandaloneOptions,
): DevUIConstructor | null {
  if (options.installDevUI === false) {
    return null;
  }
  if (options.devUIConstructor === null) {
    return null;
  }
  if (options.devUIConstructor) {
    return options.devUIConstructor;
  }
  return PortalVRDevUI as unknown as DevUIConstructor;
}

export async function bootstrapStandaloneEmulator(
  options: StandaloneOptions = {},
): Promise<XRDevice | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!options.forceReinstall) {
    const existing = getStandaloneState();
    if (existing) {
      return existing.device;
    }
  }

  if (!options.skipNativeImmersiveCheck) {
    const nativeImmersive = await detectImmersiveVRSupport();
    if (nativeImmersive) {
      return null;
    }
  }

  ensurePolyfillInstalled(options.forcePolyfill ?? true);
  markCustomPolyfillFlag();

  const device = new XRDevice(metaQuest3);
  device.installRuntime({
    enforce: options.enforceRuntime ?? true,
  });

  const devUIConstructor = resolveDevUIConstructor(options);
  if (devUIConstructor) {
    device.installDevUI(devUIConstructor);
  }

  if (options.enablePortalPoseCamera ?? true) {
    device.enablePortalPoseCamera({
      wasmDataUrl: options.wasmDataUrl ?? getPortalPoseWasmDataURL(),
    });
  }

  storeState({
    device,
    devUIInstalled: Boolean(devUIConstructor),
    initializedAt: Date.now(),
  });

  return device;
}

void bootstrapStandaloneEmulator().catch((error) => {
  console.error('[PortalVR Standalone] Failed to install emulator', error);
});
