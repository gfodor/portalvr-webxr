export {};

declare const chrome: any;

const MESSAGE_TYPE_SET_CONFIG = 'portalvr:set-config';
const MESSAGE_TYPE_ENSURE_RUNTIME = 'portalvr:ensure-runtime';
const MESSAGE_TYPE_GET_CONFIG = 'portalvr:get-config';
const CONFIG_STORAGE_KEY = 'portalvrConfig';
const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PORTAL_CONFIG_OVERRIDE_GLOBAL = '__PORTALVR_EMULATOR_CONFIG_OVERRIDE__';
const RUNTIME_SCRIPT_PATH = 'build/iwe.min.js';
const RUNTIME_INSTALL_FLAG = '__iweRuntimeInstalled__';
const RUNTIME_INSTALL_PROMISE_KEY = '__iweRuntimeInstallPromise__';
const RUNTIME_CONTENT_SCRIPT_ID = 'iwe-runtime-preload';
const CONFIG_READY_RESOLVED_KEY = '__iweConfigReadyResolved__';
const CONFIG_READY_PROMISE_KEY = '__iweConfigReadyPromise__';
const CONFIG_READY_RESOLVER_KEY = '__iweConfigReadyResolver__';
const BLOCKED_PROTOCOL_PREFIXES = ['chrome:', 'edge:', 'devtools:', 'about:', 'view-source:', 'chrome-extension:'];
const inflightInjectionTasks = new Map<string, Promise<void>>();
const DEBUG_LOGGING = true;

function logDebug(...args: unknown[]): void {
	if (!DEBUG_LOGGING) {
		return;
	}
	try {
		console.info('[IWE bootstrap]', ...args);
	} catch {
		/* noop */
	}
}

interface PortalEmulatorConfig {
	device: {
		suffix: string;
	};
	settings: {
		faceTrackingEnabled: boolean;
		stereoRenderingEnabled: boolean;
		immersiveFullscreenEnabled: boolean;
		connectToControllerViaLan: boolean;
	};
	version?: number;
}
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

void ensureRuntimePreloadRegistered();

chrome.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number }; frameId?: number; url?: string } | null, sendResponse: (response?: unknown) => void) => {
	if (!isRuntimeMessage(message)) {
		return;
	}

	if (message.type === MESSAGE_TYPE_SET_CONFIG) {
		setRuntimeConfig((message as { config?: unknown }).config)
			.then((config) => sendResponse({ ok: true, config }))
			.catch(() => sendResponse({ ok: false }));
		return true;
	}

	if (message.type === MESSAGE_TYPE_GET_CONFIG) {
		getOrCreateRuntimeConfig()
			.then((config) => sendResponse({ ok: true, config }))
			.catch(() => sendResponse({ ok: false }));
		return true;
	}

	if (message.type === MESSAGE_TYPE_ENSURE_RUNTIME) {
		const tabId = sender?.tab?.id;
		if (typeof tabId !== 'number') {
			logDebug('ensure-runtime rejected: missing tab id', { sender });
			sendResponse({ ok: false, reason: 'missing-tab' });
			return;
		}
		const frameId = typeof sender?.frameId === 'number' ? sender.frameId : 0;
		logDebug('ensure-runtime message', { tabId, frameId, url: sender?.url });
		ensureRuntimeInjected(tabId, frameId, sender?.url)
			.then(() => {
				logDebug('ensure-runtime completed', { tabId, frameId });
				sendResponse({ ok: true });
			})
			.catch((error) => {
				logDebug('ensure-runtime failed', { tabId, frameId, error });
				sendResponse({ ok: false });
			});
		return true;
	}

	return;
});

chrome.webNavigation.onCommitted.addListener((details: { tabId: number; frameId: number; url?: string }) => {
	if (!details || typeof details.tabId !== 'number') {
		return;
	}
	logDebug('webNavigation.onCommitted', details);
	void ensureRuntimeInjected(details.tabId, details.frameId, details.url).catch(() => undefined);
});

chrome.webNavigation.onBeforeNavigate.addListener((details: { tabId: number; frameId: number; url?: string }) => {
	if (!details || typeof details.tabId !== 'number') {
		return;
	}
	logDebug('webNavigation.onBeforeNavigate', details);
	void ensureRuntimeInjected(details.tabId, details.frameId, details.url).catch(() => undefined);
});

