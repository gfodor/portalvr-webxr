/**
 * Parses the controller state packet format from BleClient.java (v2 = 61 bytes).
 * Typed and BigInt-free (we read the 64-bit timestamp as two 32-bit words).
 */

export const PACKET_STATE = 0x10;
export const PACKET_ORIENTATION_RESET = 0x7e;
export const PACKET_HANGUP = 0x02;
const PROTO_VERSION = 0x04;
const LEGACY_PROTO_VERSIONS = new Set([0x01, 0x02, 0x03]);
const TRACKING_STATE_MASK = 0x03;
const TRACKING_REASON_MASK = 0x0f;

// Packet sizes (bytes)
const PACKET_STATE_SIZE_V4 = 111; // v4: right body + tracking + interaction + trackpad tail + left-hand tail
const PACKET_STATE_SIZE_V3 = 67; // v3: right body + tracking + interaction + trackpad tail

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

// NEW: Trackpad tail flags + helpers (v3 tail)
const TRACKPAD_FLAG_TOUCH0_DOWN = 1; // bit 0
const U16_MAX_INV = 1 / 65535;

// NEW: Interaction modes
export const INTERACTION_MODE_BASE = 0x0;
export const INTERACTION_MODE_DUAL_AXIS_GAMEPAD = 0x1;
export const INTERACTION_MODE_DUALSHOCK_GAMEPAD = 0x2;
export const INTERACTION_MODE_OPENXR_QUEST = 0x10;

const INTERACTION_MODE_NAMES: Record<number, string> = {
  [INTERACTION_MODE_BASE]: 'Base',
  [INTERACTION_MODE_DUAL_AXIS_GAMEPAD]: 'Dual-Axis Gamepad',
  [INTERACTION_MODE_DUALSHOCK_GAMEPAD]: 'DualShock Gamepad',
  [INTERACTION_MODE_OPENXR_QUEST]: 'OpenXR Quest',
};

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
  dualTrackedRequested: boolean; // NEW: true when v4 dual-tracked packets with left-hand tail are present
  // NEW: interaction mode propagated by BLE v3
  interactionMode: number;
  interactionModeName: string;
  flags: { aim: boolean; stretch: boolean };
  receivedAt: number;
  trackingState: number;
  trackingReason: number;
  // NEW: optional trackpad tail (present on v3 67-byte packets and v4)
  trackpad?: {
    flags: number;
    xU16: number;
    yU16: number;
    xNorm: number; // 0..1
    yNorm: number; // 0..1
    touch0Down: boolean;
  };
  // NEW: optional v4 left-hand tail (dual-tracked mode)
  left?: {
    buttonsMask: number;
    buttons: {
      action1: boolean;
      action2: boolean;
      stick: boolean;
      trigger: boolean;
      squeeze: boolean;
      menu: boolean;
      cameraDrag: boolean;
    };
    joystick: { x: number; y: number };
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
    flags: number;
  };
}

