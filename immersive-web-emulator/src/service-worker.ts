export {};

declare const chrome: any;

const MESSAGE_TYPE_GET_STATE = 'portalvr:get-state';
const MESSAGE_TYPE_SET_CONFIG = 'portalvr:set-config';
const CONFIG_STORAGE_KEY = 'portalvrConfig';
const NAME_PREFIX = 'PORTAL-';
const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

interface PortalDeviceIdentity {
	suffix: string;
	fullName: string;
	uiCode: string;
}

interface PortalEmulatorConfig {
	device: {
		suffix: string;
	};
	settings: {
		faceTrackingEnabled: boolean;
		stereoRenderingEnabled: boolean;
	};
	version?: number;
}

interface PortalRuntimeState {
	identity: PortalDeviceIdentity;
	config: PortalEmulatorConfig;
}

const DEFAULT_CONFIG: PortalEmulatorConfig = {
	device: { suffix: '' },
	settings: {
		faceTrackingEnabled: true,
		stereoRenderingEnabled: false,
	},
	version: 1,
};

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
	if (!isRuntimeMessage(message)) {
		return;
	}

	if (message.type === MESSAGE_TYPE_GET_STATE) {
		getOrCreateRuntimeState()
			.then((state) => sendResponse(state))
			.catch(() => sendResponse(null));
		return true;
	}

	if (message.type === MESSAGE_TYPE_SET_CONFIG) {
		setRuntimeConfig((message as { config?: unknown }).config)
			.then((state) => sendResponse({ ok: true, state }))
			.catch(() => sendResponse({ ok: false }));
		return true;
	}

	return;
});

function isRuntimeMessage(message: unknown): message is { type: string } {
	return !!message && typeof message === 'object' && 'type' in message;
}

async function getOrCreateRuntimeState(): Promise<PortalRuntimeState> {
	const storedConfig = await readStoredConfig();
	if (storedConfig) {
		const normalizedConfig = ensureConfigDefaults(storedConfig);
		const identity = buildIdentity(normalizedConfig.device.suffix);
		return { identity, config: normalizedConfig };
	}

	const freshSuffix = generateSuffix();
	const config = ensureConfigDefaults(
		normalizeConfig(
			{
				device: { suffix: freshSuffix },
				settings: DEFAULT_CONFIG.settings,
				version: DEFAULT_CONFIG.version,
			},
			null,
		),
	);
	await persistState({ config });
	const identity = buildIdentity(config.device.suffix);
	return { identity, config };
}

async function setRuntimeConfig(candidate: unknown): Promise<PortalRuntimeState> {
	const current = await getOrCreateRuntimeState();
	const normalizedConfig = ensureConfigDefaults(normalizeConfig(candidate, current.config));
	await persistState({ config: normalizedConfig });
	const identity = buildIdentity(normalizedConfig.device.suffix);
	return { identity, config: normalizedConfig };
}

async function readStoredConfig(): Promise<PortalEmulatorConfig | null> {
	const stored = await storageGet(CONFIG_STORAGE_KEY);
	const candidate = stored?.[CONFIG_STORAGE_KEY];
	if (!candidate) {
		return null;
	}
	const normalized = ensureConfigDefaults(normalizeConfig(candidate, null));
	if (!normalized.device.suffix) {
		return null;
	}
	return normalized;
}

function ensureConfigDefaults(config: PortalEmulatorConfig): PortalEmulatorConfig {
	const normalizedSuffix = normalizeSuffix(config.device.suffix) ?? '';
	return {
		device: { suffix: normalizedSuffix },
		settings: {
			faceTrackingEnabled: config.settings.faceTrackingEnabled,
			stereoRenderingEnabled: config.settings.stereoRenderingEnabled,
		},
		version:
			typeof config.version === 'number' ? config.version : DEFAULT_CONFIG.version,
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

function buildIdentity(suffix: string): PortalDeviceIdentity {
	const normalizedSuffix = normalizeSuffix(suffix) ?? generateSuffix();
	return {
		suffix: normalizedSuffix,
		fullName: `${NAME_PREFIX}${normalizedSuffix}`,
		uiCode: normalizedSuffix.substring(0, UI_SUFFIX_LENGTH),
	};
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
