/**
 * Parses the controller state packet format from BleClient.java (v2 = 61 bytes).
 * Typed and BigInt-free (we read the 64-bit timestamp as two 32-bit words).
 */

export const PACKET_STATE = 0x10;
export const PACKET_ORIENTATION_RESET = 0x7e;
const PROTO_VERSION = 0x02;
const LEGACY_PROTO_VERSIONS = new Set([0x01]);
const TRACKING_STATE_MASK = 0x03;
const TRACKING_REASON_MASK = 0x0f;

// Button bit masks
const BTN_ACTION_1 = 1; // bit 0
const BTN_ACTION_2 = 1 << 1; // bit 1
const BTN_STICK = 1 << 2; // bit 2
const BTN_TRIGGER = 1 << 3; // bit 3
const BTN_SQUEEZE = 1 << 4; // bit 4
const BTN_MENU = 1 << 5; // bit 5
const BTN_CAMERA_DRAG = 1 << 6; // bit 6 (virtual camera-drag button)

// Flag bit masks
const FLAG_AIM = 1; // bit 0
const FLAG_STRETCH = 1 << 1; // bit 1

export interface ControllerState {
  version: number;
  sessionTimestampMs: number;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  buttons: {
    action1: boolean;
    action2: boolean;
    stick: boolean;
    trigger: boolean;
    squeeze: boolean;
    menu: boolean;
    cameraDrag: boolean; // NEW: virtual button to engage camera drag
  };
  joystick: { x: number; y: number };
  timestampNs: number;
  wandMode: number;
  wandModeName: string;
  flags: { aim: boolean; stretch: boolean };
  receivedAt: number;
  trackingState: number;
  trackingReason: number;
}

const WAND_MODE_NAMES = [
  'Right Persistent',
  'Left Persistent',
  'Right Ephemeral',
  'Left Ephemeral',
  'Dual Mirrored',
  'Dual Opposed',
];

export function isOrientationResetPacket(buffer: ArrayBuffer | null | undefined): boolean {
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    return false;
  }
  if (buffer.byteLength < 1) {
    return false;
  }
  const view = new DataView(buffer);
  const packetType = view.getUint8(0);
  return packetType === PACKET_ORIENTATION_RESET;
}

export function parseControllerState(buffer: ArrayBuffer | null | undefined): ControllerState | null {
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    return null;
  }

  if (buffer.byteLength !== 61 && buffer.byteLength !== 59) {
    console.warn(`Expected 61 or 59 bytes, got ${buffer.byteLength}`);
    return null;
  }

  const view = new DataView(buffer);
  let offset = 0;

  // Byte 0: Packet type
  const packetType = view.getUint8(offset++);
  if (packetType !== PACKET_STATE) {
    console.warn(`Expected packet type ${PACKET_STATE}, got ${packetType}`);
    return null;
  }

  // Byte 1: Protocol version
  const version = view.getUint8(offset++);
  if (version !== PROTO_VERSION && !LEGACY_PROTO_VERSIONS.has(version)) {
    console.warn(`Expected protocol version ${PROTO_VERSION}, got ${version}`);
  }

  // Bytes 2-13: Position (3 floats, little-endian)
  const posX = view.getFloat32(offset, true);
  offset += 4;
  const posY = view.getFloat32(offset, true);
  offset += 4;
  const posZ = view.getFloat32(offset, true);
  offset += 4;

  // Bytes 14-29: Quaternion (4 floats, little-endian)
  const quatX = view.getFloat32(offset, true);
  offset += 4;
  const quatY = view.getFloat32(offset, true);
  offset += 4;
  const quatZ = view.getFloat32(offset, true);
  offset += 4;
  const quatW = view.getFloat32(offset, true);
  offset += 4;

  // Bytes 30-33: Button mask (int32, little-endian)
  const buttonsMask = view.getInt32(offset, true);
  offset += 4;

  // Bytes 34-37: Joystick X (float, little-endian)
  const joyX = view.getFloat32(offset, true);
  offset += 4;

  // Bytes 38-41: Joystick Y (float, little-endian)
  const joyY = view.getFloat32(offset, true);
  offset += 4;

  // Bytes 42-49: Timestamp (int64, little-endian) — read as two 32-bit words to avoid BigInt types
  const low = view.getUint32(offset, true);
  offset += 4;
  const high = view.getUint32(offset, true);
  offset += 4;
  const timestampNs = high * 2 ** 32 + low;

  // Byte 50: Wand mode
  const wandMode = view.getUint8(offset++);
  // Bytes 51-54: Flags (int32, little-endian)
  const flagsRaw = view.getInt32(offset, true);
  offset += 4;

  // Bytes 55-58: Session timestamp (uint32, little-endian)
  const sessionTimestampMs = view.getUint32(offset, true);
  offset += 4;

  let trackingState = 0;
  let trackingReason = 0;
  if (buffer.byteLength >= 61 && offset + 2 <= buffer.byteLength) {
    trackingState = view.getUint8(offset++) & TRACKING_STATE_MASK;
    trackingReason = view.getUint8(offset++) & TRACKING_REASON_MASK;
  }

  const buttons = {
    action1: !!(buttonsMask & BTN_ACTION_1),
    action2: !!(buttonsMask & BTN_ACTION_2),
    stick: !!(buttonsMask & BTN_STICK),
    trigger: !!(buttonsMask & BTN_TRIGGER),
    squeeze: !!(buttonsMask & BTN_SQUEEZE),
    menu: !!(buttonsMask & BTN_MENU),
    cameraDrag: !!(buttonsMask & BTN_CAMERA_DRAG),
  };

  const flags = {
    aim: !!(flagsRaw & FLAG_AIM),
    stretch: !!(flagsRaw & FLAG_STRETCH),
  };

  return {
    version,
    sessionTimestampMs,
    position: { x: posX, y: posY, z: posZ },
    quaternion: { x: quatX, y: quatY, z: quatZ, w: quatW },
    buttons,
    joystick: { x: joyX, y: joyY },
    timestampNs,
    wandMode,
    wandModeName: WAND_MODE_NAMES[wandMode] || 'Unknown',
    flags,
    receivedAt: Date.now(),
    trackingState,
    trackingReason,
  };
}
