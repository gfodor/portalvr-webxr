/**
 * Portal Emulator Config (typed; no JSONSchema validation).
 *
 * Stores:
 *  - device.suffix (persistent device identity suffix)
 *  - settings.faceTrackingEnabled (default true)
 *  - settings.stereoRenderingEnabled (default false)
 *
 * All reads/writes are resilient to localStorage errors and missing window.
 */

export const PORTAL_CONFIG_STORAGE_KEY = '___portalvr_config';

declare const chrome:
  | undefined
  | {
      runtime?: {
        id?: string;
        sendMessage?: (message: unknown) => void;
      };
    };

export interface PortalEmulatorConfig {
  device: {
    /** 12-char uppercase A–Z0–9 suffix, eg: ABCD… */
    suffix: string;
  };
  settings: {
    faceTrackingEnabled: boolean;
    stereoRenderingEnabled: boolean;
  };
  /** reserved for future migrations */
  version?: number;
}

type PartialConfig = {
  device?: Partial<PortalEmulatorConfig['device']>;
  settings?: Partial<PortalEmulatorConfig['settings']>;
  version?: PortalEmulatorConfig['version'];
};

const DEFAULT_CONFIG: PortalEmulatorConfig = {
  device: { suffix: '' },
  settings: {
    faceTrackingEnabled: true,
    stereoRenderingEnabled: false,
  },
  version: 1,
};

function createDefaultConfig(): PortalEmulatorConfig {
  return {
    device: { ...DEFAULT_CONFIG.device },
    settings: { ...DEFAULT_CONFIG.settings },
    version: DEFAULT_CONFIG.version,
  };
}

let cachedConfig: PortalEmulatorConfig | null = null;

function getLocalStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

function parseConfig(raw: string | null): PortalEmulatorConfig | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    // Shallow normalization with defaults
    const device = typeof obj.device === 'object' && obj.device ? obj.device : {};
    const settings = typeof obj.settings === 'object' && obj.settings ? obj.settings : {};
    return {
      device: {
        suffix: typeof device.suffix === 'string' ? device.suffix : DEFAULT_CONFIG.device.suffix,
      },
      settings: {
        faceTrackingEnabled:
          typeof settings.faceTrackingEnabled === 'boolean'
            ? settings.faceTrackingEnabled
            : DEFAULT_CONFIG.settings.faceTrackingEnabled,
        stereoRenderingEnabled:
          typeof settings.stereoRenderingEnabled === 'boolean'
            ? settings.stereoRenderingEnabled
            : DEFAULT_CONFIG.settings.stereoRenderingEnabled,
      },
      version: typeof obj.version === 'number' ? obj.version : DEFAULT_CONFIG.version,
    };
  } catch {
    return null;
  }
}

function writeConfig(next: PortalEmulatorConfig): void {
  const ls = getLocalStorageSafe();
  cachedConfig = next;
  if (ls) {
    try {
      ls.setItem(PORTAL_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
  }
  notifyExtensionConfigUpdated(next);
}

export function getPortalEmulatorConfig(): PortalEmulatorConfig {
  if (cachedConfig) return cachedConfig;
  const ls = getLocalStorageSafe();
  const parsed = parseConfig(ls?.getItem(PORTAL_CONFIG_STORAGE_KEY) || null) ?? createDefaultConfig();
  cachedConfig = parsed;
  return cachedConfig;
}

/**
 * Shallow merge update: merges device/settings objects and persists.
 */
export function updatePortalEmulatorConfig(patch: PartialConfig): PortalEmulatorConfig {
  const current = getPortalEmulatorConfig();
  const next: PortalEmulatorConfig = {
    ...current,
    device: { ...current.device, ...(patch.device ?? {}) },
    settings: { ...current.settings, ...(patch.settings ?? {}) },
    version: current.version ?? 1,
  };
  writeConfig(next);
  return next;
}

/**
 * Subscribe to cross-tab config changes. Returns an unsubscribe.
 */
export function onPortalEmulatorConfigChange(listener: (cfg: PortalEmulatorConfig) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key !== PORTAL_CONFIG_STORAGE_KEY) return;
    // clear cache and re-read
    cachedConfig = null;
    listener(getPortalEmulatorConfig());
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
  return () => {};
}

function notifyExtensionConfigUpdated(config: PortalEmulatorConfig): void {
  let delivered = false;
  try {
    if (typeof chrome !== 'undefined') {
      const runtime = chrome?.runtime;
      if (runtime?.id && typeof runtime.sendMessage === 'function') {
        runtime.sendMessage({ type: 'portalvr:set-config', config });
        delivered = true;
      }
    }
  } catch {
    // ignore extension messaging failures and fall back to DOM event below
  }

  if (delivered) {
    return;
  }

  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('portalvr:set-config', { detail: config }));
    }
  } catch {
    // ignore dispatch failures (non-browser contexts)
  }
}
