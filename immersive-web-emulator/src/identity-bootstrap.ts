import {
	PORTAL_CONFIG_STORAGE_KEY,
	PORTAL_DEVICE_IDENTITY_OVERRIDE_GLOBAL,
	type PortalEmulatorConfig,
} from 'portalvr';

type PortalDeviceIdentity = {
	suffix: string;
	fullName?: string;
	uiCode?: string;
};

const DEFAULT_SETTINGS: PortalEmulatorConfig['settings'] = {
	faceTrackingEnabled: true,
	stereoRenderingEnabled: false,
};
const DEFAULT_VERSION = 1;

(() => {
	const script = document.currentScript as HTMLScriptElement | null;
	if (!script) {
		return;
	}

	const rawIdentity = script.dataset.identity ?? null;
	const rawConfig = script.dataset.config ?? null;

	const identity = parseIdentity(rawIdentity);
	if (!identity) {
		script.remove();
		return;
	}

	let configCandidate: unknown = null;
	if (rawConfig) {
		try {
			configCandidate = JSON.parse(rawConfig) as unknown;
		} catch {
			configCandidate = null;
		}
	}

	const normalizedConfig = buildConfig(identity, configCandidate);

	const target = window as typeof window & Record<string, unknown>;

	try {
		target[PORTAL_DEVICE_IDENTITY_OVERRIDE_GLOBAL] = identity;
	} catch {
		// Ignore assignment failures (e.g., readonly globals).
	}

	try {
		if (target.localStorage) {
			target.localStorage.setItem(
				PORTAL_CONFIG_STORAGE_KEY,
				JSON.stringify(normalizedConfig),
			);
		}
	} catch {
		// Swallow storage exceptions (e.g., quota exceeded, storage disabled).
	}

	script.remove();
})();

function parseIdentity(raw: string | null): PortalDeviceIdentity | null {
	if (!raw) {
		return null;
	}
	try {
		const candidate = JSON.parse(raw) as unknown;
		if (!candidate || typeof candidate !== 'object') {
			return null;
		}
		const suffixValue = (candidate as { suffix?: unknown }).suffix;
		if (typeof suffixValue !== 'string' || !suffixValue) {
			return null;
		}
		return {
			suffix: normalizeSuffix(suffixValue),
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
	} catch {
		return null;
	}
}

function buildConfig(
	identity: PortalDeviceIdentity,
	candidate: unknown,
): PortalEmulatorConfig {
	const baseSuffix = normalizeSuffix(identity.suffix);
	const result: PortalEmulatorConfig = {
		device: { suffix: baseSuffix },
		settings: {
			faceTrackingEnabled: DEFAULT_SETTINGS.faceTrackingEnabled,
			stereoRenderingEnabled: DEFAULT_SETTINGS.stereoRenderingEnabled,
		},
		version: DEFAULT_VERSION,
	};

	if (!candidate || typeof candidate !== 'object') {
		return result;
	}

	const deviceCandidate = (candidate as { device?: unknown }).device;
	if (deviceCandidate && typeof deviceCandidate === 'object') {
		const suffixCandidate = (deviceCandidate as { suffix?: unknown }).suffix;
		if (typeof suffixCandidate === 'string' && suffixCandidate.trim()) {
			result.device.suffix = normalizeSuffix(suffixCandidate);
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

function normalizeSuffix(raw: string): string {
	const trimmed = raw.trim().toUpperCase();
	return trimmed;
}
