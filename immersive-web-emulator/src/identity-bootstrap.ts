import {
	PORTAL_CONFIG_OVERRIDE_GLOBAL,
	type PortalEmulatorConfig,
} from 'portalvr';

(() => {
	const script = document.currentScript as HTMLScriptElement | null;
	if (!script) {
		return;
	}

	const rawConfig = script.dataset.config ?? null;
	if (!rawConfig) {
		script.remove();
		return;
	}

	let configCandidate: PortalEmulatorConfig | null = null;
	try {
		configCandidate = JSON.parse(rawConfig) as PortalEmulatorConfig;
	} catch {
		configCandidate = null;
	}

	if (!configCandidate) {
		script.remove();
		return;
	}

	const target = window as typeof window & Record<string, unknown>;
	try {
		target[PORTAL_CONFIG_OVERRIDE_GLOBAL] = configCandidate;
	} catch {
		// ignore assignment failure
	}

	script.remove();
})();
