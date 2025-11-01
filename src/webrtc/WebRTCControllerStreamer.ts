/**
 * WebRTC controller streaming logic used by the emulator runtime.
 * - Copies the signaling + dual-room strategy into TS (see src/webrtc/*).
 * - Auto-connects to room 'test' by default and streams controller pose packets.
 * - Logs controller pose on every XR frame for connectivity verification.
 */

import type { XRFrame } from '../frameloop/XRFrame.js';
import { SIGCF } from './sigcf.js';
import { parseControllerState, type ControllerState } from './controllerParser.js';

export interface WebRTCControllerStreamOptions {
  /** Signaling base URL (no trailing slash). */
  workerUrl?: string;
  /** Room id base; defaults to 'test'. */
  roomId?: string;
  /** Invoked for verbose internal logging. */
  log?: (m: string) => void;
  /** Auto-start the connection as soon as the streamer is created. Default: true. */
  autoStart?: boolean;
}

const DEFAULT_SIGNALING_BASE = 'wss://cloudflare-signalling.portalvr.workers.dev';

export class WebRTCControllerStreamer {
  private readonly workerUrl: string;
  private readonly roomId: string;
  private readonly log: (m: string) => void;
  private readonly autoStart: boolean;

  private sigcf: SIGCF | null = null;
  private lastState: ControllerState | null = null;
  private connected = false;
  private cleanupHandlers: Array<() => void> = [];
  private startPromise: Promise<void> | null = null;

  constructor(options: WebRTCControllerStreamOptions = {}) {
    this.workerUrl = (options.workerUrl || DEFAULT_SIGNALING_BASE).replace(/\/$/, '');
    this.roomId = options.roomId || 'test';
    this.log = typeof options.log === 'function' ? options.log : (m: string) => console.log(`[webrtc] ${m}`);
    this.autoStart = options.autoStart !== false;

    if (this.autoStart) {
      this.ensureStarted();
    }
  }

  /** Process the current XR frame and emit telemetry. */
  update(frame: XRFrame) {
    if (!this.sigcf) {
      this.ensureStarted();
    }

    if (this.lastState) {
      const s = this.lastState;
      // eslint-disable-next-line no-console
      console.log(
        `[WebRTC] frame=${frame.predictedDisplayTime.toFixed(2)}ms ` +
          `connected=${this.connected ? 'yes' : 'no'} ` +
          `pos=(${s.position.x.toFixed(3)}, ${s.position.y.toFixed(3)}, ${s.position.z.toFixed(3)}) ` +
          `quat=(${s.quaternion.x.toFixed(3)}, ${s.quaternion.y.toFixed(3)}, ${s.quaternion.z.toFixed(3)}, ${s.quaternion.w.toFixed(3)}) ` +
          `buttons=${JSON.stringify(s.buttons)} mode=${s.wandModeName}`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[WebRTC] frame=${frame.predictedDisplayTime.toFixed(2)}ms waiting for controller data… connected=${
          this.connected ? 'yes' : 'no'
        }`,
      );
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
    this.lastState = null;
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
      }),
    );
    this.cleanupHandlers.push(
      this.sigcf.on('disconnected', () => {
        this.connected = false;
        this.log('disconnected');
      }),
    );
    this.cleanupHandlers.push(
      this.sigcf.on('msg', (_peer: string, data: any) => {
        if (data instanceof ArrayBuffer) {
          const parsed = parseControllerState(data);
          if (parsed) {
            this.lastState = parsed;
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