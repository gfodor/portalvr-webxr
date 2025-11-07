const RUNTIME_BASE_GLOBAL = '__PORTALVR_RUNTIME_BASE_URL__';
const RUNTIME_SETTER_GLOBAL = '__PORTALVR_SET_ASSET_BASE__';

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_BASE_GLOBAL]?: string;
  [RUNTIME_SETTER_GLOBAL]?: (baseUrl: string | null) => void;
};

const globalTarget = globalThis as RuntimeGlobal;

function ensureTrailingSlash(candidate: string): string {
  if (candidate.endsWith('/')) {
    return candidate;
  }
  return `${candidate}/`;
}

function detectRuntimeBaseUrl(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript?.src) {
    try {
      return ensureTrailingSlash(new URL('./', currentScript.src).toString());
    } catch {
      // ignore invalid URL
    }
  }

  // Fallback: scan existing script tags (useful when bundlers hoist modules).
  const scripts = Array.from(document.getElementsByTagName('script'));
  for (let index = scripts.length - 1; index >= 0; index -= 1) {
    const candidate = scripts[index];
    if (!candidate?.src) {
      continue;
    }
    try {
      return ensureTrailingSlash(new URL('./', candidate.src).toString());
    } catch {
      // ignore invalid script URLs
    }
  }

  return null;
}

export function getRuntimeAssetBaseUrl(): string | null {
  const base = globalTarget[RUNTIME_BASE_GLOBAL];
  if (typeof base === 'string' && base.length > 0) {
    return base;
  }
  return null;
}

export function setRuntimeAssetBaseUrl(baseUrl: string | null): void {
  if (typeof baseUrl === 'string' && baseUrl.length > 0) {
    const normalized = ensureTrailingSlash(baseUrl);
    globalTarget[RUNTIME_BASE_GLOBAL] = normalized;
    return;
  }
  delete globalTarget[RUNTIME_BASE_GLOBAL];
}

export function resolveRuntimeAssetUrl(relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return null;
  }
  const baseUrl = getRuntimeAssetBaseUrl();
  if (!baseUrl) {
    return null;
  }
  try {
    const normalizedPath = relativePath.startsWith('/')
      ? relativePath.slice(1)
      : relativePath;
    // Force resolution relative to the base directory rather than the origin root.
    return new URL(`./${normalizedPath}`, baseUrl).toString();
  } catch {
    return null;
  }
}

function bootstrapRuntimeAssetBase(): void {
  if (getRuntimeAssetBaseUrl()) {
    return;
  }
  const detected = detectRuntimeBaseUrl();
  if (detected) {
    setRuntimeAssetBaseUrl(detected);
  }
}

bootstrapRuntimeAssetBase();

if (!globalTarget[RUNTIME_SETTER_GLOBAL]) {
  globalTarget[RUNTIME_SETTER_GLOBAL] = (url: string | null) => {
    setRuntimeAssetBaseUrl(url);
  };
}
