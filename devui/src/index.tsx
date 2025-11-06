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

export class DevUI {
	public readonly version = VERSION;
	public readonly devUICanvas: HTMLCanvasElement;
	public readonly devUIContainer: HTMLDivElement;
	private readonly reactRoot: Root;
	private readonly xrDevice: XRDevice;
	private controllerConnected = false;

	constructor(xrDevice: XRDevice) {
		this.xrDevice = xrDevice;

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
		this.devUIContainer.style.zIndex = '10000';

		queueMicrotask(() => {
			this.devUIContainer.style.zIndex = '10000';
		});

		const reactHost = document.createElement('div');
		reactHost.style.position = 'fixed';
		reactHost.style.inset = '0';
		reactHost.style.pointerEvents = 'none';
		reactHost.style.zIndex = '1';
		reactHost.dataset.portalvrDevui = 'root';

		this.devUIContainer.appendChild(reactHost);

		this.reactRoot = createRoot(reactHost);
		this.renderReact();
	}

	public setControllerConnected(connected: boolean): void {
		if (this.controllerConnected === connected) {
			return;
		}
		this.controllerConnected = connected;
		this.renderReact();
	}

	private renderReact(): void {
		this.reactRoot.render(
			<DevUIRoot
				xrDevice={this.xrDevice}
				controllerConnected={this.controllerConnected}
			/>,
		);
	}

	render(_time: number) {}
}
