/**
 * Shared controller state deduplication logic.
 * Used by both WebRTCControllerStreamer and AdbControllerStreamer.
 */

import type { ControllerState } from './controllerParser.js';

/**
 * Creates a state deduper function that filters out duplicate or out-of-order packets
 * based on session timestamps. Handles session resets gracefully.
 *
 * @returns A function that returns true if the state should be accepted
 */
export function createStateDeduper(): (state: ControllerState) => boolean {
  let lastSessionTimestampMs: number | null = null;
  let lastSessionTimestampReceivedAt = 0;

  return function shouldAcceptState(state: ControllerState): boolean {
    const ts = state.sessionTimestampMs;

    // Accept packets without a valid timestamp
    if (!Number.isFinite(ts)) {
      return true;
    }

    // First packet - always accept
    if (lastSessionTimestampMs === null) {
      lastSessionTimestampMs = ts;
      lastSessionTimestampReceivedAt = state.receivedAt;
      return true;
    }

    // Exact duplicate - reject
    if (ts === lastSessionTimestampMs) {
      return false;
    }

    // Newer packet - accept
    if (ts > lastSessionTimestampMs) {
      lastSessionTimestampMs = ts;
      lastSessionTimestampReceivedAt = state.receivedAt;
      return true;
    }

    // Older packet - check if it's likely a session reset
    // (new session starts at 0 or low timestamp after a gap)
    const likelySessionReset =
      ts === 0 ||
      (ts < 1000 &&
        lastSessionTimestampMs > 5000 &&
        state.receivedAt - lastSessionTimestampReceivedAt > 1000);

    if (likelySessionReset) {
      lastSessionTimestampMs = ts;
      lastSessionTimestampReceivedAt = state.receivedAt;
      return true;
    }

    // Out-of-order packet - reject
    return false;
  };
}
