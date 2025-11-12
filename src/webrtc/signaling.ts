import { nanoid, nowIso } from './utils.js';
import { createBridgeWebSocket, isBridgeLikelyAvailable, type IWebSocketLike } from './wsBridge.js';

type Handler = (payload: any) => void;

interface SignalingOpts {
  server: string;
  roomId: string;
  log?: (m: string) => void;
  requestTurn?: boolean;
  socketFactory?: (url: string) => IWebSocketLike;
  transport?: 'auto' | 'bridge' | 'native';
}

export class SignalingClient {
  server: string;
  roomId: string;
  log: (m: string) => void;
  requestTurn: boolean;
  ws: IWebSocketLike | null = null;
  private socketFactory?: (url: string) => IWebSocketLike;
  private transportPolicy: 'auto' | 'bridge' | 'native' = 'auto';

  sendQueue: string[] = [];
  connected = false;
  accept: any = null;
  handlers: Map<string, Handler> = new Map();
  clientId: string;

  constructor({ server, roomId, log, requestTurn = false, socketFactory, transport = 'auto' }: SignalingOpts) {
    this.server = server.replace(/\/$/, '');
    this.roomId = roomId;
    this.log = log || (() => {});
    this.requestTurn = requestTurn;
    this.clientId = `web-${nanoid()}`;
    this.socketFactory = socketFactory;
    this.transportPolicy = transport;
  }

  on(type: string, fn: Handler) {
    this.handlers.set(type, fn);
  }

  private _emit(type: string, payload: any) {
    const h = this.handlers.get(type);
    if (h) h(payload);
  }

