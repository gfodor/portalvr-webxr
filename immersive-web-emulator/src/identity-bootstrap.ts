import {
	PORTAL_DEVICE_IDENTITY_OVERRIDE_GLOBAL,
	PORTAL_DEVICE_STORAGE_KEY,
} from 'portalvr';

type PortalDeviceIdentity = {
	suffix: string;
	fullName?: string;
	uiCode?: string;
};

(() => {
	const script = document.currentScript as HTMLScriptElement | null;
	if (!script) {
		return;
	}

	const rawIdentity = script.dataset.identity ?? null;
	if (!rawIdentity) {
		script.remove();
		return;
	}

	let identity: PortalDeviceIdentity | null = null;
	try {
		identity = JSON.parse(rawIdentity) as PortalDeviceIdentity;
	} catch {
		script.remove();
		return;
	}

	if (!identity || typeof identity.suffix !== 'string') {
		script.remove();
		return;
	}

	const target = window as typeof window & Record<string, unknown>;

	try {
		target[PORTAL_DEVICE_IDENTITY_OVERRIDE_GLOBAL] = identity;
	} catch {
		// Ignore assignment failures (e.g., readonly globals).
	}

	try {
		if (target.localStorage) {
			target.localStorage.setItem(PORTAL_DEVICE_STORAGE_KEY, identity.suffix);
		}
	} catch {
		// Swallow storage exceptions (e.g., quota exceeded, storage disabled).
	}

	script.remove();
})();
