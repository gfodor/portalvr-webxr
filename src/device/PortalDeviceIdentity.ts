/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const NAME_PREFIX = 'PORTAL-';
const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const PORTAL_DEVICE_STORAGE_KEY = '___portalvr_device_id';

let cachedSuffix: string | null = null;

interface PortalDeviceIdentity {
  suffix: string;
  fullName: string;
  uiCode: string;
}

export function getPersistentPortalDeviceIdentity(): PortalDeviceIdentity {
  const suffix = ensureSuffix();
  return {
    suffix,
    fullName: `${NAME_PREFIX}${suffix}`,
    uiCode: suffix.substring(0, UI_SUFFIX_LENGTH),
  };
}

function ensureSuffix(): string {
  if (cachedSuffix) {
    return cachedSuffix;
  }
  const storage = getLocalStorage();
  const storedRaw = storage?.getItem(PORTAL_DEVICE_STORAGE_KEY) ?? null;
  const normalized = normalizeSuffix(storedRaw);
  if (normalized) {
    cachedSuffix = normalized;
    persistSuffix(storage, normalized);
    return normalized;
  }
  const generated = generateSuffix();
  cachedSuffix = generated;
  persistSuffix(storage, generated);
  return generated;
}

function normalizeSuffix(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim().toUpperCase();
  if (trimmed.length < UI_SUFFIX_LENGTH) {
    return null;
  }
  for (let i = 0; i < trimmed.length; i++) {
    if (!ALPHANUM.includes(trimmed[i])) {
      return null;
    }
  }
  let result = trimmed;
  if (result.length > SUFFIX_LENGTH) {
    result = result.substring(0, SUFFIX_LENGTH);
  }
  if (result.length < SUFFIX_LENGTH) {
    const needed = SUFFIX_LENGTH - result.length;
    result += generateCharacters(needed);
  }
  return result;
}

function generateSuffix(): string {
  return generateCharacters(SUFFIX_LENGTH);
}

function generateCharacters(count: number): string {
  let output = '';
  for (let i = 0; i < count; i++) {
    output += randomChar();
  }
  return output;
}

function randomChar(): string {
  const alphabetLength = ALPHANUM.length;
  const cryptoObj = getCrypto();
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const maxValid = Math.floor(256 / alphabetLength) * alphabetLength;
    const buffer = new Uint8Array(1);
    while (true) {
      cryptoObj.getRandomValues(buffer);
      const value = buffer[0];
      if (value < maxValid) {
        return ALPHANUM.charAt(value % alphabetLength);
      }
    }
  }
  const fallback = Math.floor(Math.random() * alphabetLength);
  return ALPHANUM.charAt(fallback);
}

function persistSuffix(storage: Storage | null, suffix: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PORTAL_DEVICE_STORAGE_KEY, suffix);
  } catch {
    // Swallow storage exceptions (e.g., quota exceeded, storage disabled).
  }
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Accessing localStorage can throw (e.g., privacy mode).
  }
  return null;
}

function getCrypto(): Crypto | null {
  if (typeof crypto !== 'undefined') {
    return crypto;
  }
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  return null;
}
