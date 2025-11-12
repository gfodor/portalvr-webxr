import {
  CONTEXT_SCOPE,
  MESSAGE_TYPE_READY,
  MESSAGE_TYPE_CONFIG,
  MESSAGE_TYPE_GET_CONFIG,
  MESSAGE_TYPE_SET_CONFIG,
  getOrCreateRuntimeConfig,
  ensureConfigDefaults,
  ensureConfigSuffix,
  normalizeConfig,
  persistStoredConfig,
  type PortalEmulatorConfig,
} from './shared.js';

type BridgeMessage =
  | { scope: string; type: string; id?: string; config?: PortalEmulatorConfig };

(function bootstrapPortalVRContext() {
  function postTo(target: Window | null, origin: string, message: BridgeMessage) {
    try {
      target?.postMessage(message, origin || '*');
    } catch {
      // ignore post failures
    }
  }

  function replyWithConfig(target: Window | null, origin: string, id?: string) {
    const cfg = getOrCreateRuntimeConfig();
    postTo(target, origin, { scope: CONTEXT_SCOPE, type: MESSAGE_TYPE_CONFIG, id, config: cfg });
  }

  function handleSetConfig(target: Window | null, origin: string, id: string | undefined, candidate: unknown) {
    // Normalize & persist
    const base = getOrCreateRuntimeConfig();
    const next = ensureConfigSuffix(ensureConfigDefaults(normalizeConfig(candidate, base)));
    persistStoredConfig(next);
    // Echo back for acknowledgement
    postTo(target, origin, { scope: CONTEXT_SCOPE, type: MESSAGE_TYPE_CONFIG, id, config: next });
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as BridgeMessage | null | undefined;
    if (!data || typeof data !== 'object') return;
    if ((data as { scope?: string }).scope !== CONTEXT_SCOPE) return;

    const sourceWin = event.source as (Window | null);
    const origin = event.origin || '*';

    switch (data.type) {
      case MESSAGE_TYPE_GET_CONFIG:
        replyWithConfig(sourceWin, origin, data.id);
        break;
      case MESSAGE_TYPE_SET_CONFIG:
        handleSetConfig(sourceWin, origin, data.id, (data as { config?: unknown }).config);
        break;
      default:
        // Unknown message type – ignore
        break;
    }
  });

  // Announce readiness to parent
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ scope: CONTEXT_SCOPE, type: MESSAGE_TYPE_READY } as BridgeMessage, '*');
    }
  } catch {
    // ignore
  }
})();
