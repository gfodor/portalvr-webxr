import type { PortalEmulatorConfig } from 'portalvr/device/PortalEmulatorConfig.js';
import {
	CONFIG_STORAGE_KEY,
	MESSAGE_TYPE_ENSURE_RUNTIME,
	MESSAGE_TYPE_GET_CONFIG,
	MESSAGE_TYPE_SET_CONFIG,
	PORTAL_CONFIG_OVERRIDE_GLOBAL,
	RUNTIME_ASSET_BASE_GLOBAL,
	RUNTIME_ASSET_BASE_SETTER,
} from 'portalvr/context/constants.js';
import {
	createPortalRuntimeContext,
	type RuntimeConfigStore,
} from 'portalvr/context/PortalRuntimeContext.js';

declare const chrome: any;

const RUNTIME_SCRIPT_PATH = 'build/iwe.min.js';
const RUNTIME_INSTALL_FLAG = '__iweRuntimeInstalled__';
const RUNTIME_INSTALL_PROMISE_KEY = '__iweRuntimeInstallPromise__';
const RUNTIME_CONTENT_SCRIPT_ID = 'iwe-runtime-preload';
// Removed: CONFIG_READY_RESOLVED_KEY / CONFIG_READY_PROMISE_KEY / CONFIG_READY_RESOLVER_KEY
const BLOCKED_PROTOCOL_PREFIXES = ['chrome:', 'edge:', 'devtools:', 'about:', 'view-source:', 'chrome-extension:'];
const inflightInjectionTasks = new Map<string, Promise<void>>();
// Silence debug output by default
const DEBUG_LOGGING = false;

const runtimeConfigStore: RuntimeConfigStore = {
	async read() {
		const stored = await storageGet(CONFIG_STORAGE_KEY);
		const candidate = stored?.[CONFIG_STORAGE_KEY] as
			| PortalEmulatorConfig
			| null
			| undefined;
		return candidate ?? null;
	},
	async write(config) {
		await storageSet({
			[CONFIG_STORAGE_KEY]: config,
		});
	},
};

const runtimeConfigController = createPortalRuntimeContext(runtimeConfigStore);

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

void ensureRuntimePreloadRegistered();

chrome.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number }; frameId?: number; url?: string } | null, sendResponse: (response?: unknown) => void) => {
	if (!isRuntimeMessage(message)) {
		return;
	}

	if (message.type === MESSAGE_TYPE_SET_CONFIG) {
		runtimeConfigController
			.setRuntimeConfig((message as { config?: unknown }).config)
			.then((config) => sendResponse({ ok: true, config }))
			.catch(() => sendResponse({ ok: false }));
		return true;
	}

	if (message.type === MESSAGE_TYPE_GET_CONFIG) {
		runtimeConfigController
			.getOrCreateRuntimeConfig()
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

		await injectRuntimeAssetBase(target).catch(() => undefined);

		// Detect runtime but DO NOT bail; we still inject the config override to avoid races.
		const alreadyInstalled = await isRuntimeAlreadyInstalled(target);
		if (alreadyInstalled) {
			logDebug('runtime already installed (will still inject config override)', { tabId, frameId });
		}

		const config = await runtimeConfigController.getOrCreateRuntimeConfig();
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

async function isRuntimeAlreadyInstalled(target: FrameTarget): Promise<boolean> {

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
				// Removed: __iweConfigReady* globals/resolver; runtime now observes config via PortalConfigProvider.
			},
			args: [
				PORTAL_CONFIG_OVERRIDE_GLOBAL,
				config,
				MESSAGE_TYPE_SET_CONFIG,
			],
		});
	} catch (_error) {
		// ignore injection failures
	}
}

function getExtensionRuntimeAssetBase(): string | null {
	try {
		if (!chrome?.runtime?.getURL) {
			return null;
		}
		return chrome.runtime.getURL('build/');
	} catch {
		return null;
	}
}

async function injectRuntimeAssetBase(target: FrameTarget): Promise<void> {
	if (!chrome?.scripting?.executeScript) {
		return;
	}
	const baseUrl = getExtensionRuntimeAssetBase();
	if (!baseUrl) {
		return;
	}
	const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	try {
		await chrome.scripting.executeScript({
			target: createFrameTarget(target),
			world: 'MAIN',
			injectImmediately: true,
			func: (globalKey: string, setterKey: string, base: string) => {
				const globalTarget = window as typeof window & Record<string, unknown>;
				try {
					globalTarget[globalKey] = base;
					const setter = globalTarget[setterKey];
					if (typeof setter === 'function') {
						try {
							setter(base);
						} catch {
							/* ignore setter failures */
						}
					}
				} catch {
					// ignore assignment failures
				}
			},
			args: [RUNTIME_ASSET_BASE_GLOBAL, RUNTIME_ASSET_BASE_SETTER, normalized],
		});
	} catch (error) {
		logDebug('failed to inject runtime asset base', { error });
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
