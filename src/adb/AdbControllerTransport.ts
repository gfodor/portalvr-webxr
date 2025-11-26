/**
 * AdbControllerTransport - Low-level wrapper around a WebADB local socket
 * for communicating with the PortalVR controller app over USB.
 *
 * Implements the same event model as SIGCF (connected/disconnected/msg)
 * but over ADB localabstract sockets instead of WebRTC.
 */

import type { Adb, AdbSocket } from '@yume-chan/adb';

export interface AdbTransportOptions {
  adb: Adb;
  socketName?: string; // default 'localabstract:PORTALVR-ADB'
  log?: (m: string) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onMsg?: (payload: ArrayBuffer) => void;
  onStats?: (stats: AdbTransportStats) => void;
}

export interface AdbTransportStats {
  bytesSent: number;
  bytesReceived: number;
  reconnects: number;
  lastError?: string;
}

const DEFAULT_SOCKET_NAME = 'localabstract:PORTALVR-ADB';

export class AdbControllerTransport {
  private readonly adb: Adb;
  private readonly socketName: string;
  private readonly log: (m: string) => void;
  private readonly onConnected?: () => void;
  private readonly onDisconnected?: (reason: string) => void;
  private readonly onMsg?: (payload: ArrayBuffer) => void;
  private readonly onStats?: (stats: AdbTransportStats) => void;

  private socket: AdbSocket | null = null;
  private connected = false;
  private disposed = false;
  private readLoopRunning = false;

  private stats: AdbTransportStats = {
    bytesSent: 0,
    bytesReceived: 0,
    reconnects: 0,
  };

  constructor(opts: AdbTransportOptions) {
    this.adb = opts.adb;
    this.socketName = opts.socketName ?? DEFAULT_SOCKET_NAME;
    this.log = typeof opts.log === 'function' ? opts.log : (m: string) => console.log(`[adb-transport] ${m}`);
    this.onConnected = opts.onConnected;
    this.onDisconnected = opts.onDisconnected;
    this.onMsg = opts.onMsg;
    this.onStats = opts.onStats;
  }

  /** Open the localabstract socket and start the read loop. Idempotent. */
  async start(): Promise<void> {
    if (this.disposed) {
      throw new Error('AdbControllerTransport has been disposed');
    }
    if (this.socket || this.connected) {
      this.log('start() called but already connected');
      return;
    }

    this.log(`connecting to ${this.socketName}`);
    try {
      // Open local socket to the controller app
      this.socket = await this.adb.createSocket(this.socketName);
      this.connected = true;
      this.log('socket connected');
      this.onConnected?.();
      this.emitStats();

      // Start the read loop
      void this.runReadLoop();
    } catch (err: any) {
      const reason = err?.message || String(err);
      this.log(`failed to connect: ${reason}`);
      this.stats.lastError = reason;
      this.emitStats();
      throw err;
    }
  }

  /**
   * Send a length-prefixed payload: [u16_le length][payload].
   */
  async send(payload: ArrayBuffer | ArrayBufferView | Uint8Array): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error('Cannot send: socket not connected');
    }

    const data = payload instanceof ArrayBuffer
      ? new Uint8Array(payload)
      : payload instanceof Uint8Array
        ? payload
        : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);

    // Build length-prefixed frame: [u16 LE length][payload]
    const frame = new Uint8Array(2 + data.length);
    const view = new DataView(frame.buffer);
    view.setUint16(0, data.length, true); // little-endian
    frame.set(data, 2);

    try {
      const writer = this.socket.writable.getWriter();
      try {
        await writer.write(frame);
        this.stats.bytesSent += frame.length;
        this.emitStats();
      } finally {
        writer.releaseLock();
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`write error: ${errMsg}`);
      this.stats.lastError = errMsg;
      this.emitStats();
      void this.handleDisconnect(errMsg);
      throw err;
    }
  }

  /** Close the socket. Does not close the underlying Adb instance. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.log('disposing transport');
    await this.closeSocket('disposed');
  }

  isConnected(): boolean {
    return this.connected && !this.disposed;
  }

  private async runReadLoop(): Promise<void> {
    if (this.readLoopRunning || !this.socket) return;
    this.readLoopRunning = true;

    const socket = this.socket;
    let buffer = new Uint8Array(0);

    try {
      const reader = socket.readable.getReader();

      while (!this.disposed && this.connected) {
        const { done, value } = await reader.read();

        if (done) {
          this.log('read stream ended');
          break;
        }

        if (!value || value.length === 0) continue;

        // Accumulate bytes
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer, 0);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
        this.stats.bytesReceived += value.length;

        // Parse frames: [u16 LE length][payload]
        while (buffer.length >= 2) {
          const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          const frameLen = view.getUint16(0, true);

          if (buffer.length < 2 + frameLen) {
            // Incomplete frame, wait for more data
            break;
          }

          // Extract the payload
          const payload = buffer.slice(2, 2 + frameLen);
          buffer = buffer.slice(2 + frameLen);

          // Deliver to callback
          try {
            this.onMsg?.(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
          } catch (err: any) {
            this.log(`onMsg callback error: ${err?.message || err}`);
          }
        }

        this.emitStats();
      }

      reader.releaseLock();
    } catch (err: any) {
      const reason = err?.message || String(err);
      this.log(`read loop error: ${reason}`);
      this.stats.lastError = reason;
      this.emitStats();
    } finally {
      this.readLoopRunning = false;
      if (!this.disposed) {
        void this.handleDisconnect('read loop ended');
      }
    }
  }

  private async handleDisconnect(reason: string): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.log(`disconnected: ${reason}`);
    await this.closeSocket(reason);
    this.onDisconnected?.(reason);
  }

  private async closeSocket(_reason: string): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;

    if (socket) {
      try {
        await socket.close();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(`error closing socket: ${errMsg}`);
      }
    }
  }

  private emitStats(): void {
    this.onStats?.({ ...this.stats });
  }
}
