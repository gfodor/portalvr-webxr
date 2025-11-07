import { SignalingClient } from './signaling.js';
import { gatherSelectedPair, nowIso, parseCandidateLine } from './utils.js';

// --- SDP helpers (unchanged logic, TS typed) ---

function ensureEndOfCandidates(sdp: string): string {
  if (!sdp || sdp.includes('a=end-of-candidates')) return sdp;
  const lines = sdp.replace(/\r?\n$/, '').split('\r\n');
  const mIndex = lines.findIndex((line) => line.startsWith('m='));
  if (mIndex === -1) return sdp;
  let insertAt = lines.length;
  for (let i = mIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('m=')) {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, 'a=end-of-candidates');
  return lines.join('\r\n') + '\r\n';
}

function extractSdpCandidates(sdp: string): string[] {
  if (!sdp) return [];
  return sdp
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('a=candidate:'));
}

function finalizeSdpForSend(sdp: string, trickleOn: boolean): string {
  const base = sdp || '';
  return trickleOn ? base : ensureEndOfCandidates(base);
}

function mergeUniqueIceServers(base: RTCIceServer[], incoming: RTCIceServer[]): RTCIceServer[] {
  const seen = new Set<string>();
  const out: RTCIceServer[] = [];
  const pushUnique = (srv: RTCIceServer | undefined | null) => {
    if (!srv || !(srv as any).urls) return;
    const urlsArray = Array.isArray((srv as any).urls)
      ? (srv as any).urls.slice().sort()
      : [String((srv as any).urls)];
    const key = [urlsArray.join(','), (srv as any).username || '', (srv as any).credential || ''].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...(srv as any), urls: urlsArray } as any);
  };
  (Array.isArray(base) ? base : []).forEach(pushUnique);
  (Array.isArray(incoming) ? incoming : []).forEach(pushUnique);
  return out;
}

function applyIceServersToPc(
  pc: RTCPeerConnection,
  baseServers: RTCIceServer[],
  incoming: RTCIceServer[],
  log?: (m: string) => void,
) {
  try {
    const merged = mergeUniqueIceServers(baseServers || [], incoming || []);
    if (merged.length) {
      const current = pc.getConfiguration();
      pc.setConfiguration({ ...current, iceServers: merged });
      log?.(`[RoomSession] iceServers configured (${merged.length})`);
    }
  } catch (e: any) {
    log?.(`failed to apply ICE servers from signaling: ${e.message}`);
  }
}

function dcIsOpen(dc: RTCDataChannel | null | undefined): boolean {
  return !!dc && dc.readyState === 'open';
}

function safeDcSend(dc: RTCDataChannel | null | undefined, data: any): boolean {
  try {
    if (!dcIsOpen(dc)) return false;
    if (data && (data as any).buffer && (data as any).byteLength === undefined) {
      const view = data as ArrayBufferView; // e.g., Uint8Array
      (dc as RTCDataChannel).send(view.buffer as ArrayBuffer);
    } else {
      (dc as RTCDataChannel).send(data);
    }
    return true;
  } catch {
    return false;
  }
}

const BACKOFF_WAKE_DEBOUNCE_MS = 5000;
const MOUSE_IDLE_THRESHOLD_MS = 15000;
const CANDIDATE_TIMEOUT_MS = 4000;

interface RoomSessionOpts {
  label: 'local' | 'remote';
  roomId: string;
  server: string;
  iceConfig: RTCConfiguration;
  politeHint?: boolean;
  requestTurn?: boolean;
  log?: (m: string) => void;
  onConnected?: (src: string) => void;
  onCandidate?: (info: any) => void;
  onStats?: (stats: any) => void;
  trickleCandidates?: boolean;
  onDown?: (reason: string) => void;
  onChat?: (msg: any) => void;
  onStateChange?: (stateObj: any) => void;
  pcConstraints?: any;
  sdpTransform?: (sdp: string) => string;
  onMsg?: (data: ArrayBuffer | string) => void;
  onSignalingConnected?: () => void;
}

/**
 * WebRTC session bound to one logical signaling room.
 * Mirrors webrtc-tests behavior; typed & trimmed for prod.
 */
export class RoomSession {
  label: 'local' | 'remote';
  roomId: string;
  server: string;
  iceConfig: RTCConfiguration;
  pcConstraints: any;
  private _sdpTransform?: (sdp: string) => string;
  onMsg?: (data: ArrayBuffer | string) => void;
  log: (m: string) => void;
  requestTurn: boolean;
  onConnected?: (src: string) => void;
  onCandidate?: (info: any) => void;
  onStats?: (stats: any) => void;
  onDown?: (reason: string) => void;
  onChat?: (msg: any) => void;
  onStateChange?: (stateObj: any) => void;
  trickle: boolean;
  private _onSignalingConnected?: () => void;

  signaling: SignalingClient;
  pc: RTCPeerConnection;
  dc!: RTCDataChannel;
  makingOffer = false;
  ignoreOffer = false;
  polite: boolean;
  closed = false;
  private _acceptReceived = false;
  private _negotiationDeferred = false;
  private _hasMadeInitialOffer = false;
  private _connectedNotified = false;
  private _disconnectTimer: any = null;
  private _iceCompleteResolvers: Array<() => void> = [];
  private _seenRemoteSdpCandidates: Set<string> = new Set();
  private _statsTimer: any = null;
  private _ka: any = null;

