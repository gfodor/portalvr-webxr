import WebXRPolyfill from 'webxr-polyfill';

import {
  XRDevice,
  type DevUIConstructor,
} from './device/XRDevice.js';
import type { XRSystem as PortalXRSystem } from './initialization/XRSystem.js';
import type {
  XRSession,
  XRSessionInit,
  XRSessionMode,
} from './session/XRSession.js';
import { updatePortalEmulatorConfig, type PortalEmulatorConfig } from './device/PortalEmulatorConfig.js';

import { oculusQuest1 } from './device/configs/headset/meta.js';
import { getPortalPoseWasmDataURL } from './wasm/portal-pose/portal_pose_embed.js';
import { DevUI as PortalVRDevUI } from '../devui/lib/index.js';
import { getRuntimeAssetBaseUrl, setEmbeddedAssetFallbackEnabled } from './runtime/RuntimeAssetResolver.js';

const GLOBAL_STATE_KEY = '__PORTALVR_META_QUEST3_EMULATOR__';
const CONTEXT_BRIDGE_DISABLE_GLOBAL = '__PORTALVR_DISABLE_CONTEXT_BRIDGE__';
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:', 'ms-browser-extension:', 'edge-extension:']);
const CONTEXT_BRIDGE_MARKER = '__PORTALVR_CONTEXT_BRIDGE__' as string;
const CONTEXT_BRIDGE_COMPILED_IN = CONTEXT_BRIDGE_MARKER !== 'disabled';
const EXTENSION_RUNTIME_FLAG = '__iweRuntimeInstalled__';
const EXTENSION_RUNTIME_PROMISE_KEY = '__iweRuntimeInstallPromise__';
const EXTENSION_DETECTION_TIMEOUT_MS = 750;
const EXTENSION_DETECTION_POLL_MS = 25;

setEmbeddedAssetFallbackEnabled(true);

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

type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type XRSystemDeviceChangeHandler = ((this: PortalXRSystem, ev: Event) => unknown) | null;

function setDeviceChangeHandler(target: PortalXRSystem, handler: XRSystemDeviceChangeHandler): void {
  const maybeTarget = target as unknown as Record<string, unknown> & {
    ondevicechange?: XRSystemDeviceChangeHandler;
  };
  if ('ondevicechange' in maybeTarget) {
    maybeTarget.ondevicechange = handler;
  }
}

function getDeviceChangeHandler(target: PortalXRSystem): XRSystemDeviceChangeHandler {
  const maybeTarget = target as unknown as Record<string, unknown> & {
    ondevicechange?: XRSystemDeviceChangeHandler;
  };
  if ('ondevicechange' in maybeTarget) {
    return maybeTarget.ondevicechange ?? null;
  }
  return null;
}

class DeferredXRSystem extends EventTarget {
  private resolvedTarget: PortalXRSystem | null = null;
  private pendingDeviceChangeHandler: XRSystemDeviceChangeHandler = null;

  constructor(private readonly targetPromise: Promise<PortalXRSystem>) {
    super();
    this.targetPromise
      .then((target) => {
        this.resolvedTarget = target;
      })
      .catch(() => undefined);
  }

  private forwardCall<T>(fn: (target: PortalXRSystem) => Promise<T>): Promise<T>;
  private forwardCall<T>(fn: (target: PortalXRSystem) => T): Promise<T>;
  private forwardCall<T>(fn: (target: PortalXRSystem) => T | Promise<T>): Promise<T> {
    return this.targetPromise.then((target) => fn(target));
  }

  isSessionSupported(mode: XRSessionMode): Promise<boolean> {
    return this.forwardCall((target) => target.isSessionSupported(mode));
  }

  requestSession(
    mode: XRSessionMode,
    options: XRSessionInit = {},
  ): Promise<XRSession> {
    return this.forwardCall((target) => target.requestSession(mode, options));
  }

