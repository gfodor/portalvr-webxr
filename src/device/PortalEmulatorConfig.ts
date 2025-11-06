/**
 * Portal Emulator Config (typed; no JSONSchema validation).
 *
 * Stores:
 *  - device.suffix (persistent device identity suffix)
 *  - settings.faceTrackingEnabled (default true)
 *  - settings.stereoRenderingEnabled (default false)
 *  - settings.immersiveFullscreenEnabled (default true)
 *  - settings.connectToControllerViaLan (default true)
 *
 * All reads/writes stay inside the injected config override global so host pages are untouched.
 */

export const PORTAL_CONFIG_STORAGE_KEY = '___portalvr_config';
export const PORTAL_CONFIG_OVERRIDE_GLOBAL = '__PORTALVR_EMULATOR_CONFIG_OVERRIDE__';
const CONFIG_EVENT_TYPE = 'portalvr:set-config';

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
    immersiveFullscreenEnabled: boolean;
    connectToControllerViaLan: boolean;
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
    immersiveFullscreenEnabled: true,
    connectToControllerViaLan: true,
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

function normalizeConfigShape(candidate: unknown): PortalEmulatorConfig | null {
  let source = candidate;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object') {
    return null;
  }
  const deviceCandidate =
    typeof (source as { device?: unknown }).device === 'object' && (source as { device?: unknown }).device
      ? ((source as { device: Record<string, unknown> }).device)
      : {};
  const settingsCandidate =
    typeof (source as { settings?: unknown }).settings === 'object' && (source as { settings?: unknown }).settings
      ? ((source as { settings: Record<string, unknown> }).settings)
      : {};
  const normalized: PortalEmulatorConfig = {
    device: {
      suffix:
        typeof (deviceCandidate as { suffix?: unknown }).suffix === 'string'
          ? ((deviceCandidate as { suffix: string }).suffix)
          : DEFAULT_CONFIG.device.suffix,
    },
    settings: {
      faceTrackingEnabled:
        typeof (settingsCandidate as { faceTrackingEnabled?: unknown }).faceTrackingEnabled === 'boolean'
          ? ((settingsCandidate as { faceTrackingEnabled: boolean }).faceTrackingEnabled)
          : DEFAULT_CONFIG.settings.faceTrackingEnabled,
      stereoRenderingEnabled:
        typeof (settingsCandidate as { stereoRenderingEnabled?: unknown }).stereoRenderingEnabled === 'boolean'
          ? ((settingsCandidate as { stereoRenderingEnabled: boolean }).stereoRenderingEnabled)
          : DEFAULT_CONFIG.settings.stereoRenderingEnabled,
      immersiveFullscreenEnabled:
        typeof (settingsCandidate as { immersiveFullscreenEnabled?: unknown }).immersiveFullscreenEnabled === 'boolean'
          ? ((settingsCandidate as { immersiveFullscreenEnabled: boolean }).immersiveFullscreenEnabled)
          : DEFAULT_CONFIG.settings.immersiveFullscreenEnabled,
      connectToControllerViaLan:
        typeof (settingsCandidate as { connectToControllerViaLan?: unknown }).connectToControllerViaLan === 'boolean'
          ? ((settingsCandidate as { connectToControllerViaLan: boolean }).connectToControllerViaLan)
          : DEFAULT_CONFIG.settings.connectToControllerViaLan,
    },
    version:
      typeof (source as { version?: unknown }).version === 'number'
        ? ((source as { version: number }).version)
        : DEFAULT_CONFIG.version,
  };
  return normalized;
}

function writeConfig(next: PortalEmulatorConfig): void {
  cachedConfig = next;
  writeConfigOverride(next);
  notifyExtensionConfigUpdated(next);
}

export function getPortalEmulatorConfig(): PortalEmulatorConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  const overrideConfig = readConfigOverride();
  if (overrideConfig) {
    cachedConfig = overrideConfig;
    return cachedConfig;
  }
  const fallback = createDefaultConfig();
  cachedConfig = fallback;
  writeConfigOverride(fallback);
  return fallback;
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
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const handler = (event: Event) => {
    const candidate = (event as CustomEvent<PortalEmulatorConfig | null | undefined>).detail;
    const normalized = candidate ? normalizeConfigShape(candidate) : null;
    if (!normalized) {
      return;
    }
    cachedConfig = normalized;
    listener(normalized);
  };
  window.addEventListener(CONFIG_EVENT_TYPE, handler as EventListener);
  return () => window.removeEventListener(CONFIG_EVENT_TYPE, handler as EventListener);
}

function readConfigOverride(): PortalEmulatorConfig | null {
  try {
    if (typeof window === 'undefined') {
      return cachedConfig;
    }
    const globalWithOverride = window as typeof window & Record<string, unknown>;
    const candidate = globalWithOverride[PORTAL_CONFIG_OVERRIDE_GLOBAL];
    const normalized = candidate ? normalizeConfigShape(candidate) : null;
    if (normalized) {
      globalWithOverride[PORTAL_CONFIG_OVERRIDE_GLOBAL] = normalized;
    }
    return normalized;
  } catch {
    return cachedConfig;
  }
}

function writeConfigOverride(config: PortalEmulatorConfig): boolean {
  try {
    if (typeof window === 'undefined') {
      return false;
    }
    const globalWithOverride = window as typeof window & Record<string, unknown>;
    globalWithOverride[PORTAL_CONFIG_OVERRIDE_GLOBAL] = config;
    return true;
  } catch {
    return false;
  }
}

function notifyExtensionConfigUpdated(config: PortalEmulatorConfig): void {
  let delivered = false;
  try {
    if (typeof chrome !== 'undefined') {
      const runtime = chrome?.runtime;
      if (runtime?.id && typeof runtime.sendMessage === 'function') {
        runtime.sendMessage({ type: CONFIG_EVENT_TYPE, config });
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
      window.dispatchEvent(new CustomEvent(CONFIG_EVENT_TYPE, { detail: config }));
    }
  } catch {
    // ignore dispatch failures (non-browser contexts)
  }
}
