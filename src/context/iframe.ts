import {
  CONTEXT_SCOPE,
  MESSAGE_TYPE_READY,
  MESSAGE_TYPE_CONFIG,
  MESSAGE_TYPE_GET_CONFIG,
  MESSAGE_TYPE_SET_CONFIG,
  MESSAGE_TYPE_WS_OPEN,
  MESSAGE_TYPE_WS_SEND,
  MESSAGE_TYPE_WS_CLOSE,
  MESSAGE_TYPE_WS_EVENT,
  getOrCreateRuntimeConfig,
  ensureConfigDefaults,
  ensureConfigSuffix,
  normalizeConfig,
  persistStoredConfig,
  type PortalEmulatorConfig,
} from './shared.js';

type BridgeMessage =
  | { scope: string; type: string; id?: string; config?: PortalEmulatorConfig }
  | { scope: string; type: typeof MESSAGE_TYPE_WS_OPEN; id: string; url: string }
  | { scope: string; type: typeof MESSAGE_TYPE_WS_SEND; id: string; data: string }
  | { scope: string; type: typeof MESSAGE_TYPE_WS_CLOSE; id: string; code?: number; reason?: string };

(function bootstrapPortalVRContext() {
  const sockets = new Map<string, WebSocket>();

  function postTo(target: Window | null, origin: string, message: any) {
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

  function emitWsEvent(target: Window | null, origin: string, detail: any) {
    postTo(target, origin, { scope: CONTEXT_SCOPE, type: MESSAGE_TYPE_WS_EVENT, ...detail });
  }

  function handleWsOpen(target: Window | null, origin: string, id: string, url: string) {
    try {
      const prev = sockets.get(id);
      try { prev?.close(4001, 'reopen'); } catch {}
    } catch {}
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      sockets.set(id, ws);
    } catch (e: any) {
      emitWsEvent(target, origin, { id, event: 'error', error: e?.message || 'ws-open-error' });
      return;
    }
    ws.onopen = () => emitWsEvent(target, origin, { id, event: 'open' });
    ws.onmessage = (ev: MessageEvent) => {
      // We expect server sends text JSON; coerce to string if needed
      const text = typeof ev.data === 'string' ? ev.data : (() => {
        try { return String(ev.data); } catch { return ''; }
      })();
      emitWsEvent(target, origin, { id, event: 'message', data: text });
    };
    ws.onerror = () => emitWsEvent(target, origin, { id, event: 'error', error: 'ws-error' });
    ws.onclose = (ev: CloseEvent) => {
      emitWsEvent(target, origin, { id, event: 'close', code: ev.code, reason: ev.reason });
      sockets.delete(id);
    };
  }

  function handleWsSend(_target: Window | null, _origin: string, id: string, data: string) {
    const ws = sockets.get(id);
    try {
      ws?.send(data);
    } catch {
      // ignore
    }
  }

  function handleWsClose(_target: Window | null, _origin: string, id: string, code?: number, reason?: string) {
    const ws = sockets.get(id);
    try {
      ws?.close(code ?? 1000, reason ?? 'client-close');
    } catch { /* ignore */ }
    sockets.delete(id);
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as BridgeMessage | null | undefined;
    if (!data || typeof data !== 'object') return;
    if ((data as { scope?: string }).scope !== CONTEXT_SCOPE) return;

    const sourceWin = event.source as (Window | null);
    const origin = event.origin || '*';

    switch (data.type) {
      case MESSAGE_TYPE_GET_CONFIG:
        replyWithConfig(sourceWin, origin, (data as any).id);
        break;
      case MESSAGE_TYPE_SET_CONFIG:
        handleSetConfig(sourceWin, origin, (data as any).id, (data as any).config);
        break;
      case MESSAGE_TYPE_WS_OPEN:
        handleWsOpen(sourceWin, origin, (data as any).id, (data as any).url);
        break;
      case MESSAGE_TYPE_WS_SEND:
        handleWsSend(sourceWin, origin, (data as any).id, (data as any).data);
        break;
      case MESSAGE_TYPE_WS_CLOSE:
        handleWsClose(sourceWin, origin, (data as any).id, (data as any).code, (data as any).reason);
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
