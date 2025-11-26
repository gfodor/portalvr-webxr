/**
 * AdbControllerStreamer - Higher-level controller streaming over ADB.
 * Mirrors WebRTCControllerStreamer but backed by AdbControllerTransport.
 *
 * Handles:
 * - Lazy connection via adbFactory
 * - Packet parsing with shared controllerParser
 * - Session timestamp deduplication
 * - Automatic reconnection with exponential backoff
 * - Page unload cleanup
 */

import type { XRFrame } from '../frameloop/XRFrame.js';
import type { Adb } from '@yume-chan/adb';
import {
  parseControllerState,
  isOrientationResetPacket,
  parseOrientationResetWand,
  PACKET_HANGUP,
  type ControllerState,
} from '../webrtc/controllerParser.js';
import { AdbControllerTransport, type AdbTransportStats } from './AdbControllerTransport.js';
import { createStateDeduper } from '../webrtc/controllerStateDeduper.js';

export interface AdbControllerStreamOptions {
  /** Factory to create a fresh Adb instance (called on each reconnect). Either this or `adb` is required. */
  adbFactory?: () => Promise<Adb>;
  /** Existing Adb instance to use. Either this or `adbFactory` is required. */
  adb?: Adb;
  /** Socket name override (default: localabstract:PORTALVR-ADB) */
  socketName?: string;
  /** Verbose logging callback */
  log?: (m: string) => void;
  /** Auto-start the connection. Default: true */
  autoStart?: boolean;
  /** Called whenever a controller packet is decoded */
  onControllerState?: (state: ControllerState) => void;
  /** Called when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  /** Called when an orientation-reset packet is received */
  onOrientationReset?: (calibratingHand: 'left' | 'right') => void;
  /** Called when transport stats update */
  onStats?: (stats: { transport: AdbTransportStats; reconnectAttempt: number; nextBackoffMs: number }) => void;
}

const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;

export class AdbControllerStreamer {
  private readonly adbFactory?: () => Promise<Adb>;
  private readonly initialAdb?: Adb;
  private readonly socketName?: string;
  private readonly log: (m: string) => void;
  private readonly autoStart: boolean;
  private readonly onControllerState?: (state: ControllerState) => void;
  private readonly onConnectionChange?: (connected: boolean) => void;
  private readonly onOrientationReset?: (calibratingHand: 'left' | 'right') => void;
  private readonly onStats?: (stats: { transport: AdbTransportStats; reconnectAttempt: number; nextBackoffMs: number }) => void;

  private adb: Adb | null = null;
  private transport: AdbControllerTransport | null = null;
  private connected = false;
  private stopped = false;
  private startPromise: Promise<void> | null = null;
  private usedInitialAdb = false;

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // State deduplication
  private shouldAcceptState = createStateDeduper();

