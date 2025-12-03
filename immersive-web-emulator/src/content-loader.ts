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
ensureIframeUsbPermissions();

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

/**
 * Ensures that iframes with xr-spatial-tracking permission also get usb permission.
 * This allows WebXR content in iframes to access USB devices when the extension is installed.
 * Only runs in the top-level frame.
 */
function ensureIframeUsbPermissions(): void {
	// Only run in the top-level frame
	if (window !== window.top) {
		console.log('[IFRAME] Skipping - not top-level frame');
		return;
	}

	console.log('[IFRAME] ensureIframeUsbPermissions starting in top-level frame');

	const XR_PERMISSION = 'xr-spatial-tracking';
	const USB_PERMISSION = 'usb';

	// Track iframes we've already processed to avoid infinite reload loops
	const processedIframes = new WeakSet<HTMLIFrameElement>();

	/**
	 * Adds usb permission to an iframe's allow attribute if it has xr-spatial-tracking.
	 * If the iframe already has a src and has started loading, we need to reload it
	 * for the new permissions to take effect.
	 */
	function addUsbPermissionToIframe(iframe: HTMLIFrameElement): void {
		// Skip if we've already processed this iframe
		if (processedIframes.has(iframe)) {
			return;
		}

		const allowAttr = iframe.getAttribute('allow');
		const src = iframe.getAttribute('src') || iframe.src || '';
		console.log('[IFRAME] Checking iframe:', src || '(no src)', 'allow=', allowAttr);

		if (!allowAttr) {
			console.log('[IFRAME] Skipping - no allow attribute');
			return;
		}

		// Check if iframe has xr-spatial-tracking permission
		if (!allowAttr.includes(XR_PERMISSION)) {
			console.log('[IFRAME] Skipping - no xr-spatial-tracking permission');
			return;
		}

		// Check if usb permission is already present
		if (allowAttr.includes(USB_PERMISSION)) {
			console.log('[IFRAME] Skipping - usb permission already present');
			return;
		}

		// Mark as processed before modifying to prevent re-processing on reload
		processedIframes.add(iframe);

		// Add usb permission to the allow attribute
		const newAllowAttr = allowAttr + '; ' + USB_PERMISSION;
		iframe.setAttribute('allow', newAllowAttr);
		console.log('[IFRAME] Added usb permission. New allow=', newAllowAttr);

		// If the iframe already has a src, we need to reload it for permissions to take effect.
		// The permission policy is evaluated when navigation begins, so modifying the allow
		// attribute after the iframe has started loading won't help unless we reload.
		if (src) {
			console.log('[IFRAME] Reloading iframe to apply new permissions:', src);
			// Use a microtask to ensure the attribute change is committed first
			queueMicrotask(() => {
				// Force reload by reassigning src
				// Setting to empty then back causes a proper reload
				const currentSrc = iframe.src;
				iframe.src = '';
				iframe.src = currentSrc;
				console.log('[IFRAME] Iframe reload triggered');
			});
		}
	}

	/**
	 * Process all iframes in the document
	 */
	function processAllIframes(): void {
		const iframes = document.querySelectorAll('iframe');
		console.log('[IFRAME] processAllIframes found', iframes.length, 'iframes');
		iframes.forEach((iframe) => {
			addUsbPermissionToIframe(iframe as HTMLIFrameElement);
		});
	}

	/**
	 * Set up MutationObserver to watch for new iframes and attribute changes
	 */
	function setupObserver(): void {
		console.log('[IFRAME] Setting up MutationObserver');
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				// Handle new nodes being added
				if (mutation.type === 'childList') {
					mutation.addedNodes.forEach((node) => {
						if (node instanceof HTMLIFrameElement) {
							console.log('[IFRAME] MutationObserver: new iframe added');
							addUsbPermissionToIframe(node);
						} else if (node instanceof Element) {
							// Check for iframes inside added elements
							const nestedIframes = node.querySelectorAll('iframe');
							if (nestedIframes.length > 0) {
								console.log('[IFRAME] MutationObserver: found', nestedIframes.length, 'nested iframes in added element');
							}
							nestedIframes.forEach((iframe) => {
								addUsbPermissionToIframe(iframe as HTMLIFrameElement);
							});
						}
					});
				}
				// Handle attribute changes on existing iframes
				else if (mutation.type === 'attributes' && mutation.attributeName === 'allow') {
					if (mutation.target instanceof HTMLIFrameElement) {
						console.log('[IFRAME] MutationObserver: allow attribute changed on iframe');
						addUsbPermissionToIframe(mutation.target);
					}
				}
			}
		});

		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['allow'],
		});
		console.log('[IFRAME] MutationObserver active');
	}

	// Process existing iframes when DOM is ready
	console.log('[IFRAME] document.readyState =', document.readyState);
	if (document.readyState === 'loading') {
		console.log('[IFRAME] Waiting for DOMContentLoaded to process iframes');
		document.addEventListener('DOMContentLoaded', () => {
			console.log('[IFRAME] DOMContentLoaded fired, processing iframes');
			processAllIframes();
		});
	} else {
		console.log('[IFRAME] DOM already ready, processing iframes now');
		processAllIframes();
	}

	// Set up observer to catch dynamically added iframes
	// Need to wait for document.documentElement to exist
	if (document.documentElement) {
		setupObserver();
	} else {
		console.log('[IFRAME] Waiting for DOMContentLoaded to setup observer');
		document.addEventListener('DOMContentLoaded', () => {
			setupObserver();
		});
	}
}
