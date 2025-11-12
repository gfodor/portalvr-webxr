/**
 * BridgeWebSocket - a minimal WebSocket-compatible transport that never opens a socket
 * from the host page. Instead, it talks to a bridge (extension or iframe) via DOM CustomEvents.
 *
 * Outbound (page -> bridge):
 *  - portalvr:ws-open  { id, url }
 *  - portalvr:ws-send  { id, data }
 *  - portalvr:ws-close { id, code?, reason? }
 *
 * Inbound (bridge -> page):
 *  - portalvr:ws-event { id, event: 'open'|'message'|'close'|'error', data?, code?, reason?, error? }
 */

import { nanoid } from './utils.js';

const EV_WS_OPEN  = 'portalvr:ws-open';
const EV_WS_SEND  = 'portalvr:ws-send';
const EV_WS_CLOSE = 'portalvr:ws-close';
const EV_WS_EVENT = 'portalvr:ws-event';

type WsEventDetail =
  | { id: string; event: 'open' }
  | { id: string; event: 'message'; data: string }
  | { id: string; event: 'close'; code?: number; reason?: string }
  | { id: string; event: 'error'; error?: string };

export interface IWebSocketLike {
  readyState: number; // 0 connecting, 1 open, 2 closing, 3 closed
  onopen: ((ev: any) => any) | null;
  onmessage: ((ev: { data: any }) => any) | null;
  onerror: ((ev: any) => any) | null;
  onclose: ((ev: { code?: number; reason?: string }) => any) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * Returns true if we're plausibly in a browser document where the bridge can respond.
 */
export function isBridgeLikelyAvailable(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export class BridgeWebSocket implements IWebSocketLike {
  readonly id: string;
  readonly url: string;
  readyState = 0;

  onopen: ((ev: any) => any) | null = null;
  onmessage: ((ev: { data: any }) => any) | null = null;
  onerror: ((ev: any) => any) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => any) | null = null;

  private _boundHandler: (ev: Event) => void;
  private _closed = false;

  constructor(url: string) {
    this.id = `wsb-${nanoid(8)}`;
    this.url = url;
    this._boundHandler = (ev: Event) => {
      const ce = ev as CustomEvent<WsEventDetail>;
      const dt = ce?.detail;
      if (!dt || (dt as any).id !== this.id) return;

      if (dt.event === 'open') {
        this.readyState = 1;
        this.onopen?.({});
        return;
      }
      if (dt.event === 'message') {
        this.onmessage?.({ data: (dt as any).data });
        return;
      }
      if (dt.event === 'close') {
        this.readyState = 3;
        this._teardown();
        this.onclose?.({ code: (dt as any).code, reason: (dt as any).reason });
        return;
      }
      if (dt.event === 'error') {
        this.onerror?.({ message: (dt as any).error || 'bridge-error' });
        return;
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(EV_WS_EVENT, this._boundHandler);
    }

    // Request the bridge to open the real socket.
    this._dispatch(EV_WS_OPEN, { id: this.id, url: this.url });
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      // behave like WS: throw or ignore; we follow native (throw in spec) but be lenient.
      try {
        this._dispatch(EV_WS_SEND, { id: this.id, data });
      } catch { /* ignore */ }
      return;
    }
    this._dispatch(EV_WS_SEND, { id: this.id, data });
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3 || this._closed) return;
    this.readyState = 2;
    this._dispatch(EV_WS_CLOSE, { id: this.id, code, reason });
  }

  private _dispatch(type: string, detail: any): void {
    try {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    } catch {
      // ignore dispatch errors
    }
  }

  private _teardown(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      window.removeEventListener(EV_WS_EVENT, this._boundHandler);
    } catch { /* ignore */ }
  }
}

/** Factory helper */
export function createBridgeWebSocket(url: string): IWebSocketLike {
  return new BridgeWebSocket(url);
}