  constructor(options: AdbControllerStreamOptions) {
    if (!options.adbFactory && !options.adb) {
      throw new Error('AdbControllerStreamer requires either adbFactory or adb');
    }
    this.adbFactory = options.adbFactory;
    this.initialAdb = options.adb;
    this.socketName = options.socketName;
    this.log = typeof options.log === 'function' ? options.log : (m: string) => console.log(`[adb-streamer] ${m}`);
    this.autoStart = options.autoStart !== false;
    this.onControllerState = options.onControllerState;
    this.onConnectionChange = options.onConnectionChange;
    this.onOrientationReset = options.onOrientationReset;
    this.onStats = options.onStats;

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handlePageUnload);
      window.addEventListener('pagehide', this.handlePageUnload);
    }

    if (this.autoStart) {
      this.ensureStarted();
    }
  }

  /** Lazy-start; no-op if already started or in progress. */
  ensureStarted(): void {
    if (this.stopped || this.startPromise || this.transport) {
      return;
    }
    this.startPromise = this.doStart()
      .catch((err) => {
        this.log(`start error: ${err?.message || err}`);
        this.scheduleReconnect();
      })
      .finally(() => {
        this.startPromise = null;
      });
  }

  /** Called each XR frame (kept for symmetry with WebRTCControllerStreamer). */
  update(_frame: XRFrame): void {
    if (!this.transport && !this.startPromise) {
      this.ensureStarted();
    }
  }

  /**
   * Send an arbitrary payload to the controller app.
   * The transport handles length-prefixing.
   */
  async send(payload: ArrayBuffer | Uint8Array): Promise<void> {
    if (!this.transport || !this.connected) {
      throw new Error('Cannot send: not connected');
    }
    await this.transport.send(payload);
  }

  /** Cleanly close socket and adb, stop reconnection. */
  async dispose(): Promise<void> {
    this.stopped = true;
    this.cancelReconnect();

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handlePageUnload);
      window.removeEventListener('pagehide', this.handlePageUnload);
    }

    await this.cleanup();

    if (this.connected) {
      this.connected = false;
      this.onConnectionChange?.(false);
    }
  }

  isConnected(): boolean {
    return this.connected && !this.stopped;
  }

  private async doStart(): Promise<void> {
    if (this.stopped) return;

    // Use initial Adb instance on first start, factory on reconnects
    if (this.initialAdb && !this.usedInitialAdb) {
      this.log('using provided ADB instance');
      this.adb = this.initialAdb;
      this.usedInitialAdb = true;
    } else if (this.adbFactory) {
      this.log('creating ADB instance via factory');
      this.adb = await this.adbFactory();
    } else {
      throw new Error('No ADB instance or factory available for reconnection');
    }

    this.log('creating transport');
    this.transport = new AdbControllerTransport({
      adb: this.adb,
      socketName: this.socketName,
      log: (m) => this.log(`[transport] ${m}`),
      onConnected: () => {
        this.connected = true;
        this.reconnectAttempt = 0; // Reset on successful connect
        this.shouldAcceptState = createStateDeduper(); // Reset deduper
        this.log('connected');
        this.onConnectionChange?.(true);
      },
      onDisconnected: (reason) => {
        this.connected = false;
        this.log(`disconnected: ${reason}`);
        this.onConnectionChange?.(false);
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      },
      onMsg: (payload) => {
        this.handleMessage(payload);
      },
      onStats: (stats) => {
        this.onStats?.({
          transport: stats,
          reconnectAttempt: this.reconnectAttempt,
          nextBackoffMs: this.computeBackoff(),
        });
      },
    });

    await this.transport.start();
  }

  private handleMessage(payload: ArrayBuffer): void {
    // Check for hangup packet
    if (payload.byteLength === 1) {
      const view = new DataView(payload);
      if (view.getUint8(0) === PACKET_HANGUP) {
        this.log('received hangup packet');
        return;
      }
    }

    // Check for orientation reset
    if (isOrientationResetPacket(payload)) {
      const calibratingHand = parseOrientationResetWand(payload);
      this.log(`received orientation reset (hand=${calibratingHand})`);
      this.onOrientationReset?.(calibratingHand);
      return;
    }

    // Parse controller state
    const parsed = parseControllerState(payload);
    if (parsed && this.shouldAcceptState(parsed)) {
      this.onControllerState?.(parsed);
    } else if (parsed) {
      this.log(`dropped duplicate packet ts=${parsed.sessionTimestampMs}`);
    }
  }

  private handlePageUnload = (): void => {
    if (this.transport && this.connected) {
      try {
        const hangupPacket = new Uint8Array([PACKET_HANGUP]);
        // Fire-and-forget send on unload
        void this.transport.send(hangupPacket).catch(() => {});
        this.log('sent hangup message on page unload');
      } catch (e: any) {
        this.log(`error sending hangup message: ${e?.message || e}`);
      }
    }
  };

  private computeBackoff(): number {
    return Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(2, this.reconnectAttempt));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    const backoff = this.computeBackoff();
    this.reconnectAttempt++;
    this.log(`scheduling reconnect in ${backoff}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, backoff);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;

    this.log('attempting reconnect');
    await this.cleanup();
    this.shouldAcceptState = createStateDeduper();

    try {
      await this.doStart();
    } catch (err: any) {
      this.log(`reconnect failed: ${err?.message || err}`);
      this.scheduleReconnect();
    }
  }

  private async cleanup(): Promise<void> {
    const transport = this.transport;
    const adb = this.adb;
    this.transport = null;
    this.adb = null;

    if (transport) {
      try {
        await transport.dispose();
      } catch (err: any) {
        this.log(`error disposing transport: ${err?.message || err}`);
      }
    }

    if (adb) {
      try {
        await adb.close();
      } catch (err: any) {
        this.log(`error closing adb: ${err?.message || err}`);
      }
    }
  }
}
