/**
 * Pointer Lock Guard - Hijacks pointer lock APIs to prevent site interference
 *
 * This script runs at document_start before any site scripts, capturing the original
 * pointer lock APIs and replacing them with guarded versions that block site usage.
 * The original APIs are exposed via a secret global so the PortalVR extension can
 * still use pointer lock functionality.
 */

export {};

// Secret key for accessing original APIs - only known to our extension
const PORTAL_POINTER_LOCK_KEY = '__PORTALVR_POINTER_LOCK_ORIGINALS__';

interface PointerLockOriginals {
	requestPointerLock: typeof Element.prototype.requestPointerLock;
	exitPointerLock: typeof Document.prototype.exitPointerLock;
	// Vendor-prefixed versions (legacy)
	mozRequestPointerLock?: (this: Element) => void;
	webkitRequestPointerLock?: (this: Element) => void;
	msRequestPointerLock?: (this: Element) => void;
	mozExitPointerLock?: (this: Document) => void;
	webkitExitPointerLock?: (this: Document) => void;
	msExitPointerLock?: (this: Document) => void;
}

(function pointerLockGuard() {
	// Only run in browser environment
	if (typeof window === 'undefined' || typeof Element === 'undefined') {
		return;
	}

	// Prevent double-initialization
	const globalTarget = window as typeof window & Record<string, unknown>;
	if (globalTarget[PORTAL_POINTER_LOCK_KEY]) {
		return;
	}

	// Capture original APIs before any site scripts can modify them
	const origRequestPointerLock = Element.prototype.requestPointerLock;
	const origExitPointerLock = Document.prototype.exitPointerLock;

	// Capture vendor-prefixed versions if they exist
	const elementProto = Element.prototype as Element & {
		mozRequestPointerLock?: () => void;
		webkitRequestPointerLock?: () => void;
		msRequestPointerLock?: () => void;
	};
	const docProto = Document.prototype as Document & {
		mozExitPointerLock?: () => void;
		webkitExitPointerLock?: () => void;
		msExitPointerLock?: () => void;
	};

	const origMozRequestPointerLock = elementProto.mozRequestPointerLock;
	const origWebkitRequestPointerLock = elementProto.webkitRequestPointerLock;
	const origMsRequestPointerLock = elementProto.msRequestPointerLock;
	const origMozExitPointerLock = docProto.mozExitPointerLock;
	const origWebkitExitPointerLock = docProto.webkitExitPointerLock;
	const origMsExitPointerLock = docProto.msExitPointerLock;

	// Store originals in a frozen object that sites can't tamper with
	const originals: PointerLockOriginals = Object.freeze({
		requestPointerLock: origRequestPointerLock,
		exitPointerLock: origExitPointerLock,
		mozRequestPointerLock: origMozRequestPointerLock,
		webkitRequestPointerLock: origWebkitRequestPointerLock,
		msRequestPointerLock: origMsRequestPointerLock,
		mozExitPointerLock: origMozExitPointerLock,
		webkitExitPointerLock: origWebkitExitPointerLock,
		msExitPointerLock: origMsExitPointerLock,
	});

	// Expose originals via secret global for our extension to use
	try {
		Object.defineProperty(globalTarget, PORTAL_POINTER_LOCK_KEY, {
			value: originals,
			writable: false,
			configurable: false,
			enumerable: false,
		});
	} catch {
		// Fallback if defineProperty fails
		globalTarget[PORTAL_POINTER_LOCK_KEY] = originals;
	}

	// Replace requestPointerLock with a no-op that logs suppression
	if (typeof origRequestPointerLock === 'function') {
		Element.prototype.requestPointerLock = function (
			this: Element,
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			_options?: object,
		): void {
			console.debug('[PortalVR] Pointer lock request suppressed on', this);
			// No-op - sites can't acquire pointer lock
		};
	}

	// Replace exitPointerLock with a no-op
	if (typeof origExitPointerLock === 'function') {
		Document.prototype.exitPointerLock = function (this: Document): void {
			console.debug('[PortalVR] Pointer lock exit suppressed');
			// No-op - don't actually exit
		};
	}

	// Replace vendor-prefixed versions
	if (origMozRequestPointerLock) {
		elementProto.mozRequestPointerLock = function (this: Element): void {
			console.debug('[PortalVR] mozRequestPointerLock suppressed on', this);
		};
	}

	if (origWebkitRequestPointerLock) {
		elementProto.webkitRequestPointerLock = function (this: Element): void {
			console.debug('[PortalVR] webkitRequestPointerLock suppressed on', this);
		};
	}

	if (origMsRequestPointerLock) {
		elementProto.msRequestPointerLock = function (this: Element): void {
			console.debug('[PortalVR] msRequestPointerLock suppressed on', this);
		};
	}

	if (origMozExitPointerLock) {
		docProto.mozExitPointerLock = function (this: Document): void {
			console.debug('[PortalVR] mozExitPointerLock suppressed');
		};
	}

	if (origWebkitExitPointerLock) {
		docProto.webkitExitPointerLock = function (this: Document): void {
			console.debug('[PortalVR] webkitExitPointerLock suppressed');
		};
	}

	if (origMsExitPointerLock) {
		docProto.msExitPointerLock = function (this: Document): void {
			console.debug('[PortalVR] msExitPointerLock suppressed');
		};
	}

	console.debug('[PortalVR] Pointer lock APIs hijacked - sites will be blocked from using pointer lock');
})();
