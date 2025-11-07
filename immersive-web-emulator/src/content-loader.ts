import type { PortalEmulatorConfig } from 'portalvr';

const MESSAGE_TYPE_SET_CONFIG = 'portalvr:set-config';
const MESSAGE_TYPE_ENSURE_RUNTIME = 'portalvr:ensure-runtime';
const MESSAGE_TYPE_GET_CONFIG = 'portalvr:get-config';

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
ensureConfigLoaded();

function ensureConfigLoaded(): void {
	if (!chrome.runtime?.id) {
		return;
	}
	try {
		chrome.runtime.sendMessage(
			{ type: MESSAGE_TYPE_GET_CONFIG },
			(response?: { ok?: boolean; config?: PortalEmulatorConfig }) => {
				if (chrome.runtime.lastError) {
					return;
				}
				if (!response?.ok || !response.config) {
					return;
				}
				injectConfigBridge(response.config);
			},
		);
	} catch {
		// ignore failures
	}
}

let configInjected = false;

function injectConfigBridge(config: PortalEmulatorConfig): void {
	if (configInjected) {
		return;
	}
	const root = document.documentElement || document.head || document.body;
	if (!root) {
		return;
	}
	const script = document.createElement('script');
	script.type = 'text/javascript';
	script.async = false;
	script.dataset.config = JSON.stringify(config);
	script.src = chrome.runtime.getURL('build/identity-bootstrap.js');
	script.addEventListener(
		'load',
		() => {
			configInjected = true;
		},
		{ once: true },
	);
	root.appendChild(script);
}

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
