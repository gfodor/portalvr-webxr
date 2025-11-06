/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { bootstrapStandaloneEmulator } from 'portalvr';

export const injectRuntime = () => {
	const promise = bootstrapStandaloneEmulator({
		skipNativeImmersiveCheck: true,
		forceReinstall: true,
		enforceRuntime: true,
		forcePolyfill: true,
	});
	promise.catch((error) => {
		console.error('[PortalVR IWE] Failed to install emulator', error);
	});
	return promise;
};

// Re-export PortalVR public API for consumers (DevUI, extension bootstrap)
export * from 'portalvr';
