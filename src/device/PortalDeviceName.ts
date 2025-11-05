/**
 * Helper for generating and persisting a PortalVR BLE device name.
 * Mirrors the native runtime logic by maintaining a stable suffix in localStorage.
 */

const NAME_PREFIX = 'PortalVR-';
const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const STORAGE_KEY_CANDIDATES = [
  'PortalVR.WebXR.DeviceSuffix',
  'portalvr:webxr:deviceSuffix',
  'portalvr-webxr-device-suffix',
] as const;

export const PORTAL_DEVICE_SUFFIX_STORAGE_KEY = STORAGE_KEY_CANDIDATES[0];
export const PORTAL_DEVICE_STORAGE_KEY_CANDIDATES = STORAGE_KEY_CANDIDATES;
export const PORTAL_DEVICE_NAME_PREFIX = NAME_PREFIX;
export const PORTAL_DEVICE_SUFFIX_LENGTH = SUFFIX_LENGTH;
export const PORTAL_DEVICE_UI_SUFFIX_LENGTH = UI_SUFFIX_LENGTH;

const ALPHANUM_SET = new Set(ALPHANUM.split(''));
let cachedSuffix: string | null = null;
let warnedInsecureRng = false;

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') {
      return null;
    }
    const storage = (globalThis as any).localStorage as Storage | undefined;
    if (!storage) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

function persistSuffix(suffix: string, storage: Storage | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PORTAL_DEVICE_SUFFIX_STORAGE_KEY, suffix);
  } catch {
    // Ignore quota/security failures; suffix will remain cached in memory.
  }
}

function randomCharFrom(alphabet: string): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto || (globalThis as any).msCrypto)
      : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const arr = new Uint8Array(1);
    cryptoObj.getRandomValues(arr);
    return alphabet[arr[0] % alphabet.length];
  }
  if (!warnedInsecureRng) {
    warnedInsecureRng = true;
    console.warn('[PortalDeviceName] Falling back to Math.random(); secure RNG unavailable.');
  }
  const idx = Math.floor(Math.random() * alphabet.length);
  return alphabet[idx];
}

function generateSuffix(): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += randomCharFrom(ALPHANUM);
  }
  return suffix;
}

function allCharsAllowed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!ALPHANUM_SET.has(text[i])) {
      return false;
    }
  }
  return true;
}

function normalizeStoredSuffix(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const upper = raw.toUpperCase();
  if (upper.length < UI_SUFFIX_LENGTH) {
    return null;
  }
  if (!allCharsAllowed(upper)) {
    return null;
  }

  let suffix = upper;
  if (suffix.length < SUFFIX_LENGTH) {
    while (suffix.length < SUFFIX_LENGTH) {
      suffix += randomCharFrom(ALPHANUM);
    }
  } else if (suffix.length > SUFFIX_LENGTH) {
    suffix = suffix.substring(0, SUFFIX_LENGTH);
  }
  return suffix;
}

export function ensurePortalDeviceSuffix(): string {
  if (cachedSuffix) {
    return cachedSuffix;
  }

  const storage = getLocalStorage();
  const stored = storage?.getItem(PORTAL_DEVICE_SUFFIX_STORAGE_KEY) ?? null;
  const normalized = normalizeStoredSuffix(stored);
  if (normalized) {
    if (normalized !== stored) {
      persistSuffix(normalized, storage);
    }
    cachedSuffix = normalized;
    return cachedSuffix;
  }

  const generated = generateSuffix();
  persistSuffix(generated, storage);
  cachedSuffix = generated;
  return cachedSuffix;
}

export function getAdvertisedDeviceName(): string {
  return NAME_PREFIX + ensurePortalDeviceSuffix();
}

export function getUiDeviceCode(): string {
  return ensurePortalDeviceSuffix().substring(0, UI_SUFFIX_LENGTH);
}

export function resetPortalDeviceSuffixForTesting(): void {
  const storage = getLocalStorage();
  try {
    storage?.removeItem(PORTAL_DEVICE_SUFFIX_STORAGE_KEY);
  } catch {
    // ignore
  }
  cachedSuffix = null;
}

