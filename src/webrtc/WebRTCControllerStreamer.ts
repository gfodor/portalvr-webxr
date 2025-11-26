/**
 * WebRTC controller streaming logic used by the emulator runtime.
 * - Copies the signaling + dual-room strategy into TS (see src/webrtc/*).
 * - Auto-connects to room 'test' by default and streams controller pose packets.
 */

import type { XRFrame } from '../frameloop/XRFrame.js';
import { SIGCF, type SIGCFStatusSnapshot } from './sigcf.js';
import {
  parseControllerState,
  type ControllerState,
  isOrientationResetPacket,
  parseOrientationResetWand,
  PACKET_HANGUP,
} from './controllerParser.js';

export interface WebRTCControllerStreamOptions {
  /** Signaling base URL (no trailing slash). */
  workerUrl?: string;
  /** Room id base; defaults to 'test'. */
  roomId?: string;
  /** Invoked for verbose internal logging. */
  log?: (m: string) => void;
  /** Auto-start the connection as soon as the streamer is created. Default: true. */
  autoStart?: boolean;
  /** Enable the LAN-optimized (host candidate) path. Default: true. */
  enableLocalPath?: boolean;
  /** Called whenever a controller packet is decoded. */
  onControllerState?: (state: ControllerState) => void;
  /** Called when the data channel connection changes state. */
  onConnectionChange?: (connected: boolean) => void;
  /** Called when an orientation-reset packet is received. Includes which hand triggered the reset. */
  onOrientationReset?: (calibratingHand: 'left' | 'right') => void;
  /** Called when the underlying SIGCF status updates. */
  onSignalingStatus?: (status: SIGCFStatusSnapshot) => void;
}

const DEFAULT_SIGNALING_BASE = 'wss://cloudflare-signalling.portalvr.workers.dev';

export class WebRTCControllerStreamer {
  private readonly workerUrl: string;
  private readonly roomId: string;
  private readonly log: (m: string) => void;
  private readonly autoStart: boolean;
  private readonly enableLocalPath: boolean;
  private readonly onControllerState?: (state: ControllerState) => void;
  private readonly onConnectionChange?: (connected: boolean) => void;
  private readonly onOrientationReset?: (calibratingHand: 'left' | 'right') => void;
  private readonly onSignalingStatus?: (status: SIGCFStatusSnapshot) => void;

  private sigcf: SIGCF | null = null;
  private connected = false;
  private cleanupHandlers: Array<() => void> = [];
  private startPromise: Promise<void> | null = null;
  private lastSessionTimestampMs: number | null = null;
  private lastSessionTimestampReceivedAt = 0;
  private userInputMonitoringEnabled = false;