  constructor(opts: RoomSessionOpts) {
    const {
      label,
      roomId,
      server,
      iceConfig,
      politeHint = false,
      requestTurn = false,
      log,
      onConnected,
      onCandidate,
      onStats,
      trickleCandidates = true,
      onDown,
      onChat,
      onStateChange,
      pcConstraints,
      sdpTransform,
      onMsg,
      onSignalingConnected,
    } = opts;

    this.label = label;
    this.roomId = roomId;
    this.server = server;
    this.iceConfig = iceConfig;
    this.pcConstraints = pcConstraints;
    this._sdpTransform = sdpTransform;
    this.onMsg = onMsg;
    this.log = (m: string) => {
      const msg = `[${nowIso()}][${label}] ${m}`;
      log?.(msg);
      // Mirror to console for easy diagnostics
      console.log(msg);
    };
    this.requestTurn = requestTurn;
    this.onConnected = onConnected;
    this.onCandidate = onCandidate;
    this.onStats = onStats;
    this.onDown = onDown;
    this.onChat = onChat;
    this.onStateChange = onStateChange;
    this.trickle = trickleCandidates;
    this._onSignalingConnected = onSignalingConnected;

    this.signaling = new SignalingClient({ server, roomId, log: (m) => this.log(m), requestTurn });
    if (this.pcConstraints) {
      // Retain support for legacy proprietary constraints without violating modern TS typings.
      this.pc = new (RTCPeerConnection as any)(iceConfig as any, this.pcConstraints);
    } else {
      this.pc = new RTCPeerConnection(iceConfig as any);
    }

    this.polite = politeHint;

    this._setupDataChannel();

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        const init = e.candidate.toJSON();
        try {
          this.log(`local ICE candidate JSON=${JSON.stringify(init)}`);
        } catch (jsonErr: any) {
          this.log(`local ICE candidate JSON stringify failed: ${jsonErr.message}`);
        }
        if (this.trickle) {
          this.signaling.send({ type: 'candidate', candidate: init });
        } else {
          this.log('trickle disabled; not signaling candidate');
        }
        const parsed = init.candidate ? parseCandidateLine(init.candidate) : null;
        if (!parsed) {
          this.log(`local ICE candidate parse failed; raw="${init.candidate || ''}"`);
        } else {
          this.log(
            `local ICE candidate ${parsed.type}/${parsed.protocol} ${parsed.ip}:${parsed.port} foundation=${parsed.foundation}`,
          );
        }
        this.onCandidate?.({ dir: 'local', at: nowIso(), parsed, raw: init.candidate });
      } else {
        // end-of-candidates
        this._resolveIceComplete();
        this.onCandidate?.({
          dir: 'local',
          at: nowIso(),
          parsed: { type: 'end-of-candidates' },
          raw: '',
        });
      }
    };
    this.pc.onicegatheringstatechange = () => {
      this.log(`iceGatheringState=${this.pc.iceGatheringState}`);
      if (this.pc.iceGatheringState === 'complete') this._resolveIceComplete();
      this.onStateChange?.({ iceGatheringState: this.pc.iceGatheringState, label: this.label });
    };
    this.pc.oniceconnectionstatechange = () => {
      this.log(`iceConnectionState=${this.pc.iceConnectionState}`);
      if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
        this._clearDisconnectTimer();
      }
      if (this.pc.iceConnectionState === 'failed') {
        this._notifyDownImmediately('ice-failed');
      } else if (this.pc.iceConnectionState === 'disconnected') {
        this._notifyDownAfterGrace('ice-disconnected');
      }
      this.onStateChange?.({ iceConnectionState: this.pc.iceConnectionState, label: this.label });
    };
    this.pc.onconnectionstatechange = () => {
      this.log(`connectionState=${this.pc.connectionState}`);
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this._notifyDownImmediately(`pc-${this.pc.connectionState}`);
      }
      this.onStateChange?.({ connectionState: this.pc.connectionState, label: this.label });
    };
    this.pc.onsignalingstatechange = () => {
      this.log(`signalingState=${this.pc.signalingState}`);
      this.onStateChange?.({ signalingState: this.pc.signalingState, label: this.label });
    };
    this.pc.onicecandidateerror = (ev: any) => {
      this.log(
        `iceCandidateError hostCandidate=${ev.hostCandidate || '-'} url=${ev.url || '-'} errorCode=${
          ev.errorCode
        } errorText=${ev.errorText || '-'}`,
      );
    };

    this.pc.onnegotiationneeded = async () => {
      this.log('onnegotiationneeded');
      if (this._shouldDeferNegotiation()) {
        this.log('deferring negotiation until signaling accept is received');
        this._negotiationDeferred = true;
        return;
      }
      await this._makeOffer('onnegotiationneeded');
    };

    // Wire signaling events
    this.signaling.on('accept', async (acc) => {
      if (acc?.isExistClient) this.polite = true;
      this.log(`polite=${this.polite ? 'true' : 'false'} (isExistClient=${!!acc?.isExistClient})`);
      this._acceptReceived = true;
      try {
        this.log(`accept payload: ${JSON.stringify(acc)}`);
      } catch (jsonErr: any) {
        this.log(`accept payload stringify failed: ${jsonErr.message}`);
      }

      // apply ICE servers
      const incomingServers = Array.isArray(acc?.iceServers) ? acc.iceServers : [];
      const baseServers = Array.isArray(this.iceConfig?.iceServers) ? this.iceConfig.iceServers! : [];
      applyIceServersToPc(this.pc, baseServers, incomingServers, (m) => this.log(m));

      if (this.requestTurn && !incomingServers.length) {
        this.log('accept did not include additional ICE servers; retaining existing configuration');
      }

      await this._handlePostAcceptNegotiation();
    });

    this.signaling.on('offer', async (msg) => {
      this.log(
        `handle inbound offer len=${msg.sdp?.length ?? 0} polite=${this.polite} signalingState=${this.pc.signalingState}`,
      );
      await this._handleOffer(msg.sdp);
    });

    this.signaling.on('answer', async (msg) => {
      this.log(`handle inbound answer len=${msg.sdp?.length ?? 0} signalingState=${this.pc.signalingState}`);
      await this._safeSetRemote({ type: 'answer', sdp: msg.sdp } as any);
    });

    this.signaling.on('candidate', async (msg) => {
      await this._handleInboundIceCandidateMessage(msg);
    });
  }

  async start(): Promise<void> {
    await this.signaling.connect();
    this._onSignalingConnected?.();
    this._statsTimer = setInterval(async () => {
      if (this.closed) return;
      const stats = await gatherSelectedPair(this.pc).catch(() => null);
      if (stats?.selectedPair) {
        const { selectedPair, local, remote } = stats;
        this.onStats?.({ selectedPair, local, remote });
      }
    }, 1000);
  }

  private _setupDataChannel() {
    this.dc = this.pc.createDataChannel('dc0', {
      negotiated: true,
      id: 0,
      ordered: false,
      maxRetransmits: 0,
    });
    (this.dc as any).binaryType = 'arraybuffer';
    const { label, negotiated, id, ordered, maxPacketLifeTime, maxRetransmits } = this.dc;
    this.log(
      `datachannel configured (label=${label} negotiated=${negotiated} id=${id} ordered=${ordered} maxRetransmits=${
        maxRetransmits ?? 'none'
      } maxPacketLifeTime=${maxPacketLifeTime ?? 'none'})`,
    );

    this.dc.onopen = () => {
      this.log(
        `datachannel open (negotiated id=${id} ordered=${ordered} reliable=${
          maxPacketLifeTime == null && maxRetransmits == null
        } maxRetransmits=${maxRetransmits ?? 'none'})`,
      );
      this._startKeepAlive();
      this._markConnected('dc-open');
    };

    this.dc.onclose = () => {
      this.log(`datachannel close`);
      this._stopKeepAlive();
      this._notifyDownAfterGrace('dc-close');
    };

    this.dc.onmessage = (ev: MessageEvent) => {
      const data = (ev as any).data;
      if (data instanceof ArrayBuffer) {
        const view = new Uint8Array(data);
        if (view.length === 1 && view[0] === 0x01) return; // keepalive ping
        try {
          this.onMsg?.(data);
        } catch {}
        return;
      }
      if (typeof data === 'string') {
        const text = data as string;
        this.onChat?.({ dir: 'in', text, at: nowIso(), via: this.label });
        try {
          this.onMsg?.(text);
        } catch {}
      }
    };
  }

  private async _handleOffer(sdp: string) {
    try {
      const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) {
        this.log('glare: ignoring offer (impolite)');
        return;
      }
      if (offerCollision) {
        this.log(
          `offer collision detected; performing rollback (polite=${this.polite ? 'true' : 'false'})`,
        );
        await this.pc.setLocalDescription({ type: 'rollback' } as any);
        this.log('rollback complete');
      }
      await this.pc.setRemoteDescription({ type: 'offer', sdp } as any);
      this.log('setRemoteDescription(offer)');
      this._ingestRemoteSdpCandidates(sdp, 'offer');

      const answer = await this.pc.createAnswer();
      this.log(`createAnswer -> sdp len=${answer.sdp?.length ?? 0}`);
      await this.pc.setLocalDescription(answer);
      this.log('setLocalDescription(answer)');

      const baseSdp = finalizeSdpForSend(this.pc.localDescription!.sdp!, this.trickle);
      const answerSdp = this._sdpTransform ? this._sdpTransform(baseSdp) : baseSdp;
      this.signaling.sendAnswer(answerSdp);
    } catch (e: any) {
      this.log(`handleOffer error: ${e.message}`);
    }
  }

  private async _safeSetRemote(desc: RTCSessionDescriptionInit) {
    try {
      await this.pc.setRemoteDescription(desc);
      this.log(`setRemoteDescription(${desc.type}) -> signalingState=${this.pc.signalingState}`);
      if ((desc as any)?.sdp) this._ingestRemoteSdpCandidates((desc as any).sdp, desc.type || '?');
    } catch (e: any) {
      this.log(`setRemoteDescription error: ${e.message}`);
    }
  }

  private async _handleInboundIceCandidateMessage(msg: any) {
    try {
      if (!msg?.candidate || this.closed) return;
      await this.pc.addIceCandidate(msg.candidate).catch((e) => {
        this.log(`addIceCandidate warning: ${e.message}`);
      });
      const line = msg.candidate?.candidate || '';
      const trimmed = line.trim();
      let emit = true;
      if (trimmed) {
        if (this._seenRemoteSdpCandidates.has(trimmed)) {
          emit = false;
        } else {
          this._seenRemoteSdpCandidates.add(trimmed);
        }
      }
      const parsed = line ? parseCandidateLine(line) : null;
      if (!parsed) {
        this.log(`remote ICE candidate parse failed; raw="${line || ''}"`);
      } else if (emit) {
        this.log(
          `remote ICE candidate ${parsed.type}/${parsed.protocol} ${parsed.ip}:${parsed.port} foundation=${parsed.foundation}`,
        );
      }
      try {
        this.log(`remote ICE candidate JSON=${JSON.stringify(msg.candidate)}`);
      } catch (jsonErr: any) {
        this.log(`remote ICE candidate JSON stringify failed: ${jsonErr.message}`);
      }
      if (emit) {
        this.onCandidate?.({ dir: 'remote', at: nowIso(), parsed, raw: line });
      }
    } catch (e: any) {
      this.log(`candidate error: ${e.message}`);
    }
  }

  private _notifyDown(reason: string, graceMs = 0) {
    if (this.closed) return;
    this._clearDisconnectTimer();
    if (graceMs > 0) {
      this._disconnectTimer = setTimeout(() => this.onDown?.(reason), graceMs);
    } else {
      this.onDown?.(reason);
    }
  }
  private _notifyDownImmediately(reason: string) {
    if (this.closed) return;
    this._notifyDown(reason, 0);
  }
  private _notifyDownAfterGrace(reason: string) {
    if (this.closed) return;
    this._notifyDown(reason, 3000);
  }
  private _clearDisconnectTimer() {
    if (this._disconnectTimer) clearTimeout(this._disconnectTimer);
    this._disconnectTimer = null;
  }

  private _waitForIceComplete(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      this._iceCompleteResolvers.push(resolve);
    });
  }

  private _resolveIceComplete() {
    if (!this._iceCompleteResolvers.length) return;
    this._iceCompleteResolvers.splice(0).forEach((res) => {
      try {
        res();
      } catch {}
    });
  }

  private _ingestRemoteSdpCandidates(sdp: string, source: string) {
    if (!sdp) return;
    const lines = extractSdpCandidates(sdp);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || this._seenRemoteSdpCandidates.has(trimmed)) return;
      this._seenRemoteSdpCandidates.add(trimmed);
      const parsed = parseCandidateLine(trimmed);
      if (!parsed) {
        this.log(`remote SDP candidate parse failed (source=${source}) raw="${trimmed}"`);
        return;
      }
      this.log(
        `remote SDP candidate ${parsed.type}/${parsed.protocol} ${parsed.ip}:${parsed.port} foundation=${parsed.foundation} (source=${source})`,
      );
      this.onCandidate?.({ dir: 'remote', at: nowIso(), parsed, raw: trimmed });
    });
  }

  private _shouldDeferNegotiation(): boolean {
    return !this._acceptReceived;
  }

  private _markConnected(source = 'unknown') {
    if (this.closed || this._connectedNotified) return;
    this._connectedNotified = true;
    this._clearDisconnectTimer();
    this.log(`connection marked alive via ${source}`);
    try {
      this.onConnected?.(source);
    } catch (err: any) {
      this.log(`onConnected callback error: ${err.message}`);
    }
  }

  private async _makeOffer(trigger = 'manual') {
    if (this.closed) return;
    if (this.makingOffer) {
      this.log(`${trigger}: negotiation already in progress; skipping`);
      return;
    }
    this._negotiationDeferred = false;
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      this.log(`${trigger}: createOffer -> sdp len=${offer.sdp?.length ?? 0}`);
      await this.pc.setLocalDescription(offer);
      this.log(`${trigger}: setLocalDescription(offer)`);

      if (!this.trickle) {
        this.log(`${trigger}: waiting for ICE gather to complete (trickle disabled)`);
        await this._waitForIceComplete();
        this.log(`${trigger}: ICE gather complete; sending offer with embedded candidates`);
      }

      const sdpPrepared = finalizeSdpForSend(this.pc.localDescription!.sdp!, this.trickle);
      const toSend = this._sdpTransform ? this._sdpTransform(sdpPrepared) : sdpPrepared;
      this.signaling.sendOffer(toSend);
      this._hasMadeInitialOffer = true;
    } catch (err: any) {
      this.log(`negotiation error (${trigger}): ${err.message}`);
    } finally {
      this.makingOffer = false;
    }
  }

  private async _handlePostAcceptNegotiation() {
    if (this.closed) return;
    if (this._negotiationDeferred || !this._hasMadeInitialOffer) {
      this.log('post-accept: initiating deferred negotiation');
      await this._makeOffer('post-accept');
    }
  }

  private _startKeepAlive() {
    this._ka && clearInterval(this._ka);
    const payload = new Uint8Array([0x01]);
    this._ka = setInterval(() => {
      try {
        this.dc.readyState === 'open' && this.dc.send(payload);
      } catch {}
    }, 5000);
  }

  private _stopKeepAlive() {
    this._ka && clearInterval(this._ka);
    this._ka = null;
  }

  simulateDisconnect() {
    this.log('simulateDisconnect(): closing peer connection intentionally');
    try {
      this.dc?.close();
    } catch {}
    try {
      this.pc?.close();
    } catch {}
  }

  end() {
    this.closed = true;
    this._stopKeepAlive();
    this._clearDisconnectTimer();
    this._statsTimer && clearInterval(this._statsTimer);
    this._resolveIceComplete();
    try {
      this.dc.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
    try {
      this.signaling.close();
    } catch {}
  }

  send(data: ArrayBuffer | ArrayBufferView | Blob | string): boolean {
    if (this.closed) {
      this.log('send: datachannel not open');
      return false;
    }
    const ok = safeDcSend(this.dc, data);
    if (!ok) this.log('send: datachannel not open');
    return ok;
  }
}

