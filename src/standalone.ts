import WebXRPolyfill from 'webxr-polyfill';

import { XRDevice } from './device/XRDevice.js';
import { metaQuest3 } from './device/configs/headset/meta.js';
import { getPortalPoseWasmDataURL } from './wasm/portal-pose/portal_pose_embed.js';

const GLOBAL_STATE_KEY = '__PORTALVR_META_QUEST3_EMULATOR__';

type StandaloneState = {
  device: XRDevice;
  initializedAt: number;
};

function storeState(device: XRDevice) {
  (globalThis as Record<string, unknown>)[GLOBAL_STATE_KEY] = {
    device,
    initializedAt: Date.now(),
  } satisfies StandaloneState;
}

function getState(): StandaloneState | null {
  const raw = (globalThis as Record<string, unknown>)[GLOBAL_STATE_KEY];
  if (raw && typeof raw === 'object' && 'device' in raw) {
    return raw as StandaloneState;
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

async function installEmulator(): Promise<XRDevice | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const existing = getState();
  if (existing) {
    return existing.device;
  }

  const nativeImmersive = await detectImmersiveVRSupport();
  if (nativeImmersive) {
    return null;
  }

  ensurePolyfillInstalled(true);

  const device = new XRDevice(metaQuest3);
  device.stereoEnabled = true;
  device.installRuntime({
    enforce: true,
  });
  device.enablePortalPoseCamera({
    wasmDataUrl: getPortalPoseWasmDataURL(),
  });

  storeState(device);
  return device;
}

void installEmulator().catch((error) => {
  console.error('[PortalVR Standalone] Failed to install emulator', error);
});