const WAND_MODE_NAMES = [
  'Right Persistent',
  'Left Persistent',
  'Right Ephemeral',
  'Left Ephemeral',
  'Dual Mirrored',
  'Dual Opposed',
  'Dual Tracked',
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

const BLE_WAND_DUAL_TRACKED = 6;

export function parseControllerState(buffer: ArrayBuffer | null | undefined): ControllerState | null {
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    return null;
  }

  if (buffer.byteLength < 59) {
    console.warn(
      `Controller packet length ${buffer.byteLength} is smaller than the minimum supported 59 bytes.`,
    );
    return null;
  }
  // include known packet sizes, including v4 111-byte layout
  if (
    buffer.byteLength !== PACKET_STATE_SIZE_V4 &&
    buffer.byteLength !== PACKET_STATE_SIZE_V3 &&
    buffer.byteLength !== 62 &&
    buffer.byteLength !== 61 &&
    buffer.byteLength !== 59 &&
    buffer.byteLength !== 55
  ) {
    console.warn(
      `Controller packet length ${buffer.byteLength} differs from known versions; parsing known fields only.`,
    );
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
    console.warn(`Expected protocol version ${PROTO_VERSION} or legacy, got ${version}`);
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

  // Next 4 bytes: Flags (int32, little-endian)
  const flagsRaw = view.getInt32(offset, true);
  offset += 4;

  // Session timestamp (uint32, little-endian) — optional on early versions
  let sessionTimestampMs = 0;
  if (buffer.byteLength >= 59 && offset + 4 <= buffer.byteLength) {
    sessionTimestampMs = view.getUint32(offset, true);
    offset += 4;
  }

  // Tracking status (2 bytes) — optional
  let trackingState = 0;
  let trackingReason = 0;
  if (buffer.byteLength >= 61 && offset + 2 <= buffer.byteLength) {
    trackingState = view.getUint8(offset++) & TRACKING_STATE_MASK;
    trackingReason = view.getUint8(offset++) & TRACKING_REASON_MASK;
  }

  let interactionMode = INTERACTION_MODE_BASE;
  if (buffer.byteLength >= 62 && offset < buffer.byteLength) {
    interactionMode = view.getUint8(offset++);
  }

  // Optional trackpad tail [flags][x_u16][y_u16] (v3+)
  let trackpad: ControllerState['trackpad'] | undefined = undefined;
  const trackpadRemain = buffer.byteLength - offset;
  if (trackpadRemain >= 1) {
    const tpFlags = view.getUint8(offset++) & 0xff;
    let xU16 = 0;
    let yU16 = 0;
    if (buffer.byteLength - offset >= 4) {
      xU16 = view.getUint16(offset, true);
      offset += 2;
      yU16 = view.getUint16(offset, true);
      offset += 2;
    }
    const xNorm = xU16 * U16_MAX_INV;
    const yNorm = yU16 * U16_MAX_INV;
    trackpad = {
      flags: tpFlags,
      xU16,
      yU16,
      xNorm,
      yNorm,
      touch0Down: (tpFlags & TRACKPAD_FLAG_TOUCH0_DOWN) !== 0,
    };
  }

  // Optional v4 left-hand tail for dual-tracked mode:
  // [lpx, lpy, lpz] (3 floats)
  // [lqx, lqy, lqz, lqw] (4 floats)
  // leftButtonsMask (int32)
  // leftJoyX, leftJoyY (2 floats)
  // leftFlags (u8), lIsPrimary (u8), reserved[2] (u8,u8)
  let left: ControllerState['left'] | undefined;
  const leftTailBytes = PACKET_STATE_SIZE_V4 - PACKET_STATE_SIZE_V3;
  if (
    version >= 0x04 &&
    buffer.byteLength >= PACKET_STATE_SIZE_V4 &&
    buffer.byteLength - offset >= leftTailBytes
  ) {
    const lpx = view.getFloat32(offset, true);
    offset += 4;
    const lpy = view.getFloat32(offset, true);
    offset += 4;
    const lpz = view.getFloat32(offset, true);
    offset += 4;

    const lqx = view.getFloat32(offset, true);
    offset += 4;
    const lqy = view.getFloat32(offset, true);
    offset += 4;
    const lqz = view.getFloat32(offset, true);
    offset += 4;
    const lqw = view.getFloat32(offset, true);
    offset += 4;

    const leftButtonsMask = view.getInt32(offset, true);
    offset += 4;

    const leftJoyX = view.getFloat32(offset, true);
    offset += 4;
    const leftJoyY = view.getFloat32(offset, true);
    offset += 4;

    const leftFlags = view.getUint8(offset++) & 0xff;

    // lIsPrimary (hand index / primary marker) – currently unused
    if (buffer.byteLength - offset > 0) {
      offset++;
    }
    // Reserved bytes (up to 2)
    const reserved = Math.min(2, buffer.byteLength - offset);
    offset += reserved;

    const leftButtons = {
      action1: !!(leftButtonsMask & BTN_ACTION_1),
      action2: !!(leftButtonsMask & BTN_ACTION_2),
      stick: !!(leftButtonsMask & BTN_STICK),
      trigger: !!(leftButtonsMask & BTN_TRIGGER),
      squeeze: !!(leftButtonsMask & BTN_SQUEEZE),
      menu: !!(leftButtonsMask & BTN_MENU),
      cameraDrag: !!(leftButtonsMask & BTN_CAMERA_DRAG),
    };

    left = {
      buttonsMask: leftButtonsMask,
      buttons: leftButtons,
      joystick: { x: leftJoyX, y: leftJoyY },
      position: { x: lpx, y: lpy, z: lpz },
      quaternion: { x: lqx, y: lqy, z: lqz, w: lqw },
      flags: leftFlags,
    };
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

  const dualTrackedRequested =
    version >= 0x04 && wandMode === BLE_WAND_DUAL_TRACKED && !!left;

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
    dualTrackedRequested,
    interactionMode,
    interactionModeName: INTERACTION_MODE_NAMES[interactionMode] || 'Base',
    flags,
    receivedAt: Date.now(),
    trackingState,
    trackingReason,
    trackpad,
    left,
  };
}
