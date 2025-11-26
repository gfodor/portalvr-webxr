/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRDevice } from 'portalvr';
import { createRoot, type Root } from 'react-dom/client';

import { VERSION } from './version.js';
import { DevUIRoot } from './components/DevUIRoot.js';

type SwipeVariant = 'base' | 'recenter' | 'trackpad' | 'quest-stick';
type ControllerPromptStatus = 'qr' | 'tracking-issues' | 'focus-lost' | 'swipe' | 'hidden';

const INTERACTION_MODE_DUAL_AXIS_GAMEPAD = 0x1;
const INTERACTION_MODE_DUALSHOCK_GAMEPAD = 0x2;
const INTERACTION_MODE_OPENXR_QUEST = 0x10;

export class DevUI {
	public readonly version = VERSION;
	private devUICanvasElement: HTMLCanvasElement | null = null;
	private devUIContainerElement: HTMLDivElement | null = null;
	private reactRoot: Root | null = null;
	private readonly xrDevice: XRDevice;
	private controllerConnected = false;
	private controllerPrompt: ControllerPromptStatus = 'qr';
	private swipeVariant: SwipeVariant = 'base';

	constructor(xrDevice: XRDevice) {
		this.xrDevice = xrDevice;
	}

	public get devUICanvas(): HTMLCanvasElement {
		this.ensureMounted();
		if (!this.devUICanvasElement) {
			throw new Error('PortalVR DevUI canvas unavailable; DOM not ready.');
		}
		return this.devUICanvasElement;
	}

	public get devUIContainer(): HTMLDivElement {
		this.ensureMounted();
		if (!this.devUIContainerElement) {
			throw new Error('PortalVR DevUI container unavailable; DOM not ready.');
		}
		return this.devUIContainerElement;
	}

	public setControllerConnected(connected: boolean): void {
		if (this.controllerConnected === connected) {
			// still re-render if prompt differs (new API may have set it differently)
		}
		this.controllerConnected = connected;
		// If only connectivity is known, show QR when not connected, hide otherwise.
		this.controllerPrompt = connected ? 'hidden' : 'qr';
		this.renderReact();
	}

	private inferSwipeVariant(): SwipeVariant {
		// use optional chaining across package boundaries for safety
		const imode: number = (this.xrDevice as any)?.getLastControllerInteractionMode?.() ?? 0;
		if (imode === INTERACTION_MODE_DUAL_AXIS_GAMEPAD) return 'recenter';
		if (imode === INTERACTION_MODE_DUALSHOCK_GAMEPAD) return 'trackpad';
		if (imode === INTERACTION_MODE_OPENXR_QUEST) return 'quest-stick';
		return 'base';
	}

	public setControllerPromptStatus(
		status: ControllerPromptStatus,
		swipeVariant?: SwipeVariant,
	): void {
		if (this.controllerPrompt === status && (status !== 'swipe' || (swipeVariant == null || swipeVariant === this.swipeVariant))) {
			return;
		}
		this.controllerPrompt = status;

		if (status === 'swipe') {
			this.swipeVariant = swipeVariant ?? this.inferSwipeVariant();
		}

		// keep controllerConnected heuristically in sync for any legacy checks
		this.controllerConnected =
			status !== 'qr' && status !== 'hidden'
				? true
				: this.controllerConnected;

		this.renderReact();
	}

	private ensureMounted(): void {
		if (this.reactRoot) {
			return;
		}
		if (typeof document === 'undefined') {
			return;
		}

		const devUICanvas = document.createElement('canvas');
		devUICanvas.width = 0;
		devUICanvas.height = 0;
		devUICanvas.style.position = 'absolute';
		devUICanvas.style.inset = '0';
		devUICanvas.style.pointerEvents = 'none';
		devUICanvas.style.opacity = '0';
		this.devUICanvasElement = devUICanvas;

		const devUIContainer = document.createElement('div');
		devUIContainer.style.position = 'fixed';
		devUIContainer.style.inset = '0';
		devUIContainer.style.pointerEvents = 'none';
		devUIContainer.style.fontFamily = 'system-ui, sans-serif';
		devUIContainer.style.color = '#000';
		devUIContainer.style.zIndex = '10000';
		this.devUIContainerElement = devUIContainer;

		if (typeof queueMicrotask === 'function') {
			queueMicrotask(() => {
				if (this.devUIContainerElement) {
					this.devUIContainerElement.style.zIndex = '10000';
				}
			});
		} else {
			this.devUIContainerElement.style.zIndex = '10000';
		}

		const resetWrapper = document.createElement('div');
		resetWrapper.dataset.portalvrDevui = 'reset-boundary';
		resetWrapper.className = 'portal-reset-boundary';
		resetWrapper.style.position = 'fixed';
		resetWrapper.style.inset = '0';
		resetWrapper.style.pointerEvents = 'none';
		resetWrapper.style.zIndex = '1';

		const reactHost = document.createElement('div');
		reactHost.style.position = 'absolute';
		reactHost.style.inset = '0';
		reactHost.style.pointerEvents = 'none';
		reactHost.style.zIndex = '1';
		reactHost.dataset.portalvrDevui = 'root';

		resetWrapper.appendChild(reactHost);
		devUIContainer.appendChild(resetWrapper);

		this.reactRoot = createRoot(reactHost);
		this.renderReact();
	}

	private renderReact(): void {
		if (!this.reactRoot) {
			return;
		}
		this.reactRoot.render(
			<DevUIRoot
				xrDevice={this.xrDevice}
				controllerPrompt={this.controllerPrompt}
				swipeVariant={this.swipeVariant}
			/>,
		);
	}

	render(_time: number) {}
}