interface DualCoordOpts {
  baseRoomId: string;
  server: string;
  log?: (m: string) => void;
  onUpdate?: (snap: any) => void;
  onChat?: (msg: any) => void;
  onMsg?: (peer: 'local' | 'remote' | string, data: ArrayBuffer | string) => void;
  pcOptions?: RTCConfiguration;
  pcConstraints?: any;
  sdpTransform?: (s: string) => string;
  enableLocalPath?: boolean;
}

export interface SignalingPathSnapshot {
  stats: any;
  localCandidates: any[];
  remoteCandidates: any[];
}

export interface SIGCFStatusSnapshot {
  connected: boolean;
  winner: 'local' | 'remote' | undefined;
  reconnecting: boolean;
  nextBackoffMs: number;
  attempt: number;
  s1: SignalingPathSnapshot;
  s2: SignalingPathSnapshot;
}

export class DualRoomCoordinator {
  base: string;
  server: string;
  log: (m: string) => void;
  onUpdate?: (snap: any) => void;
  onChat?: (msg: any) => void;
  onMsg?: (peer: 'local' | 'remote' | string, data: ArrayBuffer | string) => void;
  _pcOptions?: RTCConfiguration;
  _pcConstraints?: any;
  _sdpTransform?: (s: string) => string;
  private _enableLocalPath: boolean;

