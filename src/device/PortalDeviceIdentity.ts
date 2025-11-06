import { getPortalEmulatorConfig, updatePortalEmulatorConfig } from './PortalEmulatorConfig.js';
const NAME_PREFIX = 'PORTAL-';
const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const PORTAL_DEVICE_IDENTITY_OVERRIDE_GLOBAL = '__PORTALVR_DEVICE_IDENTITY_OVERRIDE__';

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

  const injected = getInjectedSuffix();
  if (injected) {
    cachedSuffix = injected;
    persistSuffixToConfig(injected);
    return injected;
  }

  // Read from new config blob
  const configSuffix = normalizeSuffix(getPortalEmulatorConfig().device?.suffix ?? null);
  if (configSuffix) {
    cachedSuffix = configSuffix;
    // Ensure normalized value is persisted if different
    persistSuffixToConfig(configSuffix);
    return configSuffix;
  }

  // Generate and persist
  const generated = generateSuffix();
  cachedSuffix = generated;
  persistSuffixToConfig(generated);
  return generated;
}

function getInjectedSuffix(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const globalWithOverride = window as typeof window & Record<string, unknown>;
  const overrideCandidate = globalWithOverride[PORTAL_DEVICE_IDENTITY_OVERRIDE_GLOBAL];
  if (!overrideCandidate) {
    return null;
  }
  if (typeof overrideCandidate === 'string') {
    return normalizeSuffix(overrideCandidate);
  }
  if (typeof overrideCandidate === 'function') {
    try {
      const result = overrideCandidate();
      if (typeof result === 'string') {
        return normalizeSuffix(result);
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof overrideCandidate === 'object' && overrideCandidate !== null) {
    const possibleSuffix = (overrideCandidate as { suffix?: unknown }).suffix;
    if (typeof possibleSuffix === 'string') {
      return normalizeSuffix(possibleSuffix);
    }
  }
  return null;
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

function persistSuffixToConfig(suffix: string): void {
  try {
    updatePortalEmulatorConfig({ device: { suffix } });
  } catch {
    // ignore persistence failures
  }
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
