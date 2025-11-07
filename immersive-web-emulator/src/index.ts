/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { bootstrapStandaloneEmulator, XRDevice } from 'portalvr';

const RUNTIME_INSTALL_FLAG = '__iweRuntimeInstalled__';
const RUNTIME_INSTALL_PROMISE_KEY = '__iweRuntimeInstallPromise__';

export const injectRuntime = () => {
	const existingPromise = getInstallPromise();
	if (existingPromise) {
		return existingPromise;
	}
	const promise = bootstrapStandaloneEmulator({
		skipNativeImmersiveCheck: true,
		forceReinstall: true,
		enforceRuntime: true,
		forcePolyfill: true,
	}).then((device) => {
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
