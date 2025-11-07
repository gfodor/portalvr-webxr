/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
	bootstrapStandaloneEmulator,
	ensureStandaloneSurfaceInitialized,
	XRDevice,
	getPortalEmulatorConfig,
} from 'portalvr';

const RUNTIME_INSTALL_FLAG = '__iweRuntimeInstalled__';
const RUNTIME_INSTALL_PROMISE_KEY = '__iweRuntimeInstallPromise__';
const CONFIG_READY_RESOLVED_KEY = '__iweConfigReadyResolved__';
const CONFIG_READY_PROMISE_KEY = '__iweConfigReadyPromise__';
const CONFIG_READY_RESOLVER_KEY = '__iweConfigReadyResolver__';

export const injectRuntime = () => {
	ensureStandaloneSurfaceInitialized(true);
	const existingPromise = getInstallPromise();
	if (existingPromise) {
		return existingPromise;
	}
	const promise = waitForConfigReady()
		.catch(() => undefined)
		.then(() =>
			bootstrapStandaloneEmulator({
				skipNativeImmersiveCheck: true,
				forceReinstall: true,
				enforceRuntime: true,
				forcePolyfill: true,
			}),
		)
		.then((device) => {
			markRuntimeInstalled();
			return device;
		});
	storeInstallPromise(promise);
	promise.catch((error) => {
		clearRuntimeInstallMarkers();
		console.error('[PortalVR PORTAL] Failed to install emulator', error);
		throw error;
	});
	return promise;
};

// Re-export PortalVR public API for consumers (DevUI, extension bootstrap)
export * from 'portalvr';

function markRuntimeInstalled(): void {
	if (typeof window === 'undefined') {
		return;
	}
	const target = window as typeof window & Record<string, unknown>;
	try {
		target[RUNTIME_INSTALL_FLAG] = true;
	} catch {
		// ignore assignment failures in locked down globals
	}
}

type RuntimeInstallPromise = Promise<XRDevice | null> | null;

function getInstallPromise(): RuntimeInstallPromise {
	if (typeof window === 'undefined') {
		return null;
	}
	const target = window as typeof window & Record<string, unknown>;
	const existing = target[RUNTIME_INSTALL_PROMISE_KEY];
	return (existing as RuntimeInstallPromise) ?? null;
}

function storeInstallPromise(promise: Exclude<RuntimeInstallPromise, null>): void {
	if (typeof window === 'undefined') {
		return;
	}
	const target = window as typeof window & Record<string, unknown>;
	try {
		target[RUNTIME_INSTALL_PROMISE_KEY] = promise;
	} catch {
		// ignore when globals locked down
	}
}

function clearRuntimeInstallMarkers(): void {
	if (typeof window === 'undefined') {
		return;
	}
	const target = window as typeof window & Record<string, unknown>;
	try {
		Reflect.deleteProperty(target, RUNTIME_INSTALL_PROMISE_KEY);
		Reflect.deleteProperty(target, RUNTIME_INSTALL_FLAG);
	} catch {
		// ignore cleanup failures
	}
}

function waitForConfigReady(): Promise<void> {
	if (typeof window === 'undefined') {
		return Promise.resolve();
	}
	const target = window as typeof window & Record<string, unknown>;
	if (target[CONFIG_READY_RESOLVED_KEY]) {
		return Promise.resolve();
	}
	const existing = target[CONFIG_READY_PROMISE_KEY];
	if (existing) {
		return existing as Promise<void>;
	}
	let resolveFn: (() => void) | null = null;
	const readyPromise = new Promise<void>((resolve) => {
		resolveFn = resolve;
	});
	const timeoutPromise = new Promise<void>((resolve) => {
		setTimeout(resolve, 2000);
	});
	target[CONFIG_READY_PROMISE_KEY] = Promise.race([readyPromise, timeoutPromise]).then(() => {
		if (!target[CONFIG_READY_RESOLVED_KEY]) {
			const fallbackSuffix = getPortalEmulatorConfig().device?.suffix ?? '';
			if (!fallbackSuffix) {
				console.warn('[PortalVR] Config override still pending after timeout; proceeding with fallback.');
			}
			target[CONFIG_READY_RESOLVED_KEY] = true;
		}
		target[CONFIG_READY_RESOLVER_KEY] = undefined;
	});
	target[CONFIG_READY_RESOLVER_KEY] = () => {
		if (!target[CONFIG_READY_RESOLVED_KEY]) {
			target[CONFIG_READY_RESOLVED_KEY] = true;
		}
		if (resolveFn) {
			resolveFn();
			resolveFn = null;
		}
	};
	return target[CONFIG_READY_PROMISE_KEY] as Promise<void>;
}
