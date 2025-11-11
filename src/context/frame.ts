import type { PortalEmulatorConfig } from '../device/PortalEmulatorConfig.js';
import {
  CONFIG_STORAGE_KEY,
  MESSAGE_SOURCE_CONTEXT,
  MESSAGE_SOURCE_HOST,
  MESSAGE_TYPE_CONTEXT_READY,
  MESSAGE_TYPE_ENSURE_RUNTIME,
  MESSAGE_TYPE_GET_CONFIG,
  MESSAGE_TYPE_SET_CONFIG,
} from './constants.js';
import {
  createPortalRuntimeContext,
  type RuntimeConfigStore,
} from './PortalRuntimeContext.js';

type HostMessage = {
  source?: string;
  type?: string;
  requestId?: string;
  config?: unknown;
};

const storageStore: RuntimeConfigStore = {
  async read() {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as PortalEmulatorConfig;
      return parsed;
    } catch {
      return null;
    }
  },
  async write(config) {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore persistence failures
    }
  },
};

const runtimeContext = createPortalRuntimeContext(storageStore);

void bootstrapContext().catch(() => {
  /* ignore bootstrap failures */
});

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (!message || message.source !== MESSAGE_SOURCE_HOST) {
    return;
  }
  void handleHostMessage(event, message);
});

window.addEventListener('storage', (event: StorageEvent) => {
  if (event.key !== CONFIG_STORAGE_KEY) {
    return;
  }
  void runtimeContext
    .getOrCreateRuntimeConfig()
    .then((config) => broadcastConfig(config));
});

async function bootstrapContext(): Promise<void> {
  const config = await runtimeContext.getOrCreateRuntimeConfig();
  broadcastConfig(config);
  postToParent({
    type: MESSAGE_TYPE_CONTEXT_READY,
    assetBaseUrl: getAssetBaseUrl(),
  });
}

async function handleHostMessage(
  event: MessageEvent<HostMessage>,
  message: HostMessage,
): Promise<void> {
  if (message.type === MESSAGE_TYPE_GET_CONFIG) {
    const config = await runtimeContext.getOrCreateRuntimeConfig();
    postResponse(event, {
      type: MESSAGE_TYPE_GET_CONFIG,
      config,
      requestId: message.requestId,
    });
    return;
  }

  if (message.type === MESSAGE_TYPE_SET_CONFIG) {
    const updated = await runtimeContext.setRuntimeConfig(message.config);
    broadcastConfig(updated);
    postResponse(event, {
      type: MESSAGE_TYPE_SET_CONFIG,
      ok: true,
      config: updated,
      requestId: message.requestId,
    });
    return;
  }

  if (message.type === MESSAGE_TYPE_ENSURE_RUNTIME) {
    postResponse(event, {
      type: MESSAGE_TYPE_ENSURE_RUNTIME,
      ok: true,
      assetBaseUrl: getAssetBaseUrl(),
      requestId: message.requestId,
    });
  }
}

function broadcastConfig(config: PortalEmulatorConfig): void {
  postToParent({
    type: MESSAGE_TYPE_SET_CONFIG,
    config,
  });
}

function postResponse(
  event: MessageEvent<HostMessage>,
  payload: Record<string, unknown>,
): void {
  const target = event.source;
  if (!target) {
    postToParent(payload);
    return;
  }
  try {
    if ('postMessage' in target) {
      const origin = event.origin && event.origin !== 'null' ? event.origin : '*';
      (target as Window).postMessage(
        {
          source: MESSAGE_SOURCE_CONTEXT,
          ...payload,
        },
        origin,
      );
    }
  } catch {
    postToParent(payload);
  }
}

function postToParent(payload: Record<string, unknown>): void {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          source: MESSAGE_SOURCE_CONTEXT,
          ...payload,
        },
        '*',
      );
    }
  } catch {
    // ignore parent messaging failures
  }
}

function getAssetBaseUrl(): string | null {
  try {
    return new URL('./build/', window.location.href).toString();
  } catch {
    return null;
  }
}