  offerSession(
    mode: XRSessionMode,
    options: XRSessionInit = {},
  ): Promise<XRSession> {
    return this.forwardCall((target) => target.offerSession(mode, options));
  }

  addEventListener(
    type: Parameters<EventTarget['addEventListener']>[0],
    listener: Parameters<EventTarget['addEventListener']>[1],
    options?: Parameters<EventTarget['addEventListener']>[2],
  ): void {
    void this.forwardCall((target) => {
      target.addEventListener(type, listener, options);
    });
  }

  removeEventListener(
    type: Parameters<EventTarget['removeEventListener']>[0],
    listener: Parameters<EventTarget['removeEventListener']>[1],
    options?: Parameters<EventTarget['removeEventListener']>[2],
  ): void {
    void this.forwardCall((target) => {
      target.removeEventListener(type, listener, options);
    });
  }

  dispatchEvent(event: Event): boolean {
    if (this.resolvedTarget) {
      return this.resolvedTarget.dispatchEvent(event);
    }
    void this.forwardCall((target) => {
      target.dispatchEvent(event);
    });
    return true;
  }

  get ondevicechange(): XRSystemDeviceChangeHandler {
    if (this.resolvedTarget) {
      return getDeviceChangeHandler(this.resolvedTarget);
    }
    return this.pendingDeviceChangeHandler;
  }

  set ondevicechange(handler: XRSystemDeviceChangeHandler) {
    this.pendingDeviceChangeHandler = handler ?? null;
    void this.forwardCall((target) => {
      setDeviceChangeHandler(target, handler ?? null);
    });
  }

  get [Symbol.toStringTag](): string {
    return 'XRSystem';
  }
}

type NavigatorXRProxyState = {
  nativeXR: PortalXRSystem;
  resolveNative: () => void;
  resolvePortal: (portalXR: PortalXRSystem) => void;
};

let navigatorXRProxyState: NavigatorXRProxyState | null = null;
let navigatorXRProxyFinalized = false;

function getNavigatorXR(): PortalXRSystem | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  return ((navigator as Navigator & { xr?: PortalXRSystem }).xr ?? null) as PortalXRSystem | null;
}

function ensureNavigatorXRProxy(): NavigatorXRProxyState | null {
  if (navigatorXRProxyState || navigatorXRProxyFinalized) {
    return navigatorXRProxyState;
  }
  const nativeXR = getNavigatorXR();
  if (!nativeXR) {
    navigatorXRProxyFinalized = true;
    return null;
  }

  const deferred = createDeferred<PortalXRSystem>();
  const proxy = new DeferredXRSystem(deferred.promise);

  try {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      enumerable: false,
      get: () => proxy,
    });
  } catch (error) {
    console.warn('[PortalVR Standalone] Failed to intercept navigator.xr', error);
    navigatorXRProxyFinalized = true;
    return null;
  }

  let settled = false;
  const cleanup = () => {
    navigatorXRProxyState = null;
    navigatorXRProxyFinalized = true;
  };

  const resolveNative = () => {
    if (settled) {
      return;
    }
    settled = true;
    deferred.resolve(nativeXR);
    try {
      Reflect.deleteProperty(navigator, 'xr');
    } catch {
      try {
        Object.defineProperty(navigator, 'xr', {
          configurable: false,
          enumerable: false,
          get: () => nativeXR,
        });
      } catch {
        (navigator as unknown as Record<string, PortalXRSystem>).xr = nativeXR;
      }
    }
    cleanup();
  };

  const resolvePortal = (portalXR: PortalXRSystem) => {
    if (settled) {
      return;
    }
    settled = true;
    deferred.resolve(portalXR);
    cleanup();
  };

  navigatorXRProxyState = {
    nativeXR,
    resolveNative,
    resolvePortal,
  };
  return navigatorXRProxyState;
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

