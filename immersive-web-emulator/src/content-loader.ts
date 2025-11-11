import type { PortalEmulatorConfig } from 'portalvr';
import {
	MESSAGE_TYPE_ENSURE_RUNTIME,
	MESSAGE_TYPE_SET_CONFIG,
} from 'portalvr/context/constants.js';

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
ensureRuntimeInstalled();

function ensureRuntimeInstalled(): void {
	if (!chrome.runtime?.id) {
		return;
	}
	try {
		chrome.runtime.sendMessage(
			{ type: MESSAGE_TYPE_ENSURE_RUNTIME },
			() => {
				void chrome.runtime?.lastError;
			},
		);
	} catch {
		// ignore send failures
	}
}
