/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRDevice, metaQuest3 } from 'portalvr';

import { DevUI } from '@portalvr/devui';
import { getPortalPoseWasmDataURL } from 'portalvr/wasm/portal-pose/portal_pose_embed.js';

export const injectRuntime = () => {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	window.CustomWebXRPolyfill = true;
	const xrDevice = new XRDevice(metaQuest3);
	xrDevice.installRuntime();
	xrDevice.installDevUI(DevUI);
	// TODO: re-enable SEM when three.js dependency is acceptable again.

	xrDevice.enablePortalPoseCamera({ wasmDataUrl: getPortalPoseWasmDataURL() });
};

// Re-export PortalVR public API for consumers (DevUI, extension bootstrap)
export * from 'portalvr';