  connected = false;
  reconnecting = false;
  private _backoffMs = 1000;
  private _reconnectInFlight = false;
  private _attempt = 0;
  private _connectionWaiters = new Set<{ settled: boolean; timer: any; done: (v: boolean) => void }>();
  private _connectTimeoutMs = 10000;
  private _backoffInterrupt: (() => void) | null = null;
  private _backoffWaiting = false;
  private _idleCleanup: Array<() => void> = [];
  private _lastWakeTriggerMs = 0;
  private _mouseIdle = true;
  private _mouseIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;
  private _candidateWatchTimer: ReturnType<typeof setTimeout> | null = null;

  localCandidates: any[] = [];
  remoteCandidates: any[] = [];
  remote2Candidates: any[] = [];
  local2Candidates: any[] = [];

  s1: RoomSession | null = null;
  s2: RoomSession | null = null;
  winner: 'local' | 'remote' | undefined;
  nextBackoffMs = 0;
  stats1: any = null;
  stats2: any = null;

  constructor(opts: DualCoordOpts) {
    this.base = opts.baseRoomId;
    this.server = opts.server;
    this.log = opts.log || (() => {});
    this.onUpdate = opts.onUpdate;
    this.onChat = opts.onChat;
    this.onMsg = opts.onMsg;
    this._pcOptions = opts.pcOptions;
    this._pcConstraints = opts.pcConstraints;
    this._sdpTransform = opts.sdpTransform;
    this._enableLocalPath = opts.enableLocalPath !== false;

    this._setupIdleWakeListeners();
  }

