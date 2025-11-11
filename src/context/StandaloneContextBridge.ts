import type { PortalEmulatorConfig } from '../device/PortalEmulatorConfig.js';
import { setRuntimeAssetBaseUrl } from '../runtime/RuntimeAssetResolver.js';
import {
  CONTEXT_MESSAGE_TIMEOUT_MS,
  DEFAULT_CONTEXT_IFRAME_URL,
  MESSAGE_SOURCE_CONTEXT,
  MESSAGE_SOURCE_HOST,
  MESSAGE_TYPE_CONTEXT_READY,
  MESSAGE_TYPE_ENSURE_RUNTIME,
  MESSAGE_TYPE_GET_CONFIG,
  MESSAGE_TYPE_SET_CONFIG,
  PORTAL_CONFIG_OVERRIDE_GLOBAL,
} from './constants.js';

type PendingRequest = {
  resolve: (message: ContextInboundMessage) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type ContextInboundMessage = {
  source?: string;
  type?: string;
  requestId?: string;
  ok?: boolean;
  config?: PortalEmulatorConfig;
  assetBaseUrl?: string | null;
};

type OutboundMessage = {
  source: string;
  type: string;
  requestId?: string;
  config?: PortalEmulatorConfig;
  [key: string]: unknown;
};

export interface StandaloneContextBridgeOptions {
  iframeUrl?: string;
}

let installPromise: Promise<void> | null = null;

const pendingRequests = new Map<string, PendingRequest>();
let iframeWindow: Window | null = null;
let iframeOrigin: string | null = null;
let suppressForwarding = false;
let readyResolved = false;
let readyResolver: (() => void) | null = null;
let fallbackTimer: number | null = null;

export function installStandaloneContextBridge(
  options: StandaloneContextBridgeOptions = {},
): Promise<void> {
  if (installPromise) {
    return installPromise;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    installPromise = Promise.resolve();
    return installPromise;
  }

  const iframeUrl = options.iframeUrl ?? DEFAULT_CONTEXT_IFRAME_URL;
  iframeOrigin = resolveOrigin(iframeUrl);

  installPromise = new Promise<void>((resolve) => {
    readyResolver = resolve;
    fallbackTimer = window.setTimeout(() => {
      finalizeReady();
    }, CONTEXT_MESSAGE_TIMEOUT_MS * 2);

    const iframe = createHiddenIframe(iframeUrl);
    const attach = () => {
      if (!iframe.isConnected) {
        const parent =
          document.body ?? document.documentElement ?? document.head;
        parent?.appendChild(iframe);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    } else {
      attach();
    }

    iframe.addEventListener(
      'load',
      () => {
        iframeWindow = iframe.contentWindow;
        requestRuntimeConfig();
      },
      { once: true },
    );
    iframeWindow = iframe.contentWindow;

    window.addEventListener('message', handleContextMessage);
    window.addEventListener(
      MESSAGE_TYPE_SET_CONFIG,
      handlePageConfigEvent as EventListener,
    );

    // Kick off ensure-runtime ping once iframe is attached.
    requestRuntimeMetadata().catch(() => {
      // Ignore errors; fallback timer will resolve the promise.
    });
  });

  return installPromise;
}

function resolveOrigin(url: string): string | null {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
}

function finalizeReady(): void {
  if (readyResolved) {
    return;
  }
  readyResolved = true;
  if (fallbackTimer !== null) {
    window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  readyResolver?.();
  readyResolver = null;
}

function createHiddenIframe(url: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'absolute';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  iframe.style.clipPath = 'inset(50%)';
  iframe.style.margin = '0';
  iframe.style.padding = '0';
  iframe.style.zIndex = '-1';
  return iframe;
}

function handleContextMessage(event: MessageEvent<ContextInboundMessage>): void {
  if (!iframeOrigin || event.origin !== iframeOrigin) {
    return;
  }
  const data = event.data;
  if (!data || data.source !== MESSAGE_SOURCE_CONTEXT) {
    return;
  }

  if (data.type === MESSAGE_TYPE_CONTEXT_READY) {
    if (typeof data.assetBaseUrl === 'string' && data.assetBaseUrl.length > 0) {
      setRuntimeAssetBaseUrl(data.assetBaseUrl);
    }
    requestRuntimeConfig();
    return;
  }

  if (data.type === MESSAGE_TYPE_SET_CONFIG && data.config) {
    applyConfigFromContext(data.config);
  }

  if (typeof data.requestId === 'string') {
    const pending = pendingRequests.get(data.requestId);
    if (pending) {
      pendingRequests.delete(data.requestId);
      window.clearTimeout(pending.timeoutId);
      pending.resolve(data);
      return;
    }
  }
}

function handlePageConfigEvent(event: Event): void {
  if (suppressForwarding) {
    return;
  }
  const custom = event as CustomEvent<PortalEmulatorConfig | null>;
  const config = custom.detail;
  if (!config) {
    return;
  }
  sendMessageToContext(MESSAGE_TYPE_SET_CONFIG, { config });
}

function applyConfigFromContext(config: PortalEmulatorConfig): void {
  try {
    const globalTarget = window as typeof window & Record<string, unknown>;
    globalTarget[PORTAL_CONFIG_OVERRIDE_GLOBAL] = config;
  } catch {
    // ignore assignment failures
  }
  suppressForwarding = true;
  try {
    window.dispatchEvent(
      new CustomEvent(MESSAGE_TYPE_SET_CONFIG, { detail: config }),
    );
  } finally {
    suppressForwarding = false;
  }
  finalizeReady();
}

function requestRuntimeConfig(): void {
  sendRequestToContext(MESSAGE_TYPE_GET_CONFIG)
    .then((message) => {
      if (message?.config) {
        applyConfigFromContext(message.config);
        return;
      }
      finalizeReady();
    })
    .catch(() => {
      finalizeReady();
    });
}

async function requestRuntimeMetadata(): Promise<void> {
  try {
    await sendRequestToContext(MESSAGE_TYPE_ENSURE_RUNTIME);
  } catch {
    // ignore metadata failures; config path will use fallback timer
  }
}

function sendMessageToContext(
  type: string,
  payload: Record<string, unknown> = {},
): void {
  if (!iframeWindow || !iframeOrigin) {
    return;
  }
  const message: OutboundMessage = {
    source: MESSAGE_SOURCE_HOST,
    type,
    ...payload,
  };
  try {
    iframeWindow.postMessage(message, iframeOrigin);
  } catch {
    // ignore postMessage failures
  }
}

function sendRequestToContext(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<ContextInboundMessage> {
  if (!iframeWindow || !iframeOrigin) {
    return Promise.reject(new Error('PortalVR context iframe unavailable'));
  }
  const requestId = generateRequestId();
  const message: OutboundMessage = {
    source: MESSAGE_SOURCE_HOST,
    type,
    requestId,
    ...payload,
  };
  return new Promise<ContextInboundMessage>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`PortalVR context request timed out: ${type}`));
    }, CONTEXT_MESSAGE_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timeoutId });
    try {
      iframeWindow!.postMessage(message, iframeOrigin!);
    } catch (error) {
      pendingRequests.delete(requestId);
      window.clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error('postMessage failed'));
    }
  });
}

function generateRequestId(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore crypto errors
  }
  return `ctx_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
