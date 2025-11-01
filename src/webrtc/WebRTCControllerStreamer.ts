/**
 * WebRTC controller streaming logic used by the emulator runtime.
 * - Copies the signaling + dual-room strategy into TS (see src/webrtc/*).
 * - Auto-connects to room 'test' by default and streams controller pose packets.
 */

import type { XRFrame } from '../frameloop/XRFrame.js';
import { SIGCF } from './sigcf.js';
import {
  parseControllerState,
  type ControllerState,
  isOrientationResetPacket,
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
  /** Called whenever a controller packet is decoded. */
  onControllerState?: (state: ControllerState) => void;
  /** Called when the data channel connection changes state. */
  onConnectionChange?: (connected: boolean) => void;
  /** Called when an orientation-reset packet is received. */
  onOrientationReset?: () => void;
}

const DEFAULT_SIGNALING_BASE = 'wss://cloudflare-signalling.portalvr.workers.dev';

export class WebRTCControllerStreamer {
  private readonly workerUrl: string;
  private readonly roomId: string;
  private readonly log: (m: string) => void;
  private readonly autoStart: boolean;
  private readonly onControllerState?: (state: ControllerState) => void;
  private readonly onConnectionChange?: (connected: boolean) => void;
  private readonly onOrientationReset?: () => void;

  private sigcf: SIGCF | null = null;
  private connected = false;
  private cleanupHandlers: Array<() => void> = [];
  private startPromise: Promise<void> | null = null;

  constructor(options: WebRTCControllerStreamOptions = {}) {
    this.workerUrl = (options.workerUrl || DEFAULT_SIGNALING_BASE).replace(/\/$/, '');
    this.roomId = options.roomId || 'test';
    this.log = typeof options.log === 'function' ? options.log : (m: string) => console.log(`[webrtc] ${m}`);
    this.autoStart = options.autoStart !== false;
    this.onControllerState = options.onControllerState;
    this.onConnectionChange = options.onConnectionChange;
    this.onOrientationReset = options.onOrientationReset;

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
  }

  private ensureStarted() {
    if (this.sigcf || this.startPromise) {
      return;
    }
    this.sigcf = new SIGCF(this.roomId, {
      workerUrl: this.workerUrl,
      log: (m) => this.log(m),
    });

    this.cleanupHandlers.push(
      this.sigcf.on('connected', () => {
        this.connected = true;
        this.log(`connected to room "${this.roomId}"`);
        this.onConnectionChange?.(true);
      }),
    );
    this.cleanupHandlers.push(
      this.sigcf.on('disconnected', () => {
        this.connected = false;
        this.log('disconnected');
        this.onConnectionChange?.(false);
      }),
    );
    this.cleanupHandlers.push(
      this.sigcf.on('msg', (_peer: string, data: any) => {
        if (data instanceof ArrayBuffer) {
          if (isOrientationResetPacket(data)) {
            this.log('received orientation reset packet');
            this.onOrientationReset?.();
            return;
          }
          const parsed = parseControllerState(data);
          if (parsed) {
            this.onControllerState?.(parsed);
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
}