  private _setupIdleWakeListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        this._handleWakeEvent('visibility');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this._idleCleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));

    const onMouseMove = () => {
      this._handleMouseMove();
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    this._idleCleanup.push(() => window.removeEventListener('mousemove', onMouseMove));

    this._scheduleMouseIdleReset();
  }

  private _teardownIdleWakeListeners() {
    if (this._mouseIdleTimer) {
      clearTimeout(this._mouseIdleTimer);
      this._mouseIdleTimer = null;
    }
    this._mouseIdle = true;
    if (!this._idleCleanup.length) {
      return;
    }
    const cleanup = this._idleCleanup.splice(0);
    cleanup.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore listener cleanup errors
      }
    });
  }

  private _handleMouseMove() {
    if (typeof window === 'undefined') {
      return;
    }
    if (this._mouseIdle) {
      this._handleWakeEvent('mouse');
    }
    this._mouseIdle = false;
    this._scheduleMouseIdleReset();
  }

  private _handleSignalingJoin(label: 'local' | 'remote') {
    if (this._stopped) {
      return;
    }
    if (label !== 'remote') {
      return;
    }
    this.log(
      `signaling joined on ${label} path; awaiting remote ICE candidates for up to ${CANDIDATE_TIMEOUT_MS}ms`,
    );
    this._armCandidateWatchdog(label);
  }

  private _armCandidateWatchdog(label: 'local' | 'remote') {
    if (this._stopped) {
      return;
    }
    this._clearCandidateWatchdog();
    this._candidateWatchTimer = setTimeout(() => {
      this._candidateWatchTimer = null;
      const hasRemoteCandidates = this._hasRemoteCandidates();
      if (this._stopped || this.connected || hasRemoteCandidates) {
        return;
      }
      this.log(
        `no remote ICE candidates observed within ${CANDIDATE_TIMEOUT_MS}ms of signaling join (path=${label}); forcing reconnect`,
      );
      this._scheduleReconnect('candidate-timeout');
    }, CANDIDATE_TIMEOUT_MS);
  }

  private _clearCandidateWatchdog() {
    if (this._candidateWatchTimer) {
      clearTimeout(this._candidateWatchTimer);
      this._candidateWatchTimer = null;
    }
  }

  private _handleRemoteCandidateObserved(label: 'local' | 'remote') {
    if (!this._candidateWatchTimer) {
      return;
    }
    this.log(`remote ICE candidate observed via ${label}; clearing candidate watchdog`);
    this._clearCandidateWatchdog();
  }

  private _hasRemoteCandidates(): boolean {
    return this.remoteCandidates.length > 0 || this.remote2Candidates.length > 0;
  }

  private _scheduleMouseIdleReset() {
    if (this._mouseIdleTimer) {
      clearTimeout(this._mouseIdleTimer);
      this._mouseIdleTimer = null;
    }
    if (typeof window === 'undefined') {
      return;
    }
    this._mouseIdleTimer = setTimeout(() => {
      this._mouseIdle = true;
      this._mouseIdleTimer = null;
    }, MOUSE_IDLE_THRESHOLD_MS);
  }

  private _handleWakeEvent(source: 'visibility' | 'mouse') {
    if (this._stopped) {
      return;
    }
    const now = Date.now();
    if (now - this._lastWakeTriggerMs < BACKOFF_WAKE_DEBOUNCE_MS) {
      return;
    }
    if (!this._reconnectInFlight || !this._backoffWaiting) {
      return;
    }
    if (this.connected) {
      return;
    }

    this._lastWakeTriggerMs = now;
    this.log(`wakeup via ${source}; resetting backoff and retrying immediately`);
    this._resetBackoffForWake();
  }

  private _resetBackoffForWake() {
    if (this._stopped) {
      return;
    }
    this._backoffMs = 1000;
    this._attempt = 1;
    if (this._backoffInterrupt) {
      const interrupt = this._backoffInterrupt;
      this._backoffInterrupt = null;
      this.nextBackoffMs = 0;
      this._tick();
      interrupt();
    }
  }

  private async _waitWithInterrupt(delay: number): Promise<void> {
    if (delay <= 0) {
      return;
    }
    if (this._stopped) {
      return;
    }
    this._backoffWaiting = true;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finalize = () => {
        if (settled) return;
        settled = true;
        this._backoffWaiting = false;
        this._backoffInterrupt = null;
        resolve();
      };
      const timer = setTimeout(() => {
        finalize();
      }, delay);
      this._backoffInterrupt = () => {
        if (settled) {
          return;
        }
        clearTimeout(timer);
        finalize();
      };
    });
  }

  async start(): Promise<void> {
    if (this._stopped) {
      return;
    }
    this._clearCandidateWatchdog();
    this.localCandidates = [];
    this.remoteCandidates = [];
    this.local2Candidates = [];
    this.remote2Candidates = [];
    this.stats1 = null;
    this.stats2 = null;
    this.winner = undefined;

    const remoteCfg: RTCConfiguration = {
      ...(this._pcOptions || {}),
      iceServers: [],
      iceCandidatePoolSize: 2 as any,
      iceTransportPolicy: 'relay' as any,
    };

    const startPromises: Array<Promise<unknown>> = [];

    if (this._enableLocalPath) {
      const localCfg: RTCConfiguration = { ...(this._pcOptions || {}), iceServers: [] };
      const localRoom = `${this.base}_local`;
      this.s1 = this._initSession('local', {
        roomId: localRoom,
        iceConfig: localCfg,
        requestTurn: false,
        trickle: false,
      });
      startPromises.push(this.s1.start());
    } else {
      if (this.s1) {
        try {
          this.s1.end();
        } catch {}
      }
      this.s1 = null;
      this.log('LAN path disabled; skipping local signaling session');
    }

    const remoteRoom = `${this.base}_remote`;
    this.s2 = this._initSession('remote', {
      roomId: remoteRoom,
      iceConfig: remoteCfg,
      requestTurn: true,
      trickle: true,
    });
    startPromises.push(this.s2.start());

    const results = await Promise.allSettled(startPromises);
    if (this._stopped) {
      return;
    }
    const allRejected = results.every((r) => r.status === 'rejected');
    if (allRejected && !this.connected && !this._stopped) {
      this.log(`both session starts failed; scheduling reconnect`);
      this._scheduleReconnect('startup-failed');
    }
    if (!this._stopped) {
      this._tick();
    }
  }

  private _onConnected(which: 'local' | 'remote') {
    if (this._stopped) {
      return;
    }
    this._clearCandidateWatchdog();
    const firstConnection = !this.connected;
    if (firstConnection) {
      this.connected = true;
      this.reconnecting = false;
      this._reconnectInFlight = false;
      this._backoffMs = 1000;
      this._attempt = 0;
      this.log(
        `DATA CHANNEL ONLINE via ${which}; ${
          which === 'local' ? 'prioritizing local path' : 'keeping local attempt alive for takeover'
        }`,
      );
    }

    let closedRemote = false;
    if (!this.winner) {
      this.winner = which;
      if (which === 'local') {
        closedRemote = this._closeRemoteSession('local-initial');
      }
    } else if (this.winner !== which) {
      if (which === 'local') {
        this.log('Local data channel opened; switching from remote to local and closing remote peer');
        this.winner = 'local';
        closedRemote = this._closeRemoteSession('local-takeover');
      } else {
        this.log('Remote data channel opened but local already active; closing redundant remote peer');
        closedRemote = this._closeRemoteSession('remote-after-local');
        this._resolveConnectionWaiters(true);
        if (firstConnection || closedRemote) this._tick();
        return;
      }
    }

    this._resolveConnectionWaiters(true);
    if (firstConnection || closedRemote || this.winner === which) {
      this._tick();
    }
  }

  private _onDown(which: 'local' | 'remote', reason: string) {
    if (this._stopped) {
      return;
    }
    this._clearCandidateWatchdog();
    this.log(`DOWN detected on ${which}: ${reason}`);
    const active = this.winner;
    if (active && active !== which) {
      this.log(`down event on non-primary path (${which}); ignoring`);
      return;
    }
    this.connected = false;
    this._resolveConnectionWaiters(false);
    this._scheduleReconnect(reason);
  }

  private _initSession(
    label: 'local' | 'remote',
    opts: { roomId: string; iceConfig: RTCConfiguration; requestTurn: boolean; trickle: boolean },
  ): RoomSession {
    const onCandidate = (c: any) => {
      if (label === 'local') {
        if (c.dir === 'local') this.localCandidates.push(c);
        else this.remoteCandidates.push(c);
      } else {
        if (c.dir === 'local') this.local2Candidates.push(c);
        else this.remote2Candidates.push(c);
      }
      if (c.dir === 'remote') {
        this._handleRemoteCandidateObserved(label);
      }
      this._tick();
    };

    const onStats = (stats: any) => {
      if (label === 'local') this.stats1 = stats;
      else this.stats2 = stats;
      this._tick();
    };

    return new RoomSession({
      label,
      roomId: opts.roomId,
      server: this.server,
      iceConfig: opts.iceConfig,
      politeHint: true,
      requestTurn: opts.requestTurn,
      log: this.log,
      onConnected: () => this._onConnected(label),
      onCandidate,
      onStats,
      trickleCandidates: opts.trickle,
      onDown: (reason) => this._onDown(label, reason),
      onChat: (msg) => this._emitChat(msg),
      onStateChange: () => {},
      pcConstraints: this._pcConstraints,
      sdpTransform: this._sdpTransform,
      onMsg: (data) => this._emitMsg(label, data),
      onSignalingConnected: () => this._handleSignalingJoin(label),
    });
  }

  private _scheduleReconnect(reason: string) {
    this._clearCandidateWatchdog();
    if (this._stopped) return;
    if (this._reconnectInFlight) return;
    this._reconnectInFlight = true;
    this.reconnecting = true;
    this.connected = false;
    this._resolveConnectionWaiters(false);
    this._attempt += 1;
    this._tick();
    const loop = async () => {
      try {
        this.s1?.end();
      } catch {}
      try {
        this.s2?.end();
      } catch {}
      this.s1 = null;
      this.s2 = null;
      this.stats1 = null;
      this.stats2 = null;
      this.localCandidates = [];
      this.remoteCandidates = [];
      this.local2Candidates = [];
      this.remote2Candidates = [];
      this.winner = undefined;
      if (this._stopped) {
        this._reconnectInFlight = false;
        this.reconnecting = false;
        return;
      }
      this._tick();

      const delay = Math.min(this._backoffMs, 30000);
      this.log(`reconnect attempt #${this._attempt} in ${Math.ceil(delay / 1000)}s (reason=${reason})`);
      this.nextBackoffMs = delay;
      this._tick();
      await this._waitWithInterrupt(delay);
      if (this._stopped) {
        this._reconnectInFlight = false;
        this.reconnecting = false;
        this.nextBackoffMs = 0;
        return;
      }
      this.nextBackoffMs = 0;
      this._tick();

      let startError: any = null;
      try {
        await this.start();
      } catch (e: any) {
        if (!this._stopped) {
          startError = e;
          this.log(`reconnect start error: ${e.message}`);
        }
      }

      if (this._stopped) {
        this._reconnectInFlight = false;
        this.reconnecting = false;
        return;
      }

      if (startError) {
        this._reconnectInFlight = false;
        this._backoffMs = Math.min(this._backoffMs * 2, 30000);
        this._scheduleReconnect('start-error');
        return;
      }

      const connected = await this._waitForConnected(this._connectTimeoutMs);
      if (this._stopped) {
        this._reconnectInFlight = false;
        this.reconnecting = false;
        return;
      }
      if (connected || this.connected) {
        this.log('reconnect successful');
        this.reconnecting = false;
        this._reconnectInFlight = false;
        this._backoffMs = 1000;
        this._attempt = 0;
        this._tick();
        return;
      }

      this.log(`reconnect attempt timed out after ${Math.ceil(this._connectTimeoutMs / 1000)}s`);
      this._backoffMs = Math.min(this._backoffMs * 2, 30000);
      this._reconnectInFlight = false;
      if (!this._stopped) {
        this._scheduleReconnect('timeout');
      }
    };
    loop().catch((e) => {
      if (this._stopped) {
        this._reconnectInFlight = false;
        this.reconnecting = false;
        return;
      }
      this.log(`reconnect loop error: ${e.message}`);
      this._reconnectInFlight = false;
      this._tick();
    });
  }

  private _waitForConnected(timeoutMs = 10000): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const watcher = {
        settled: false,
        timer: null as any,
        done: (value: boolean) => {
          if (watcher.settled) return;
          watcher.settled = true;
          if (watcher.timer) clearTimeout(watcher.timer);
          this._connectionWaiters.delete(watcher);
          resolve(value);
        },
      };
      if (timeoutMs > 0) {
        watcher.timer = setTimeout(() => watcher.done(false), timeoutMs);
      }
      this._connectionWaiters.add(watcher);
    });
  }

  private _resolveConnectionWaiters(value: boolean) {
    if (!this._connectionWaiters?.size) return;
    const waiters = Array.from(this._connectionWaiters);
    this._connectionWaiters.clear();
    for (const watcher of waiters) {
      watcher.done(value);
    }
  }

  private _tick() {
    this.onUpdate?.(
      this.snapshot(),
    );
  }

  private _closeRemoteSession(reason = 'unspecified'): boolean {
    if (!this.s2) return false;
    this.log(`closing remote session (${reason})`);
    try {
      this.s2.end();
    } catch (err: any) {
      this.log(`remote session end error: ${err.message}`);
    }
    this.s2 = null;
    this.stats2 = null;
    this.local2Candidates = [];
    this.remote2Candidates = [];
    return true;
  }

  private _emitChat(msg: any) {
    this.onChat?.(msg);
  }

  private _emitMsg(peer: 'local' | 'remote', data: ArrayBuffer | string) {
    try {
      this.onMsg?.(peer, data);
    } catch (e: any) {
      this.log?.(`onMsg error: ${e.message}`);
    }
  }

  send(data: ArrayBuffer | ArrayBufferView | Blob | string, which?: 'local' | 'remote'): boolean {
    if (which === 'local') return !!this.s1?.send(data as any);
    if (which === 'remote') return !!this.s2?.send(data as any);
    if (this.winner === 'local') return !!this.s1?.send(data as any);
    if (this.winner === 'remote') return !!this.s2?.send(data as any);
    const ok1 = this.s1?.send(data as any);
    const ok2 = this.s2?.send(data as any);
    return !!(ok1 || ok2);
  }

  end() {
    this._teardownIdleWakeListeners();
    this._clearCandidateWatchdog();
    if (this._stopped) {
      return;
    }
    this._stopped = true;
    this.connected = false;
    this.reconnecting = false;
    this._reconnectInFlight = false;
    this._backoffWaiting = false;
    this.nextBackoffMs = 0;
    this._resolveConnectionWaiters(false);
    if (this._backoffInterrupt) {
      const interrupt = this._backoffInterrupt;
      this._backoffInterrupt = null;
      interrupt();
    }
    this.s1?.end();
    this.s2?.end();
    this.s1 = null;
    this.s2 = null;
    this.stats1 = null;
    this.stats2 = null;
    this.localCandidates = [];
    this.remoteCandidates = [];
    this.local2Candidates = [];
    this.remote2Candidates = [];
    this.winner = undefined;
  }

  triggerImmediateReconnect(reason = 'manual'): boolean {
    if (this._stopped) {
      return false;
    }
    if (this.connected) {
      this.log(`manual reconnect ignored; already connected`);
      return false;
    }
    if (!this._reconnectInFlight) {
      this.log(`manual reconnect requested; scheduling reconnect (reason=${reason})`);
      this._scheduleReconnect(reason);
      this._resetBackoffForWake();
      return true;
    }
    this.log('manual reconnect requested; interrupting backoff timer');
    this._resetBackoffForWake();
    return true;
  }

  snapshot(): SIGCFStatusSnapshot {
    return {
      connected: this.connected,
      winner: this.winner,
      reconnecting: this.reconnecting,
      nextBackoffMs: this.nextBackoffMs || 0,
      attempt: this._attempt || 0,
      s1: {
        stats: this.stats1,
        localCandidates: this.localCandidates,
        remoteCandidates: this.remoteCandidates,
      },
      s2: {
        stats: this.stats2,
        localCandidates: this.local2Candidates,
        remoteCandidates: this.remote2Candidates,
      },
    };
  }

  simulateDisconnect() {
    if (this.winner === 'local') this.s1?.simulateDisconnect();
    else if (this.winner === 'remote') this.s2?.simulateDisconnect();
    else {
      this.s1?.simulateDisconnect();
      this.s2?.simulateDisconnect();
    }
  }
}

