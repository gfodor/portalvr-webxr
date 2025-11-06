import type { PortalEmulatorConfig } from 'portalvr';

const RUNTIME_SCRIPT_ID = '__iwe-runtime-injected__';
const IDENTITY_SCRIPT_ID = '__iwe-portal-identity-injected__';
const MESSAGE_TYPE_GET_STATE = 'portalvr:get-state';
const MESSAGE_TYPE_SET_CONFIG = 'portalvr:set-config';

const DEFAULT_SETTINGS: PortalEmulatorConfig['settings'] = {
	faceTrackingEnabled: true,
	stereoRenderingEnabled: false,
	immersiveFullscreenEnabled: true,
	connectToControllerViaLan: true,
};
const DEFAULT_VERSION = 1;

interface PortalDeviceIdentity {
	suffix: string;
	fullName?: string;
	uiCode?: string;
}

interface PortalRuntimeState {
	identity: PortalDeviceIdentity | null;
	config: PortalEmulatorConfig | null;
}

const ensureRuntimeInjected = async () => {
	const root =
		document.documentElement || document.head || document.body || null;
	if (!root) {
		return;
	}

	if (document.getElementById(RUNTIME_SCRIPT_ID)) {
		return;
	}

	const state = await requestPortalRuntimeState();
	const identity = state?.identity ?? null;
	const config = state?.config ?? null;
	if (identity?.suffix) {
		await injectIdentityOverride(root, identity, config);
	}

	injectRuntimeScript(root);
};

function injectRuntimeScript(root: Element): void {
	if (document.getElementById(RUNTIME_SCRIPT_ID)) {
		return;
	}

	const script = document.createElement('script');
	script.id = RUNTIME_SCRIPT_ID;
	script.type = 'text/javascript';
	script.src = chrome.runtime.getURL('build/iwe.min.js');
	script.async = false;

	const identityScript = document.getElementById(IDENTITY_SCRIPT_ID);
	if (identityScript && identityScript.parentNode) {
		identityScript.parentNode.insertBefore(script, identityScript.nextSibling);
		return;
	}

	const firstChild = root.firstChild;
	if (firstChild) {
		root.insertBefore(script, firstChild);
	} else {
		root.appendChild(script);
	}
}

function injectIdentityOverride(
	root: Element,
	identity: PortalDeviceIdentity,
	config: PortalEmulatorConfig | null,
): Promise<void> {
	if (document.getElementById(IDENTITY_SCRIPT_ID)) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		const script = document.createElement('script');
		script.id = IDENTITY_SCRIPT_ID;
		script.type = 'text/javascript';
		script.async = false;
		script.src = chrome.runtime.getURL('build/identity-bootstrap.js');
		script.dataset.identity = JSON.stringify(identity);
		if (config) {
			script.dataset.config = JSON.stringify(config);
		}
		const finalize = () => resolve();
		script.addEventListener('load', finalize, { once: true });
		script.addEventListener('error', finalize, { once: true });
		const firstChild = root.firstChild;
		if (firstChild) {
			root.insertBefore(script, firstChild);
		} else {
			root.appendChild(script);
		}
	});
}

function requestPortalRuntimeState(): Promise<PortalRuntimeState | null> {
	if (!chrome.runtime?.id) {
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage(
				{ type: MESSAGE_TYPE_GET_STATE },
				(response?: unknown) => {
					if (chrome.runtime.lastError) {
						resolve(null);
						return;
					}

					const identity = parseIdentity((response as { identity?: unknown })?.identity);
					const config = parseConfig((response as { config?: unknown })?.config);
					if (!identity && !config) {
						resolve(null);
						return;
					}
					resolve({ identity, config });
				},
			);
		} catch (_) {
			resolve(null);
		}
	});
}

function parseIdentity(candidate: unknown): PortalDeviceIdentity | null {
	if (!candidate || typeof candidate !== 'object') {
		return null;
	}
	const suffixValue = (candidate as { suffix?: unknown }).suffix;
	if (typeof suffixValue !== 'string' || !suffixValue) {
		return null;
	}
	return {
		suffix: suffixValue,
		fullName:
			typeof (candidate as { fullName?: unknown }).fullName === 'string'
			?
				(candidate as { fullName: string }).fullName
			: undefined,
		uiCode:
			typeof (candidate as { uiCode?: unknown }).uiCode === 'string'
			?
				(candidate as { uiCode: string }).uiCode
			: undefined,
	};
}

function parseConfig(candidate: unknown): PortalEmulatorConfig | null {
	if (!candidate || typeof candidate !== 'object') {
		return null;
	}
	const deviceCandidate = (candidate as { device?: unknown }).device;
	const settingsCandidate = (candidate as { settings?: unknown }).settings;
	const versionCandidate = (candidate as { version?: unknown }).version;
	const suffixCandidate =
		deviceCandidate && typeof deviceCandidate === 'object'
			?
				(deviceCandidate as { suffix?: unknown }).suffix
			: undefined;
	const faceCandidate =
		settingsCandidate && typeof settingsCandidate === 'object'
			?
				(settingsCandidate as { faceTrackingEnabled?: unknown }).faceTrackingEnabled
			: undefined;
	const stereoCandidate =
		settingsCandidate && typeof settingsCandidate === 'object'
			?
				(settingsCandidate as { stereoRenderingEnabled?: unknown }).stereoRenderingEnabled
			: undefined;
	const fullscreenCandidate =
		settingsCandidate && typeof settingsCandidate === 'object'
			?
				(settingsCandidate as { immersiveFullscreenEnabled?: unknown }).immersiveFullscreenEnabled
			: undefined;
	const lanCandidate =
		settingsCandidate && typeof settingsCandidate === 'object'
			?
				(settingsCandidate as { connectToControllerViaLan?: unknown }).connectToControllerViaLan
			: undefined;
	return {
		device: { suffix: typeof suffixCandidate === 'string' ? suffixCandidate : '' },
		settings: {
			faceTrackingEnabled:
				typeof faceCandidate === 'boolean'
					? faceCandidate
					: DEFAULT_SETTINGS.faceTrackingEnabled,
			stereoRenderingEnabled:
				typeof stereoCandidate === 'boolean'
					? stereoCandidate
					: DEFAULT_SETTINGS.stereoRenderingEnabled,
			immersiveFullscreenEnabled:
				typeof fullscreenCandidate === 'boolean'
					? fullscreenCandidate
					: DEFAULT_SETTINGS.immersiveFullscreenEnabled,
			connectToControllerViaLan:
				typeof lanCandidate === 'boolean'
					? lanCandidate
					: DEFAULT_SETTINGS.connectToControllerViaLan,
		},
		version: typeof versionCandidate === 'number' ? versionCandidate : DEFAULT_VERSION,
	};
}

function bridgePageConfigUpdates(): void {
	window.addEventListener(MESSAGE_TYPE_SET_CONFIG, (event: Event) => {
		if (!chrome.runtime?.id) {
			return;
		}
		const custom = event as CustomEvent<PortalEmulatorConfig | null>;
		const config = custom.detail;
		if (!config) {
			return;
		}
		try {
			chrome.runtime.sendMessage({ type: MESSAGE_TYPE_SET_CONFIG, config });
		} catch {
			// ignore send failures (extension might be unavailable)
		}
	});
}

bridgePageConfigUpdates();
void ensureRuntimeInjected();
