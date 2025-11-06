/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRDevice } from 'portalvr';
import { getPortalEmulatorConfig, updatePortalEmulatorConfig } from 'portalvr';

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

		const modalBackdrop = document.createElement('div');
		modalBackdrop.style.position = 'fixed';
		modalBackdrop.style.inset = '0';
		modalBackdrop.style.background = 'rgba(0,0,0,0.4)';
		modalBackdrop.style.display = 'none';
		modalBackdrop.style.alignItems = 'center';
		modalBackdrop.style.justifyContent = 'center';
		modalBackdrop.style.pointerEvents = 'auto';
		modalBackdrop.style.zIndex = '99999';

		const modal = document.createElement('div');
		modal.style.background = '#fff';
		modal.style.borderRadius = '10px';
		modal.style.padding = '16px';
		modal.style.minWidth = '280px';
		modal.style.maxWidth = '360px';
		modal.style.boxShadow = '0 10px 24px rgba(0,0,0,0.2)';
		modal.style.fontSize = '14px';
		modal.style.color = '#111';

		const header = document.createElement('div');
		header.textContent = 'PortalVR Settings';
		header.style.fontWeight = '700';
		header.style.marginBottom = '10px';

		const mkRow = (labelText: string, input: HTMLInputElement) => {
			const row = document.createElement('label');
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '10px';
			row.style.margin = '8px 0';
			row.style.cursor = 'pointer';
			input.type = 'checkbox';
			row.appendChild(input);
			const span = document.createElement('span');
			span.textContent = labelText;
			row.appendChild(span);
			return row;
		};

		const faceInput = document.createElement('input');
		const stereoInput = document.createElement('input');
		const fullscreenInput = document.createElement('input');

		const closeBtn = document.createElement('button');
		closeBtn.textContent = 'Close';
		closeBtn.type = 'button';
		closeBtn.style.marginTop = '12px';
		closeBtn.style.padding = '6px 10px';
		closeBtn.style.border = '1px solid rgba(0,0,0,0.2)';
		closeBtn.style.borderRadius = '8px';
		closeBtn.style.background = '#fff';
		closeBtn.style.cursor = 'pointer';

		modal.appendChild(header);
		modal.appendChild(mkRow('Enable face tracking', faceInput));
		modal.appendChild(mkRow('Enable stereo rendering (requires reload)', stereoInput));
		modal.appendChild(mkRow('Auto fullscreen immersive sessions', fullscreenInput));
		modal.appendChild(closeBtn);
		modalBackdrop.appendChild(modal);

		const applyInitial = () => {
			const cfg = getPortalEmulatorConfig();
			faceInput.checked = cfg.settings?.faceTrackingEnabled !== false;
			stereoInput.checked = Boolean(cfg.settings?.stereoRenderingEnabled);
			fullscreenInput.checked = cfg.settings?.immersiveFullscreenEnabled !== false;
		};

		applyInitial();

		settingsButton.addEventListener('click', () => {
			applyInitial();
			modalBackdrop.style.display = 'flex';
		});
		modalBackdrop.addEventListener('click', (e) => {
			if (e.target === modalBackdrop) {
				modalBackdrop.style.display = 'none';
			}
		});
		closeBtn.addEventListener('click', () => {
			modalBackdrop.style.display = 'none';
		});

		faceInput.addEventListener('change', () => {
			const enabled = Boolean(faceInput.checked);
			updatePortalEmulatorConfig({ settings: { faceTrackingEnabled: enabled } });
			try {
				xrDevice.faceTrackingEnabled = enabled;
			} catch {
				// ignore if not available
			}
		});

		stereoInput.addEventListener('change', () => {
			const enabled = Boolean(stereoInput.checked);
			updatePortalEmulatorConfig({ settings: { stereoRenderingEnabled: enabled } });
			console.info('[DevUI] Stereo rendering preference saved. Reload the page to apply.');
		});

		fullscreenInput.addEventListener('change', () => {
			const enabled = Boolean(fullscreenInput.checked);
			updatePortalEmulatorConfig({ settings: { immersiveFullscreenEnabled: enabled } });
			try {
				xrDevice.immersiveFullscreenEnabled = enabled;
			} catch {
				// ignore if not available
			}
		});

		this.devUIContainer.appendChild(placeholder);
		this.devUIContainer.appendChild(settingsButton);
		this.devUIContainer.appendChild(modalBackdrop);

		const label =
			xrDevice.name !== undefined && xrDevice.name !== null
				? `${xrDevice.name} PortalVR Dev UI`
				: 'PortalVR Dev UI Placeholder';
		placeholder.textContent = label;
	}

	render(_time: number) {}
}