  connect(): Promise<any> {
    this.sendQueue = [];
    return new Promise((resolve, reject) => {
      let settled = false;
      const params = new URLSearchParams({ roomId: this.roomId });
      if (this.requestTurn) params.set('turn', 'true');
      const url = `${this.server}/signaling?${params.toString()}`;

      const openWith = (kind: 'bridge' | 'native') => {
        try {
          if (kind === 'native') {
            // @ts-ignore WebSocket global exists in browser
            return new WebSocket(url) as unknown as IWebSocketLike;
          }
          const factory = this.socketFactory ?? (isBridgeLikelyAvailable() ? createBridgeWebSocket : null);
          if (!factory) return null;
          const sock = factory(url);
          // Mark sentinel for logging
          (sock as any).__bridge = true;
          return sock;
        } catch {
          return null;
        }
      };

      const tryBridgeFirst = this.transportPolicy !== 'native';
      const primary = tryBridgeFirst ? openWith('bridge') : openWith('native');
      this.ws = primary || openWith('native');

      if (!this.ws) {
        reject(new Error('no-socket-factory'));
        return;
      }

      const maybeFallbackTimer =
        tryBridgeFirst && !(this.ws as any).__native
          ? setTimeout(() => {
              if (settled || !this.ws || this.ws.readyState === 1 /* OPEN */) return;
              // Fallback to native if bridge seemingly unavailable
              this.log(`[${nowIso()}] bridge open timeout; falling back to native WebSocket`);
              try {
                this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null as any;
              } catch {}
              try { this.ws.close(4000, 'bridge-fallback'); } catch { /* ignore */ }
              this.ws = openWith('native');
              if (!this.ws) {
                if (!settled) {
                  settled = true;
                  reject(new Error('native-fallback-failed'));
                }
                return;
              }
              wireSocketHandlers();
            }, 2000)
          : null;

      const wireSocketHandlers = () => {
        this.ws!.onopen = () => {
          this.connected = true;
          this.log(`[${nowIso()}] ws open → register { roomId:"${this.roomId}" }`);
          const reg = {
            type: 'register',
            roomId: this.roomId,
            clientId: this.clientId,
            ayameClient: 'webrtc-tests/0.1.0',
            environment: 'browser',
            standalone: false,
          };
          try {
            this.ws!.send(JSON.stringify(reg));
          } catch {}
          this._flushQueue();
        };
        this.ws!.onerror = (e: any) => {
          this.log(`[${nowIso()}] ws error: ${e?.message || e}`);
          if (!settled) {
            settled = true;
            reject(new Error(`ws-error: ${e?.message || 'unknown'}`));
          }
        };
        this.ws!.onclose = (ev: any) => {
          this.connected = false;
          this.log(`[${nowIso()}] ws close code=${ev.code ?? 0} reason=${ev.reason ?? ''}`);
          this._emit('close', ev);
          if (!settled && !this.accept) {
            settled = true;
            reject(new Error(`ws-closed: ${ev.code || 0}`));
          }
        };
        this.ws!.onmessage = (ev: any) => {
          try {
            const msg = JSON.parse(ev.data as string);
            if (msg.type === 'accept') {
              this.accept = msg;
              this.log(`[${nowIso()}] <- accept isExistClient=${!!msg.isExistClient}`);
              this._emit('accept', msg);
              if (!settled) {
                settled = true;
                resolve(msg);
              }
            } else if (msg.type === 'reject') {
              this.log(`[${nowIso()}] <- reject: ${msg.reason}`);
              if (!settled) {
                settled = true;
                reject(new Error(msg.reason || 'rejected'));
              }
            } else if (msg.type === 'offer') {
              this.log(`[${nowIso()}] <- offer [${msg.sdp?.length ?? 0} chars]`);
              this._emit(msg.type, msg);
            } else if (msg.type === 'answer') {
              this.log(`[${nowIso()}] <- answer [${msg.sdp?.length ?? 0} chars]`);
              this._emit(msg.type, msg);
            } else if (msg.type === 'candidate') {
              const raw = msg.candidate?.candidate || '';
              this.log(`[${nowIso()}] <- candidate len=${raw.length}`);
              this._emit(msg.type, msg);
            } else if (msg.type === 'bye' || msg.type === 'message') {
              this._emit(msg.type, msg);
            } else if (msg.type === 'ping') {
              this.send({ type: 'pong' });
            } else {
              this.log(`[${nowIso()}] <- (ignored) ${ev.data}`);
            }
          } catch (e: any) {
            this.log(`[${nowIso()}] ws message parse error: ${e.message}`);
          }
        };
      };

      wireSocketHandlers();
      if (maybeFallbackTimer) {
        // noop, timer will clear itself
      }
    });
  }

  send(obj: any) {
    const payload = JSON.stringify(obj);
    if (!this.ws || this.ws.readyState !== 1) {
      this.log(
        `[${nowIso()}] queue outbound ${obj.type || 'unknown'} (ws state ${
          this.ws?.readyState ?? 'none'
        })`,
      );
      this.sendQueue.push(payload);
      return;
    }
    this.log(`[${nowIso()}] -> ${obj.type || 'unknown'} send len=${payload.length}`);
    this.ws.send(payload);
  }

  private _flushQueue() {
    if (!this.sendQueue.length || !this.ws || this.ws.readyState !== 1) return;
    this.log(`[${nowIso()}] flushing ${this.sendQueue.length} queued message(s)`);
    for (const payload of this.sendQueue) {
      try {
        this.ws.send(payload);
      } catch (e: any) {
        this.log(`[${nowIso()}] flush send error: ${e.message}`);
      }
    }
    this.sendQueue = [];
  }

  sendOffer(sdp: string) {
    this.log(`[${nowIso()}] -> offer [${sdp.length} chars]`);
    this.send({ type: 'offer', sdp });
  }
  sendAnswer(sdp: string) {
    this.log(`[${nowIso()}] -> answer [${sdp.length} chars]`);
    this.send({ type: 'answer', sdp });
  }
  sendCandidate(init: RTCIceCandidateInit) {
    this.send({ type: 'candidate', candidate: init });
  }

  close() {
    try {
      this.ws?.close(1000, 'client-close');
    } catch {}
  }
}