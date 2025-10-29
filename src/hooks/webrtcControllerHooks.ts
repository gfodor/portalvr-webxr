/**
 * WebRTC controller streaming hooks for the emulator.
 * - Copies the signaling + dual-room strategy into TS (see src/webrtc/*).
 * - Auto-connects to room 'test' by default and streams controller pose packets.
 * - Logs controller pose on every XR frame for connectivity verification.
 *
 * NOTE: This hook does not yet drive the emulator's XRTrackedInput transforms.
 */

import type { XRDeviceHooks } from '../device/XRDevice.js';
import { SIGCF } from '../webrtc/sigcf.js';
import { parseControllerState, type ControllerState } from '../webrtc/controllerParser.js';

export interface WebRTCControllerHookOptions {
  /** Signaling base URL (no trailing slash). */
  workerUrl?: string;
  /** Room id base; defaults to 'test'. */
  roomId?: string;
  /** Invoked for verbose internal logging. */
  log?: (m: string) => void;
  /** Auto-start the connection as soon as the hook is created. Default: true. */
  autoStart?: boolean;
}

const DEFAULT_SIGNALING_BASE = 'wss://cloudflare-signalling.portalvr.workers.dev';

/**
 * Create XRDevice hooks that stream controller pose updates via WebRTC.
 * The connection starts immediately (activation) unless autoStart is false.
 */
export function createWebRTCControllerHooks(opts: WebRTCControllerHookOptions = {}): XRDeviceHooks {
  const workerUrl = (opts.workerUrl || DEFAULT_SIGNALING_BASE).replace(/\/$/, '');
  const roomId = opts.roomId || 'test';
  const log = typeof opts.log === 'function' ? opts.log : (m: string) => console.log(`[webrtc-hooks] ${m}`);
  const autoStart = opts.autoStart !== false;

  let sigcf: SIGCF | null = null;
  let lastState: ControllerState | null = null;
  let connected = false;

  const start = () => {
    if (sigcf) return;
    sigcf = new SIGCF(roomId, {
      workerUrl,
      log: (m) => log(m),
    });
    sigcf.on('connected', () => {
      connected = true;
      log(`connected to room "${roomId}"`);
    });
    sigcf.on('disconnected', () => {
      connected = false;
      log('disconnected');
    });
    sigcf.on('msg', (_peer: string, data: any) => {
      if (data instanceof ArrayBuffer) {
        const parsed = parseControllerState(data);
        if (parsed) {
          lastState = parsed;
        }
      }
    });
    // Fire and forget — coordinator handles reconnection internally
    sigcf.start().catch((e: any) => log(`start error: ${e?.message || e}`));
  };

  if (autoStart) start();

  const hooks: XRDeviceHooks = {
    onControllerPose(_input, frame) {
      // Lazy activation if autoStart was disabled and a frame arrives
      if (!sigcf) start();

      if (lastState) {
        const s = lastState;
        console.log(
          `[WebRTC] frame=${frame.predictedDisplayTime.toFixed(2)}ms ` +
            `connected=${connected ? 'yes' : 'no'} ` +
            `pos=(${s.position.x.toFixed(3)}, ${s.position.y.toFixed(3)}, ${s.position.z.toFixed(3)}) ` +
            `quat=(${s.quaternion.x.toFixed(3)}, ${s.quaternion.y.toFixed(3)}, ${s.quaternion.z.toFixed(
              3,
            )}, ${s.quaternion.w.toFixed(3)}) ` +
            `buttons=${JSON.stringify(s.buttons)} mode=${s.wandModeName}`,
        );
      } else {
        console.log(
          `[WebRTC] frame=${frame.predictedDisplayTime.toFixed(2)}ms waiting for controller data… connected=${
            connected ? 'yes' : 'no'
          }`,
        );
      }
    },
  };

  return hooks;
}