function isRuntimeMessage(message: unknown): message is { type: string } {
	return !!message && typeof message === 'object' && 'type' in message;
}

async function ensureRuntimeInjected(tabId: number, frameId: number, url?: string): Promise<void> {
	if (!Number.isInteger(tabId) || tabId < 0) {
		logDebug('ensureRuntimeInjected skip: invalid tab', { tabId, frameId });
		return;
	}
	if (shouldSkipInjection(url)) {
		logDebug('ensureRuntimeInjected skip: blocked url', { tabId, frameId, url });
		return;
	}
	const key = buildInjectionKey(tabId, frameId);
	const existingTask = inflightInjectionTasks.get(key);
	if (existingTask) {
		logDebug('ensureRuntimeInjected dedupe', { tabId, frameId });
		return existingTask;
	}
	const task = (async () => {
		const target: FrameTarget = { tabId, frameId };
		const alreadyInstalled = await isRuntimeAlreadyInstalled(target);
		if (alreadyInstalled) {
			logDebug('runtime already installed', { tabId, frameId });
			return;
		}
		const config = await getOrCreateRuntimeConfig();
		logDebug('injecting config override', {
			tabId,
			frameId,
			deviceSuffix: config.device.suffix,
			immersiveFullscreenEnabled: config.settings.immersiveFullscreenEnabled,
			stereoRenderingEnabled: config.settings.stereoRenderingEnabled,
			connectToControllerViaLan: config.settings.connectToControllerViaLan,
		});
		await injectConfigOverride(target, config);
	})();
	inflightInjectionTasks.set(key, task);
	try {
		await task;
	} finally {
		inflightInjectionTasks.delete(key);
		logDebug('ensureRuntimeInjected finished', { tabId, frameId });
	}
}

