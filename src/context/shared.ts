/**
 * Shared helpers for PortalVR context bridge (standalone + iframe).
 * Pure browser utilities (no chrome.* / extension APIs).
 */

export const MESSAGE_TYPE_SET_CONFIG = 'portalvr:set-config';
export const MESSAGE_TYPE_GET_CONFIG = 'portalvr:get-config';
export const MESSAGE_TYPE_CONFIG = 'portalvr:config';
export const MESSAGE_TYPE_HELLO = 'portalvr:hello';
export const MESSAGE_TYPE_READY = 'portalvr:context-ready';

export const MESSAGE_TYPE_WS_OPEN  = 'portalvr:ws-open';
export const MESSAGE_TYPE_WS_SEND  = 'portalvr:ws-send';
export const MESSAGE_TYPE_WS_CLOSE = 'portalvr:ws-close';
export const MESSAGE_TYPE_WS_EVENT = 'portalvr:ws-event';

export const CONTEXT_SCOPE = 'portalvr';
export const CONFIG_STORAGE_KEY = 'portalvrConfig';

export interface AdbUsbConfig {
  adbPrivateKeyPkcs8: string | null;
}

export interface PortalEmulatorConfig {
  device: { suffix: string };
  settings: {
    faceTrackingEnabled: boolean;
    stereoRenderingEnabled: boolean;
    immersiveFullscreenEnabled: boolean;
    connectToControllerViaLan: boolean;
  };
  adbUsb: AdbUsbConfig;
  version?: number;
}

const DEFAULT_ADB_USB: AdbUsbConfig = {
  adbPrivateKeyPkcs8: null,
};

const DEFAULT_CONFIG: PortalEmulatorConfig = {
  device: { suffix: '' },
  settings: {
    faceTrackingEnabled: true,
    stereoRenderingEnabled: false,
    immersiveFullscreenEnabled: true,
    connectToControllerViaLan: true,
  },
  adbUsb: { ...DEFAULT_ADB_USB },
  version: 1,
};

const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function normalizeSuffix(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim().toUpperCase();
  if (trimmed.length < UI_SUFFIX_LENGTH) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (!ALPHANUM.includes(trimmed[i])) return null;
  }
  let result = trimmed;
  if (result.length > SUFFIX_LENGTH) {
    result = result.substring(0, SUFFIX_LENGTH);
  }
  if (result.length < SUFFIX_LENGTH) {
    result = result + generateCharacters(SUFFIX_LENGTH - result.length);
  }
  return result;
}

export function generateSuffix(): string {
  return generateCharacters(SUFFIX_LENGTH);
}

function generateCharacters(count: number): string {
  let output = '';
  for (let i = 0; i < count; i += 1) {
    output += ALPHANUM.charAt(Math.floor(Math.random() * ALPHANUM.length));
  }
  return output;
}

export function ensureConfigDefaults(config: PortalEmulatorConfig): PortalEmulatorConfig {
  const normalizedSuffix = normalizeSuffix(config.device.suffix) ?? '';
  return {
    device: { suffix: normalizedSuffix },
    settings: {
      faceTrackingEnabled: config.settings.faceTrackingEnabled,
      stereoRenderingEnabled: config.settings.stereoRenderingEnabled,
      immersiveFullscreenEnabled: config.settings.immersiveFullscreenEnabled,
      connectToControllerViaLan: config.settings.connectToControllerViaLan,
    },
    adbUsb: normalizeAdbUsb(config.adbUsb, DEFAULT_ADB_USB),
    version: typeof config.version === 'number' ? config.version : DEFAULT_CONFIG.version,
  };
}

export function ensureConfigSuffix(config: PortalEmulatorConfig): PortalEmulatorConfig {
  const normalizedSuffix = normalizeSuffix(config.device.suffix) ?? generateSuffix();
  return { ...config, device: { ...config.device, suffix: normalizedSuffix } };
}

export function normalizeConfig(candidate: unknown, fallback: PortalEmulatorConfig | null): PortalEmulatorConfig {
  const base = fallback ?? DEFAULT_CONFIG;
  const result: PortalEmulatorConfig = {
    device: { suffix: normalizeSuffix(base.device.suffix) ?? '' },
    settings: {
      faceTrackingEnabled: base.settings.faceTrackingEnabled,
      stereoRenderingEnabled: base.settings.stereoRenderingEnabled,
      immersiveFullscreenEnabled: base.settings.immersiveFullscreenEnabled,
      connectToControllerViaLan: base.settings.connectToControllerViaLan,
    },
    adbUsb: normalizeAdbUsb(base.adbUsb, DEFAULT_ADB_USB),
    version: typeof base.version === 'number' ? base.version : DEFAULT_CONFIG.version,
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
    const faceCandidate = (settingsCandidate as { faceTrackingEnabled?: unknown }).faceTrackingEnabled;
    if (typeof faceCandidate === 'boolean') result.settings.faceTrackingEnabled = faceCandidate;

    const stereoCandidate = (settingsCandidate as { stereoRenderingEnabled?: unknown }).stereoRenderingEnabled;
    if (typeof stereoCandidate === 'boolean') result.settings.stereoRenderingEnabled = stereoCandidate;

    const fullscreenCandidate = (settingsCandidate as { immersiveFullscreenEnabled?: unknown }).immersiveFullscreenEnabled;
    if (typeof fullscreenCandidate === 'boolean') result.settings.immersiveFullscreenEnabled = fullscreenCandidate;

    const lanCandidate = (settingsCandidate as { connectToControllerViaLan?: unknown }).connectToControllerViaLan;
    if (typeof lanCandidate === 'boolean') result.settings.connectToControllerViaLan = lanCandidate;
  }

  const adbUsbCandidate = (candidate as { adbUsb?: unknown }).adbUsb;
  if (adbUsbCandidate && typeof adbUsbCandidate === 'object') {
    result.adbUsb = normalizeAdbUsb(adbUsbCandidate, result.adbUsb);
  }

  const versionCandidate = (candidate as { version?: unknown }).version;
  if (typeof versionCandidate === 'number') {
    result.version = versionCandidate;
  }

  return result;
}

function normalizeAdbUsb(candidate: unknown, fallback: AdbUsbConfig): AdbUsbConfig {
  const normalized: AdbUsbConfig = {
    adbPrivateKeyPkcs8: fallback?.adbPrivateKeyPkcs8 ?? DEFAULT_ADB_USB.adbPrivateKeyPkcs8,
  };
  if (!candidate || typeof candidate !== 'object') {
    return normalized;
  }
  const keyCandidate = (candidate as { adbPrivateKeyPkcs8?: unknown }).adbPrivateKeyPkcs8;
  if (typeof keyCandidate === 'string') {
    normalized.adbPrivateKeyPkcs8 = keyCandidate.length > 0 ? keyCandidate : null;
  } else if (keyCandidate === null) {
    normalized.adbPrivateKeyPkcs8 = null;
  }
  return normalized;
}

export function readStoredConfig(): PortalEmulatorConfig | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const normalized = ensureConfigSuffix(ensureConfigDefaults(normalizeConfig(parsed, null)));
    return normalized;
  } catch {
    return null;
  }
}

export function persistStoredConfig(config: PortalEmulatorConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export function getOrCreateRuntimeConfig(): PortalEmulatorConfig {
  return readStoredConfig() ?? ensureConfigSuffix(ensureConfigDefaults(normalizeConfig(DEFAULT_CONFIG, null)));
}
