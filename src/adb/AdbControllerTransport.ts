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

// Buffer management constants to reduce GC pressure
const INITIAL_BUFFER_SIZE = 4096; // 4KB initial size
const MAX_BUFFER_SIZE = 65536; // 64KB max before forcing compaction
const GROWTH_FACTOR = 2;

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

    // Pre-allocated buffer to reduce GC pressure
    let buffer = new Uint8Array(INITIAL_BUFFER_SIZE);
    let writePos = 0; // Where to write incoming data
    let readPos = 0;  // Where to read frames from

    // Helper to get available data length
    const availableData = () => writePos - readPos;

    // Helper to ensure capacity for incoming data
    const ensureCapacity = (needed: number) => {
      const available = buffer.length - writePos;
      if (available >= needed) return;

      // First try compacting: move unread data to start of buffer
      if (readPos > 0) {
        const dataLen = availableData();
        if (dataLen > 0) {
          buffer.copyWithin(0, readPos, writePos);
        }
        writePos = dataLen;
        readPos = 0;

        // Check if compaction freed enough space
        if (buffer.length - writePos >= needed) return;
      }

      // Need to grow the buffer
      const requiredSize = writePos + needed;
      let newSize = buffer.length;
      while (newSize < requiredSize) {
        newSize = Math.min(newSize * GROWTH_FACTOR, Math.max(requiredSize, MAX_BUFFER_SIZE));
        if (newSize >= requiredSize) break;
        newSize = requiredSize; // Ensure we have enough
      }

      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(buffer.subarray(0, writePos));
      buffer = newBuffer;
    };

    try {
      const reader = socket.readable.getReader();

      while (!this.disposed && this.connected) {
        const { done, value } = await reader.read();

        if (done) {
          this.log('read stream ended');
          break;
        }

        if (!value || value.length === 0) continue;

        // Ensure we have space for incoming data
        ensureCapacity(value.length);

        // Copy incoming data to buffer
        buffer.set(value, writePos);
        writePos += value.length;
        this.stats.bytesReceived += value.length;

        // Parse frames: [u16 LE length][payload]
        while (availableData() >= 2) {
          const view = new DataView(buffer.buffer, readPos, availableData());
          const frameLen = view.getUint16(0, true);

          if (availableData() < 2 + frameLen) {
            // Incomplete frame, wait for more data
            break;
          }

          // Extract payload - create a copy for the callback since buffer may be reused
          const payloadStart = readPos + 2;
          const payloadEnd = payloadStart + frameLen;
          const payload = buffer.slice(payloadStart, payloadEnd);
          readPos = payloadEnd;

          // Deliver to callback
          try {
            this.onMsg?.(payload.buffer);
          } catch (err: any) {
            this.log(`onMsg callback error: ${err?.message || err}`);
          }
        }

        // Compact buffer if we've consumed a lot of data and have leftover
        // This prevents the buffer from growing indefinitely
        if (readPos > INITIAL_BUFFER_SIZE && availableData() < INITIAL_BUFFER_SIZE) {
          const dataLen = availableData();
          if (dataLen > 0) {
            buffer.copyWithin(0, readPos, writePos);
          }
          writePos = dataLen;
          readPos = 0;
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