async function getOrCreateRuntimeConfig(): Promise<PortalEmulatorConfig> {
	const storedConfig = await readStoredConfig();
	if (storedConfig) {
		return storedConfig;
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
	await persistState({ config: configWithSuffix });
	return configWithSuffix;
}

async function setRuntimeConfig(candidate: unknown): Promise<PortalEmulatorConfig> {
	const current = await getOrCreateRuntimeConfig();
	const normalizedConfig = ensureConfigSuffix(
		ensureConfigDefaults(normalizeConfig(candidate, current)),
	);
	await persistState({ config: normalizedConfig });
	return normalizedConfig;
}

async function readStoredConfig(): Promise<PortalEmulatorConfig | null> {
	const stored = await storageGet(CONFIG_STORAGE_KEY);
	const candidate = stored?.[CONFIG_STORAGE_KEY];
	if (!candidate) {
		return null;
	}
	const normalized = ensureConfigSuffix(
		ensureConfigDefaults(normalizeConfig(candidate, null)),
	);
	return normalized;
}

function ensureConfigDefaults(config: PortalEmulatorConfig): PortalEmulatorConfig {
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

function ensureConfigSuffix(config: PortalEmulatorConfig): PortalEmulatorConfig {
	const normalizedSuffix = normalizeSuffix(config.device.suffix) ?? generateSuffix();
	return {
		...config,
		device: { ...config.device, suffix: normalizedSuffix },
	};
}

function normalizeConfig(
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
		const faceCandidate = (settingsCandidate as { faceTrackingEnabled?: unknown }).faceTrackingEnabled;
		if (typeof faceCandidate === 'boolean') {
			result.settings.faceTrackingEnabled = faceCandidate;
		}
		const stereoCandidate = (settingsCandidate as { stereoRenderingEnabled?: unknown }).stereoRenderingEnabled;
		if (typeof stereoCandidate === 'boolean') {
			result.settings.stereoRenderingEnabled = stereoCandidate;
		}
		const fullscreenCandidate = (settingsCandidate as { immersiveFullscreenEnabled?: unknown }).immersiveFullscreenEnabled;
		if (typeof fullscreenCandidate === 'boolean') {
			result.settings.immersiveFullscreenEnabled = fullscreenCandidate;
		}
		const lanCandidate = (settingsCandidate as { connectToControllerViaLan?: unknown }).connectToControllerViaLan;
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

async function persistState(state: { config: PortalEmulatorConfig }): Promise<void> {
	await storageSet({
		[CONFIG_STORAGE_KEY]: state.config,
	});
}

async function isRuntimeAlreadyInstalled(target: FrameTarget): Promise<boolean> {
	try {
		const results = await chrome.scripting.executeScript({
			target: createFrameTarget(target),
			world: 'MAIN',
			injectImmediately: true,
			func: (flagName: string, promiseKey: string) => {
				const globalTarget = window as typeof window & Record<string, unknown>;
				return Boolean(globalTarget[flagName] || globalTarget[promiseKey]);
			},
			args: [RUNTIME_INSTALL_FLAG, RUNTIME_INSTALL_PROMISE_KEY],
		});
		return Boolean(results?.[0]?.result);
	} catch (_error) {
		return false;
	}
}

async function injectConfigOverride(
	target: FrameTarget,
	config: PortalEmulatorConfig,
): Promise<void> {
	try {
		await chrome.scripting.executeScript({
			target: createFrameTarget(target),
			world: 'MAIN',
			injectImmediately: true,
			func: (
				configKey: string,
				configValue: PortalEmulatorConfig,
				configReadyResolvedKey: string,
				configReadyPromiseKey: string,
				configReadyResolverKey: string,
				configEventType: string,
			) => {
				const globalTarget = window as typeof window & Record<string, unknown>;
				try {
					globalTarget[configKey] = configValue;
				} catch {
					// ignore assignment failure
				}
				try {
					window.dispatchEvent(
						new CustomEvent(configEventType, { detail: configValue }),
					);
				} catch {
					// ignore event dispatch failures
				}
				globalTarget[configReadyResolvedKey] = true;
				try {
					globalTarget[configReadyPromiseKey] = Promise.resolve();
				} catch {
					// ignore promise override failures
				}
				const resolver = globalTarget[configReadyResolverKey];
				if (typeof resolver === 'function') {
					try {
						resolver();
					} catch {
						// ignore resolver errors
					}
				}
				try {
					globalTarget[configReadyResolverKey] = undefined;
				} catch {
					// ignore cleanup failures
				}
			},
			args: [
				PORTAL_CONFIG_OVERRIDE_GLOBAL,
				config,
				CONFIG_READY_RESOLVED_KEY,
				CONFIG_READY_PROMISE_KEY,
				CONFIG_READY_RESOLVER_KEY,
				MESSAGE_TYPE_SET_CONFIG,
			],
		});
	} catch (_error) {
		// ignore injection failures
	}
}

type FrameTarget = { tabId: number; frameId: number };

function createFrameTarget(target: FrameTarget) {
	const frameIds = Number.isInteger(target.frameId)
		? [target.frameId]
		: undefined;
	return frameIds ? { tabId: target.tabId, frameIds } : { tabId: target.tabId };
}

function buildInjectionKey(tabId: number, frameId: number): string {
	return `${tabId}:${frameId}`;
}

function shouldSkipInjection(url?: string): boolean {
	if (!url) {
		return false;
	}
	const normalized = url.trim().toLowerCase();
	return BLOCKED_PROTOCOL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function normalizeSuffix(candidate: string | null): string | null {
	if (!candidate) {
		return null;
	}
	const trimmed = candidate.trim().toUpperCase();
	if (trimmed.length < UI_SUFFIX_LENGTH) {
		return null;
	}
	for (let i = 0; i < trimmed.length; i += 1) {
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
	for (let i = 0; i < count; i += 1) {
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

function storageGet(key: string): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		try {
			chrome.storage.local.get(key, (result: Record<string, unknown>) => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
					return;
				}
				resolve(result ?? {});
			});
		} catch (error) {
			reject(error);
		}
	});
}

function storageSet(items: Record<string, unknown>): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			chrome.storage.local.set(items, () => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
					return;
				}
				resolve();
			});
		} catch (error) {
			reject(error);
		}
	});
}

async function ensureRuntimePreloadRegistered(): Promise<void> {
	if (!chrome?.scripting?.registerContentScripts) {
		return;
	}
	try {
		const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [RUNTIME_CONTENT_SCRIPT_ID] }).catch(() => []);
		if (existing && existing.length > 0) {
			return;
		}
		await chrome.scripting.registerContentScripts([
			{
				id: RUNTIME_CONTENT_SCRIPT_ID,
				js: [RUNTIME_SCRIPT_PATH],
				matches: ['<all_urls>'],
				allFrames: true,
				runAt: 'document_start',
				persistAcrossSessions: true,
				world: 'MAIN',
			},
		]);
		logDebug('registered runtime preload script');
	} catch (error) {
		logDebug('failed to register runtime preload script', { error });
	}
}