async function detectImmersiveVRSupport(
  xrSystemOverride?: PortalXRSystem | null,
): Promise<boolean | null> {
  const xrSystem = xrSystemOverride ?? getNavigatorXR();
  if (!xrSystem) {
    return false;
  }
  try {
    return await xrSystem.isSessionSupported('immersive-vr');
  } catch (_err) {
    return null;
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

type GlobalWithFlags = typeof globalThis & Record<string, unknown>;
type ExtensionAwareGlobal = GlobalWithFlags &
  Record<typeof EXTENSION_RUNTIME_FLAG | typeof EXTENSION_RUNTIME_PROMISE_KEY, unknown>;

const CONTEXT_URL = 'https://portalvr.run/context';
const CONTEXT_ORIGIN = (() => {
  try { return new URL(CONTEXT_URL).origin; } catch { return 'https://portalvr.run'; }
})();
const CONTEXT_IFRAME_ID = '__portalvr_context_iframe__';

type ContextBridgeMessage =
  | { scope: 'portalvr'; type: 'portalvr:context-ready' }
  | { scope: 'portalvr'; type: 'portalvr:config'; id?: string; config: PortalEmulatorConfig }
  | { scope: 'portalvr'; type: 'portalvr:ws-event'; id: string; event: 'open'|'message'|'close'|'error'; data?: string; code?: number; reason?: string; error?: string };

let contextIframe: HTMLIFrameElement | null = null;
let contextWindow: Window | null = null;
const ignoreReplyIds = new Set<string>(); // IDs for which config replies should be ignored (echo from our forwarded set-config)
let initialRequestId: string | null = null;
let contextReady = false;

function isBrowserExtensionRuntime(): boolean {
  const baseUrl = getRuntimeAssetBaseUrl();
  if (!baseUrl) {
    return false;
  }
  try {
    const protocol = new URL(baseUrl).protocol;
    return EXTENSION_PROTOCOLS.has(protocol);
  } catch {
    return false;
  }
}

function isContextBridgeGloballyDisabled(): boolean {
  try {
    const globalTarget = globalThis as GlobalWithFlags;
    return Boolean(globalTarget[CONTEXT_BRIDGE_DISABLE_GLOBAL]);
  } catch {
    return false;
  }
}

function shouldInstallContextBridge(): boolean {
  if (isContextBridgeGloballyDisabled()) {
    return false;
  }
  if (isBrowserExtensionRuntime()) {
    return false;
  }
  return true;
}

function hasExtensionRuntimeInstallMarkers(): boolean {
  try {
    const globalTarget = globalThis as ExtensionAwareGlobal;
    if (globalTarget[EXTENSION_RUNTIME_FLAG]) {
      return true;
    }
    if (globalTarget[EXTENSION_RUNTIME_PROMISE_KEY]) {
      return true;
    }
  } catch {
    // ignore access errors
  }
  return false;
}

function isImmersiveWebExtensionDetected(): boolean {
  if (hasExtensionRuntimeInstallMarkers()) {
    return true;
  }
  if (isContextBridgeGloballyDisabled()) {
    return true;
  }
  if (isBrowserExtensionRuntime()) {
    return true;
  }
  return false;
}

function waitForExtensionPresence(
  timeoutMs = EXTENSION_DETECTION_TIMEOUT_MS,
  pollMs = EXTENSION_DETECTION_POLL_MS,
): Promise<boolean> {
  if (isImmersiveWebExtensionDetected()) {
    return Promise.resolve(true);
  }
  if (typeof window === 'undefined' || typeof window.setInterval !== 'function') {
    return Promise.resolve(isImmersiveWebExtensionDetected());
  }
  return new Promise((resolve) => {
    const start = Date.now();
    const intervalId = window.setInterval(() => {
      if (isImmersiveWebExtensionDetected()) {
        window.clearInterval(intervalId);
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        window.clearInterval(intervalId);
        resolve(isImmersiveWebExtensionDetected());
      }
    }, pollMs);
  });
}

function generateRequestId(): string {
  // Quick random ID, fine for message correlation.
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function ensureContextIframeInstalled(): void {
  if (typeof document === 'undefined') return;
  if (contextIframe && contextWindow) return;

  const iframe = document.createElement('iframe');
  iframe.id = CONTEXT_IFRAME_ID;
  iframe.src = CONTEXT_URL;
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.visibility = 'hidden';
  iframe.setAttribute('aria-hidden', 'true');
  // Attach ASAP
  (document.body || document.documentElement).appendChild(iframe);

  contextIframe = iframe;
  contextWindow = iframe.contentWindow ?? null;
}

function postToContext(message: unknown): void {
  try {
    if (contextWindow) {
      contextWindow.postMessage(message, CONTEXT_ORIGIN);
    }
  } catch {
    // ignore post failures
  }
}

function requestInitialConfig(): void {
  initialRequestId = generateRequestId();
  postToContext({ scope: 'portalvr', type: 'portalvr:get-config', id: initialRequestId });
}

function forwardDomConfigEventsToContext(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('portalvr:set-config', (evt: Event) => {
    const custom = evt as CustomEvent<PortalEmulatorConfig | null>;
    const cfg = custom.detail;
    if (!cfg) return;
    const id = generateRequestId();
    ignoreReplyIds.add(id);
    postToContext({ scope: 'portalvr', type: 'portalvr:set-config', id, config: cfg });
  });
}

function applyConfigToRuntime(config: PortalEmulatorConfig): void {
  try {
    updatePortalEmulatorConfig(config);
  } catch {
    // ignore runtime config failures in hardened pages
  }
}

function forwardDomSignalingEventsToContext(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  window.addEventListener('portalvr:ws-open', (evt: Event) => {
    const { id, url } = (evt as CustomEvent<{ id: string; url: string }>).detail || {};
    if (!id || !url) return;
    postToContext({ scope: 'portalvr', type: 'portalvr:ws-open', id, url });
  });

  window.addEventListener('portalvr:ws-send', (evt: Event) => {
    const { id, data } = (evt as CustomEvent<{ id: string; data: string }>).detail || {};
    if (!id || typeof data !== 'string') return;
    postToContext({ scope: 'portalvr', type: 'portalvr:ws-send', id, data });
  });

  window.addEventListener('portalvr:ws-close', (evt: Event) => {
    const { id, code, reason } = (evt as CustomEvent<{ id: string; code?: number; reason?: string }>).detail || {};
    if (!id) return;
    postToContext({ scope: 'portalvr', type: 'portalvr:ws-close', id, code, reason });
  });
}

function onContextMessage(event: MessageEvent) {
  if (event.origin !== CONTEXT_ORIGIN) return;
  const data = event.data as ContextBridgeMessage | null | undefined;
  if (!data || typeof data !== 'object' || (data as { scope?: string }).scope !== 'portalvr') return;

  if (data.type === 'portalvr:context-ready') {
    contextReady = true;
    requestInitialConfig();
    return;
  }

  if (data.type === 'portalvr:config') {
    const id = (data as { id?: string }).id;
    if (id && ignoreReplyIds.has(id)) {
      // This is an echo from our forwarded set-config; do not apply again.
      ignoreReplyIds.delete(id);
      return;
    }
    // Apply on initial fetch or unsolicited updates from the context.
    applyConfigToRuntime((data as { config: PortalEmulatorConfig }).config);
    return;
  }

  if (data.type === 'portalvr:ws-event') {
    try {
      const detail = { id: (data as any).id, event: (data as any).event, data: (data as any).data, code: (data as any).code, reason: (data as any).reason, error: (data as any).error };
      window.dispatchEvent(new CustomEvent('portalvr:ws-event', { detail }));
    } catch { /* ignore */ }
    return;
  }
}

function installPortalVRContextBridge(): void {
  if (!shouldInstallContextBridge()) {
    return;
  }
  if (typeof window === 'undefined') return;

  const doInstall = () => {
    ensureContextIframeInstalled();
    forwardDomConfigEventsToContext();
    forwardDomSignalingEventsToContext();
    window.addEventListener('message', onContextMessage);
    // If the iframe loaded before we registered listeners, ask for config anyway after a short tick.
    setTimeout(() => {
      if (!contextReady) {
        // Poke the iframe by sending a "hello" (optional) or just ask for config.
        requestInitialConfig();
      }
    }, 0);
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    doInstall();
  } else {
    window.addEventListener('DOMContentLoaded', doInstall, { once: true });
  }
}

async function deferContextBridgeInstall(): Promise<void> {
  if (!shouldInstallContextBridge()) {
    return;
  }
  const extensionDetected = await waitForExtensionPresence();
  if (extensionDetected) {
    return;
  }
  installPortalVRContextBridge();
}

export async function bootstrapStandaloneEmulator(
  options: StandaloneOptions = {},
): Promise<XRDevice | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const existingState = getStandaloneState();
  const portalAlreadyActive = Boolean(existingState);

  if (existingState && !options.forceReinstall) {
    return existingState.device;
  }

  const shouldInterceptNativeXR =
    !portalAlreadyActive &&
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { xr?: PortalXRSystem }).xr);
  const proxyState = shouldInterceptNativeXR ? ensureNavigatorXRProxy() : null;
  const detectionTarget = portalAlreadyActive
    ? null
    : proxyState?.nativeXR ?? getNavigatorXR();

  let shouldInstallPortal = portalAlreadyActive || !detectionTarget;
  if (options.skipNativeImmersiveCheck) {
    shouldInstallPortal = true;
  }

  if (!shouldInstallPortal && detectionTarget) {
    const supportResult = await detectImmersiveVRSupport(detectionTarget);
    if (supportResult === true || supportResult === null) {
      proxyState?.resolveNative();
      return null;
    }
    shouldInstallPortal = true;
  }

  if (!shouldInstallPortal) {
    proxyState?.resolveNative();
    return null;
  }

  let proxyResolvedToPortal = false;
  try {
    ensurePolyfillInstalled(options.forcePolyfill ?? true);
    markCustomPolyfillFlag();

    const device = new XRDevice(oculusQuest1);
    try {
      device.installRuntime({
        enforce: options.enforceRuntime ?? true,
      });
    } catch (error) {
      if (isNavigatorXRError(error)) {
        console.warn('[PortalVR Standalone] navigator.xr override was already locked; continuing with existing runtime surface.');
      } else {
        throw error;
      }
    }

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

    if (proxyState) {
      const portalXRSystem = getNavigatorXR();
      if (portalXRSystem) {
        proxyState.resolvePortal(portalXRSystem);
        proxyResolvedToPortal = true;
      } else {
        proxyState.resolveNative();
      }
    }

    return device;
  } catch (error) {
    if (proxyState && !proxyResolvedToPortal) {
      proxyState.resolveNative();
    }
    throw error;
  }
}

async function autoInstallStandaloneEmulator(): Promise<void> {
  try {
    await bootstrapStandaloneEmulator();
  } catch (error) {
    console.error('[PortalVR Standalone] Failed to install emulator', error);
  }
}

// Install the iframe context bridge BEFORE attempting to bootstrap, so the initial config is ready ASAP.
if (CONTEXT_BRIDGE_COMPILED_IN) {
  void deferContextBridgeInstall();
}

void autoInstallStandaloneEmulator();

export function ensureStandaloneSurfaceInitialized(forcePolyfill = true): void {
  ensurePolyfillInstalled(forcePolyfill);
  markCustomPolyfillFlag();
}

function isNavigatorXRError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') {
    return false;
  }
  return message.includes("Cannot set property xr") || message.includes('only a getter');
}
