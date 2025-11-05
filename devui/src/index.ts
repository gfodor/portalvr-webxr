/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRDevice } from 'portalvr';

import { VERSION } from './version.js';

const PLACEHOLDER_SIZE = {
	width: '160px',
	height: '90px',
};

export class DevUI {
	public readonly version = VERSION;
	public readonly devUICanvas: HTMLCanvasElement;
	public readonly devUIContainer: HTMLDivElement;

	constructor(xrDevice: XRDevice) {

		this.devUICanvas = document.createElement('canvas');
		this.devUICanvas.width = 0;
		this.devUICanvas.height = 0;
		this.devUICanvas.style.position = 'absolute';
		this.devUICanvas.style.inset = '0';
		this.devUICanvas.style.pointerEvents = 'none';
		this.devUICanvas.style.opacity = '0';

		this.devUIContainer = document.createElement('div');
		this.devUIContainer.style.position = 'fixed';
		this.devUIContainer.style.inset = '0';
		this.devUIContainer.style.pointerEvents = 'none';
		this.devUIContainer.style.fontFamily = 'system-ui, sans-serif';
		this.devUIContainer.style.color = '#000';

		const placeholder = document.createElement('div');
		placeholder.style.position = 'absolute';
		placeholder.style.bottom = '16px';
		placeholder.style.left = '16px';
		placeholder.style.width = PLACEHOLDER_SIZE.width;
		placeholder.style.height = PLACEHOLDER_SIZE.height;
		placeholder.style.background = '#ffffff';
		placeholder.style.borderRadius = '6px';
		placeholder.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
		placeholder.style.display = 'flex';
		placeholder.style.alignItems = 'center';
		placeholder.style.justifyContent = 'center';
		placeholder.style.fontSize = '14px';
		placeholder.style.fontWeight = '600';
		placeholder.style.pointerEvents = 'none';

		const settingsButton = document.createElement('button');
		settingsButton.type = 'button';
		settingsButton.textContent = 'Settings';
		settingsButton.style.position = 'absolute';
		settingsButton.style.top = '16px';
		settingsButton.style.right = '16px';
		settingsButton.style.padding = '8px 14px';
		settingsButton.style.borderRadius = '20px';
		settingsButton.style.border = '1px solid rgba(0, 0, 0, 0.15)';
		settingsButton.style.background = '#ffffff';
		settingsButton.style.cursor = 'pointer';
		settingsButton.style.pointerEvents = 'auto';
		settingsButton.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';

		settingsButton.addEventListener('click', () => {
			console.debug('[DevUI] Settings button pressed (no-op).');
		});

		this.devUIContainer.appendChild(placeholder);
		this.devUIContainer.appendChild(settingsButton);

		const label =
			xrDevice.name !== undefined && xrDevice.name !== null
				? `${xrDevice.name} PortalVR Dev UI`
				: 'PortalVR Dev UI Placeholder';
		placeholder.textContent = label;
	}

	render(_time: number) {}
}
