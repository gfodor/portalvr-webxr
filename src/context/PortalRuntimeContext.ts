import type { PortalEmulatorConfig } from '../device/PortalEmulatorConfig.js';

const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const DEFAULT_CONFIG: PortalEmulatorConfig = {
  device: { suffix: '' },
  settings: {
    faceTrackingEnabled: true,
    stereoRenderingEnabled: false,
    immersiveFullscreenEnabled: true,
    connectToControllerViaLan: true,
  },
  version: 1,
};

export interface RuntimeConfigStore {
  read(): Promise<PortalEmulatorConfig | null | undefined>;
  write(config: PortalEmulatorConfig): Promise<void>;
}

export interface PortalRuntimeContextController {
  getOrCreateRuntimeConfig(): Promise<PortalEmulatorConfig>;
  setRuntimeConfig(candidate: unknown): Promise<PortalEmulatorConfig>;
}

export function createPortalRuntimeContext(
  store: RuntimeConfigStore,
): PortalRuntimeContextController {
  async function readStoredConfig(): Promise<PortalEmulatorConfig | null> {
    const stored = await store.read();
    if (!stored) {
      return null;
    }
    return ensureConfigSuffix(
      ensureConfigDefaults(normalizeConfig(stored, null)),
    );
  }

  async function persistConfig(config: PortalEmulatorConfig): Promise<void> {
    await store.write(config);
  }

  async function getOrCreateRuntimeConfig(): Promise<PortalEmulatorConfig> {
    const existing = await readStoredConfig();
    if (existing) {
      return existing;
    }
    const base = ensureConfigDefaults(
      normalizeConfig(
        {
          device: { suffix: '' },
          settings: DEFAULT_CONFIG.settings,
          version: DEFAULT_CONFIG.version,
        },
        null,
      ),
    );
    const configWithSuffix = ensureConfigSuffix(base);
    await persistConfig(configWithSuffix);
    return configWithSuffix;
  }

  async function setRuntimeConfig(
    candidate: unknown,
  ): Promise<PortalEmulatorConfig> {
    const current = await getOrCreateRuntimeConfig();
    const normalized = ensureConfigSuffix(
      ensureConfigDefaults(normalizeConfig(candidate, current)),
    );
    await persistConfig(normalized);
    return normalized;
  }

  return {
    getOrCreateRuntimeConfig,
    setRuntimeConfig,
  };
}

export function ensureConfigDefaults(
  config: PortalEmulatorConfig,
): PortalEmulatorConfig {
  const normalizedSuffix = normalizeSuffix(config.device.suffix) ?? '';
  return {
    device: { suffix: normalizedSuffix },
    settings: {
      faceTrackingEnabled: config.settings.faceTrackingEnabled,
      stereoRenderingEnabled: config.settings.stereoRenderingEnabled,
      immersiveFullscreenEnabled: config.settings.immersiveFullscreenEnabled,
      connectToControllerViaLan: config.settings.connectToControllerViaLan,
    },
    version:
      typeof config.version === 'number' ? config.version : DEFAULT_CONFIG.version,
  };
}

export function ensureConfigSuffix(
  config: PortalEmulatorConfig,
): PortalEmulatorConfig {
  const normalizedSuffix =
    normalizeSuffix(config.device.suffix) ?? generateSuffix();
  return {
    ...config,
    device: { ...config.device, suffix: normalizedSuffix },
  };
}

export function normalizeConfig(
  candidate: unknown,
  fallback: PortalEmulatorConfig | null,
): PortalEmulatorConfig {
  const base = fallback ?? DEFAULT_CONFIG;
  const result: PortalEmulatorConfig = {
    device: { suffix: normalizeSuffix(base.device.suffix) ?? '' },
    settings: {
      faceTrackingEnabled: base.settings.faceTrackingEnabled,
      stereoRenderingEnabled: base.settings.stereoRenderingEnabled,
      immersiveFullscreenEnabled: base.settings.immersiveFullscreenEnabled,
      connectToControllerViaLan: base.settings.connectToControllerViaLan,
    },
    version:
      typeof base.version === 'number' ? base.version : DEFAULT_CONFIG.version,
  };

  if (!candidate || typeof candidate !== 'object') {
    return result;
  }

  const deviceCandidate = (candidate as { device?: unknown }).device;
  if (deviceCandidate && typeof deviceCandidate === 'object') {
    const suffixCandidate = normalizeSuffix(
      typeof (deviceCandidate as { suffix?: unknown }).suffix === 'string'
        ? (deviceCandidate as { suffix: string }).suffix
        : null,
    );
    if (suffixCandidate) {
      result.device.suffix = suffixCandidate;
    }
  }

  const settingsCandidate = (candidate as { settings?: unknown }).settings;
  if (settingsCandidate && typeof settingsCandidate === 'object') {
    const faceCandidate = (settingsCandidate as {
      faceTrackingEnabled?: unknown;
    }).faceTrackingEnabled;
    if (typeof faceCandidate === 'boolean') {
      result.settings.faceTrackingEnabled = faceCandidate;
    }
    const stereoCandidate = (settingsCandidate as {
      stereoRenderingEnabled?: unknown;
    }).stereoRenderingEnabled;
    if (typeof stereoCandidate === 'boolean') {
      result.settings.stereoRenderingEnabled = stereoCandidate;
    }
    const fullscreenCandidate = (settingsCandidate as {
      immersiveFullscreenEnabled?: unknown;
    }).immersiveFullscreenEnabled;
    if (typeof fullscreenCandidate === 'boolean') {
      result.settings.immersiveFullscreenEnabled = fullscreenCandidate;
    }
    const lanCandidate = (settingsCandidate as {
      connectToControllerViaLan?: unknown;
    }).connectToControllerViaLan;
    if (typeof lanCandidate === 'boolean') {
      result.settings.connectToControllerViaLan = lanCandidate;
    }
  }

  const versionCandidate = (candidate as { version?: unknown }).version;
  if (typeof versionCandidate === 'number') {
    result.version = versionCandidate;
  }

  return result;
}

export function normalizeSuffix(candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim().toUpperCase();
  if (trimmed.length < UI_SUFFIX_LENGTH) {
    return null;
  }
  for (let index = 0; index < trimmed.length; index += 1) {
    if (!ALPHANUM.includes(trimmed[index])) {
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

export function generateSuffix(): string {
  return generateCharacters(SUFFIX_LENGTH);
}

function generateCharacters(count: number): string {
  let output = '';
  for (let index = 0; index < count; index += 1) {
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

function getCrypto(): Crypto | null {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  return null;
}