  constructor(options: WebRTCControllerStreamOptions = {}) {
    this.workerUrl = (options.workerUrl || DEFAULT_SIGNALING_BASE).replace(/\/$/, '');
    this.roomId = options.roomId || 'test2';
    this.log = typeof options.log === 'function' ? options.log : (m: string) => console.log(`[webrtc] ${m}`);
    this.autoStart = options.autoStart !== false;
    this.enableLocalPath = options.enableLocalPath !== false;
    this.onControllerState = options.onControllerState;
    this.onConnectionChange = options.onConnectionChange;
    this.onOrientationReset = options.onOrientationReset;
    this.onSignalingStatus = options.onSignalingStatus;

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handlePageUnload);
      window.addEventListener('pagehide', this.handlePageUnload);
    }

    if (this.autoStart) {
      this.ensureStarted();
    }
  }

  /** Process the current XR frame and emit telemetry. */
  update(_frame: XRFrame) {
    if (!this.sigcf) {
      this.ensureStarted();
    }
  }

  /** Dispose network resources and detach listeners. */
  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handlePageUnload);
      window.removeEventListener('pagehide', this.handlePageUnload);
    }
    this.cleanupHandlers.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // ignore
      }
    });
    this.cleanupHandlers = [];
    this.sigcf?.destroy();
    this.sigcf = null;
    this.startPromise = null;
    if (this.connected) {
      this.onConnectionChange?.(false);
    }
    this.connected = false;
    this.userInputMonitoringEnabled = false;
  }

  forceSignalingReconnect() {
    this.sigcf?.forceReconnect();
  }

  setUserInputMonitoringEnabled(enabled: boolean) {
    this.userInputMonitoringEnabled = enabled;
    if (!this.sigcf) {
      return;
    }
    this.sigcf.setUserInputMonitoring(enabled);
  }

  private ensureStarted() {
    if (this.sigcf || this.startPromise) {
      return;
    }
    this.sigcf = new SIGCF(this.roomId, {
      workerUrl: this.workerUrl,
      log: (m) => this.log(m),
      enableLocalPath: this.enableLocalPath,
    });
    this.sigcf.setUserInputMonitoring(this.userInputMonitoringEnabled);

    if (this.onSignalingStatus) {
      this.cleanupHandlers.push(
        this.sigcf.on('status', (status: any) => {
          this.onSignalingStatus?.(status as SIGCFStatusSnapshot);
        }),
      );
    }

    this.cleanupHandlers.push(
      this.sigcf.on('connected', () => {
        this.connected = true;
        this.log(`connected to room "${this.roomId}"`);
        this.lastSessionTimestampMs = null;
        this.lastSessionTimestampReceivedAt = 0;
        this.onConnectionChange?.(true);
      }),
    );
    this.cleanupHandlers.push(
      this.sigcf.on('disconnected', () => {
        this.connected = false;
        this.log('disconnected');
        this.lastSessionTimestampMs = null;
        this.lastSessionTimestampReceivedAt = 0;
        this.onConnectionChange?.(false);
      }),
    );
    this.cleanupHandlers.push(
      this.sigcf.on('msg', (_peer: string, data: any) => {
        if (data instanceof ArrayBuffer) {
          if (isOrientationResetPacket(data)) {
            const calibratingHand = parseOrientationResetWand(data);
            this.log(`received orientation reset packet (hand=${calibratingHand})`);
            this.onOrientationReset?.(calibratingHand);
            return;
          }
          const parsed = parseControllerState(data);
          if (parsed && this.shouldAcceptState(parsed)) {
            this.onControllerState?.(parsed);
          } else if (parsed) {
            this.log(
              `dropped controller packet ts=${parsed.sessionTimestampMs} (last=${this.lastSessionTimestampMs ?? 'none'})`,
            );
          }
        }
      }),
    );

    this.startPromise = this.sigcf
      .start()
      .catch((e: any) => {
        this.log(`start error: ${e?.message || e}`);
      })
      .finally(() => {
        this.startPromise = null;
      });
  }

  private handlePageUnload = (): void => {
    if (this.sigcf && this.connected) {
      try {
        const hangupPacket = new Uint8Array([PACKET_HANGUP]);
        this.sigcf.send(undefined, hangupPacket);
        this.log('sent hangup message on page unload');
      } catch (e: any) {
        this.log(`error sending hangup message: ${e?.message || e}`);
      }
    }
  };

  private shouldAcceptState(state: ControllerState): boolean {
    const ts = state.sessionTimestampMs;
    if (!Number.isFinite(ts)) {
      return true;
    }

    if (this.lastSessionTimestampMs === null) {
      this.lastSessionTimestampMs = ts;
      this.lastSessionTimestampReceivedAt = state.receivedAt;
      return true;
    }

    if (ts === this.lastSessionTimestampMs) {
      return false;
    }

    if (ts > this.lastSessionTimestampMs) {
      this.lastSessionTimestampMs = ts;
      this.lastSessionTimestampReceivedAt = state.receivedAt;
      return true;
    }

    const likelySessionReset =
      ts === 0 ||
      (ts < 1000 &&
        this.lastSessionTimestampMs > 5000 &&
        state.receivedAt - this.lastSessionTimestampReceivedAt > 1000);

    if (likelySessionReset) {
      this.lastSessionTimestampMs = ts;
      this.lastSessionTimestampReceivedAt = state.receivedAt;
      return true;
    }

    return false;
  }
}
