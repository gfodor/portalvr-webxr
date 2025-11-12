import type { PortalEmulatorConfig } from 'portalvr';

const MESSAGE_TYPE_SET_CONFIG = 'portalvr:set-config';
const MESSAGE_TYPE_ENSURE_RUNTIME = 'portalvr:ensure-runtime';

const WS_OPEN  = 'portalvr:ws-open';
const WS_SEND  = 'portalvr:ws-send';
const WS_CLOSE = 'portalvr:ws-close';
const WS_EVENT = 'portalvr:ws-event';

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

function bridgePageSignaling(): void {
	if (!chrome.runtime?.id) return;

	window.addEventListener(WS_OPEN, (event: Event) => {
		const { id, url } = (event as CustomEvent<{ id: string; url: string }>).detail || {};
		if (!id || !url) return;
		try {
			chrome.runtime.sendMessage({ type: WS_OPEN, id, url }, () => { void chrome.runtime?.lastError; });
		} catch { /* ignore */ }
	});

	window.addEventListener(WS_SEND, (event: Event) => {
		const { id, data } = (event as CustomEvent<{ id: string; data: string }>).detail || {};
		if (!id || typeof data !== 'string') return;
		try {
			chrome.runtime.sendMessage({ type: WS_SEND, id, data }, () => { void chrome.runtime?.lastError; });
		} catch { /* ignore */ }
	});

	window.addEventListener(WS_CLOSE, (event: Event) => {
		const { id, code, reason } = (event as CustomEvent<{ id: string; code?: number; reason?: string }>).detail || {};
		if (!id) return;
		try {
			chrome.runtime.sendMessage({ type: WS_CLOSE, id, code, reason }, () => { void chrome.runtime?.lastError; });
		} catch { /* ignore */ }
	});

	try {
		chrome.runtime.onMessage.addListener((message: any, _sender: any, _sendResponse: (resp?: any) => void) => {
			if (!message || typeof message !== 'object') return;
			if (message.type !== WS_EVENT) return;
			try {
				window.dispatchEvent(new CustomEvent(WS_EVENT, {
					detail: {
						id: message.id,
						event: message.event,
						data: message.data,
						code: message.code,
						reason: message.reason,
						error: message.error,
					},
				}));
			} catch { /* ignore */ }
			// no async response
		});
	} catch {
		// ignore listener errors
	}
}

bridgePageConfigUpdates();
bridgePageSignaling();
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