export class SIGCF {
  roomId: string;
  workerUrl: string;
  startedAt: string;
  private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();
  private _coord: DualRoomCoordinator;
  private _lastConnected = false;

  constructor(
    roomId: string,
    {
      workerUrl,
      rtcPeerConnectionOptions,
      rtcPeerConnectionProprietaryConstraints,
      sdpTransform,
      log,
      enableLocalPath,
    }: {
      workerUrl: string;
      rtcPeerConnectionOptions?: RTCConfiguration;
      rtcPeerConnectionProprietaryConstraints?: any;
      sdpTransform?: (s: string) => string;
      log?: (m: string) => void;
      enableLocalPath?: boolean;
    } = { workerUrl: '' as any },
  ) {
    this.roomId = roomId;
    this.workerUrl = (workerUrl || '').replace(/\/$/, '');
    this.startedAt = nowIso();

    this._coord = new DualRoomCoordinator({
      baseRoomId: roomId,
      server: this.workerUrl,
      log: typeof log === 'function' ? log : () => {},
      onUpdate: (snap) => {
        this._emit('status', {
          roomId: this.roomId,
          server: this.workerUrl,
          localRoom: `${this.roomId}_local`,
          remoteRoom: `${this.roomId}_remote`,
          startedAt: this.startedAt,
          ...snap,
        });
        if (snap.connected !== this._lastConnected) {
          this._lastConnected = snap.connected;
          this._emit(snap.connected ? 'connected' : 'disconnected');
        }
      },
      onChat: (msg) => {
        this._emit('chat', { ...msg });
        this._emit('msg', (msg.via || this._coord?.winner || 'unknown') as any, msg.text);
      },
      onMsg: (peer, data) => {
        this._emit('msg', peer, data);
      },
      pcOptions: rtcPeerConnectionOptions,
      pcConstraints: rtcPeerConnectionProprietaryConstraints,
      sdpTransform: typeof sdpTransform === 'function' ? sdpTransform : (s) => s,
      enableLocalPath,
    });
  }

  on(type: string, fn: (...args: any[]) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.off(type, fn);
  }
  off(type: string, fn: (...args: any[]) => void) {
    const set = this.handlers.get(type);
    if (!set) return;
    set.delete(fn);
    if (!set.size) this.handlers.delete(type);
  }
  private _emit(type: string, ...args: any[]) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch {}
    }
  }

  start(): Promise<void> {
    return this._coord.start();
  }

  /**
   * Send bytes or text over the active data channel.
   */
  send(peer: 'local' | 'remote' | undefined, data: ArrayBuffer | ArrayBufferView | Blob | string): boolean {
    const which = peer || (this._coord?.winner as any);
    return !!this._coord?.send(data as any, which);
  }

  forceReconnect(): boolean {
    try {
      return this._coord?.triggerImmediateReconnect?.() ?? false;
    } catch {
      return false;
    }
  }

  simulateDisconnect() {
    try {
      this._coord?.simulateDisconnect?.();
    } catch {}
  }

  destroy() {
    try {
      this._coord?.end();
    } catch {}
    this.handlers.clear();
  }
}

export default SIGCF;
