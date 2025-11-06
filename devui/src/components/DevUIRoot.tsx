import {
	ChangeEvent,
	MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { XRDevice } from 'portalvr';
import {
	getPortalEmulatorConfig,
	updatePortalEmulatorConfig,
} from 'portalvr';

import { ensurePortalStyles } from '../styles/injectPortalStyles.js';
import { PortalQrPrompt } from './PortalQrPrompt.js';
import {
	ASSET_ICON_HELP,
	ASSET_ICON_SETTINGS,
	ASSET_MODE_2D,
	ASSET_MODE_3D,
	ASSET_WATERMARK,
} from '../generated/assets.js';

type DevUIRootProps = {
	xrDevice: XRDevice;
	controllerConnected: boolean;
};

type EmulatorSettingsState = {
	faceTrackingEnabled: boolean;
	stereoRenderingEnabled: boolean;
	immersiveFullscreenEnabled: boolean;
};

const SIGCF_PAIRING_BASE_URL = 'https://portalvr.io/controller';
const AMAZON_3D_GLASSES_URL =
	'https://www.amazon.com/INFICOLOR-3D-Compatible-Assassins-Revelations/dp/B005UZB7KM';

export function DevUIRoot({
	xrDevice,
	controllerConnected,
}: DevUIRootProps): JSX.Element {
	const [isSettingsOpen, setSettingsOpen] = useState(false);
	const [isHelpOpen, setHelpOpen] = useState(false);
	const [settings, setSettings] = useState<EmulatorSettingsState>(() =>
		readSettings(),
	);

	const scrimRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		ensurePortalStyles();
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setSettingsOpen(false);
				setHelpOpen(false);
			}
		};
		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	}, []);

	const openSettings = useCallback(() => {
		setSettings(readSettings());
		setSettingsOpen(true);
	}, []);

	const closeSettings = useCallback(() => {
		setSettingsOpen(false);
	}, []);

	const openHelp = useCallback(() => {
		setHelpOpen(true);
	}, []);

	const closeHelp = useCallback(() => {
		setHelpOpen(false);
	}, []);

	const toggleFaceTracking = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const enabled = event.currentTarget.checked;
			setSettings((prev) => ({
				...prev,
				faceTrackingEnabled: enabled,
			}));
			updatePortalEmulatorConfig({
				settings: { faceTrackingEnabled: enabled },
			});
			try {
				xrDevice.faceTrackingEnabled = enabled;
			} catch {
				// ignore in environments without face tracking
			}
		},
		[xrDevice],
	);

	const selectMode = useCallback((enabled: boolean) => {
		setSettings((prev) => ({
			...prev,
			stereoRenderingEnabled: enabled,
		}));
		updatePortalEmulatorConfig({
			settings: { stereoRenderingEnabled: enabled },
		});
	}, []);

	const toggleFullscreen = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const enabled = event.currentTarget.checked;
			setSettings((prev) => ({
				...prev,
				immersiveFullscreenEnabled: enabled,
			}));
			updatePortalEmulatorConfig({
				settings: { immersiveFullscreenEnabled: enabled },
			});
			try {
				xrDevice.immersiveFullscreenEnabled = enabled;
			} catch {
				// ignore if not supported
			}
		},
		[xrDevice],
	);

	const closeOnScrimClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (event.target === scrimRef.current) {
				setSettingsOpen(false);
				setHelpOpen(false);
			}
		},
		[],
	);

	const deviceName = xrDevice.portalDeviceName ?? xrDevice.name ?? 'PortalVR';
	const deviceUiCode = xrDevice.portalDeviceUiCode ?? '0000';
	const deviceId = xrDevice.portalDeviceId ?? 'PORTALVR-0000';

	const pairingUrl = useMemo(
		() => buildSigcfPairingUrl(deviceId),
		[deviceId],
	);

	const handleReload = useCallback(() => {
		if (typeof window !== 'undefined') {
			window.location.reload();
		}
	}, []);

	return (
		<div className="portal-overlay-root" aria-live="polite">
			<a
				className="portal-watermark"
				href="https://portalvr.io"
				target="_blank"
				rel="noreferrer"
			>
				<img src={ASSET_WATERMARK} alt="PortalVR" />
			</a>

			<div className="portal-top-icons">
				<button
					className="portal-icon-button"
					type="button"
					aria-label="Open help"
					onClick={openHelp}
				>
					<img src={ASSET_ICON_HELP} alt="" aria-hidden="true" />
				</button>
				<button
					className="portal-icon-button"
					type="button"
					aria-label="Open settings"
					onClick={openSettings}
				>
					<img src={ASSET_ICON_SETTINGS} alt="" aria-hidden="true" />
				</button>
			</div>

			<PortalQrPrompt
				pairingUrl={pairingUrl}
				deviceName={deviceName}
				deviceUiCode={deviceUiCode}
				deviceId={deviceId}
				visible={!controllerConnected}
			/>

			<div
				ref={scrimRef}
				className="portal-settings-scrim"
				aria-hidden={!isSettingsOpen && !isHelpOpen}
				onClick={closeOnScrimClick}
			>
				{isSettingsOpen && (
					<div className="portal-settings-card" role="dialog" aria-modal="true">
						<h2>PortalVR Settings</h2>

						<section className="portal-section">
							<h3 className="portal-section__heading">Face Tracking</h3>
							<label className="portal-toggle-row">
								<input
									type="checkbox"
									checked={settings.faceTrackingEnabled}
									onChange={toggleFaceTracking}
								/>
									<span>Enable face tracking</span>
								</label>
						</section>

						<section className="portal-section">
							<h3 className="portal-section__heading">Immersive Display</h3>
							<label className="portal-toggle-row">
								<input
									type="checkbox"
									checked={settings.immersiveFullscreenEnabled}
									onChange={toggleFullscreen}
								/>
								<span>Enable fullscreen when entering VR</span>
							</label>
						</section>

						<section className="portal-section">
							<h3 className="portal-section__heading">Rendering Mode</h3>
							<div className="portal-mode-toggle">
								<button
									type="button"
									className={`portal-mode-button${
										!settings.stereoRenderingEnabled
											? ' portal-mode-button--selected'
											: ''
									}`}
									onClick={() => selectMode(false)}
								>
									<img src={ASSET_MODE_2D} alt="2D mode icon" />
									<span>2D</span>
								</button>
								<button
									type="button"
									className={`portal-mode-button${
										settings.stereoRenderingEnabled
											? ' portal-mode-button--selected'
											: ''
									}`}
									onClick={() => selectMode(true)}
								>
									<img src={ASSET_MODE_3D} alt="3D glasses icon" />
									<span>3D Glasses</span>
								</button>
							</div>
							<p className="portal-reload-note">
								To switch modes,{' '}
								<button
									type="button"
									className="portal-link"
									onClick={handleReload}
								>
									reload
								</button>{' '}
								the page.
							</p>
							<p className="portal-mode-footer">
								<a
									className="portal-link"
									href={AMAZON_3D_GLASSES_URL}
									target="_blank"
									rel="noreferrer"
								>
									Get 3D Glasses
								</a>
							</p>
						</section>

						<button
							type="button"
							className="portal-close-button"
							onClick={closeSettings}
						>
							Close
						</button>
					</div>
				)}

				{isHelpOpen && (
					<div className="portal-help-dialog" role="dialog" aria-modal="true">
						<h2>PortalVR Help</h2>
						<p className="portal-help-text">
							Help content coming soon. Reach out to the Portal team if you need
							assistance.
						</p>
						<button
							type="button"
							className="portal-close-button"
							onClick={closeHelp}
						>
							Close
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function readSettings(): EmulatorSettingsState {
	const config = getPortalEmulatorConfig();
	return {
		faceTrackingEnabled: config.settings?.faceTrackingEnabled !== false,
		stereoRenderingEnabled: Boolean(config.settings?.stereoRenderingEnabled),
		immersiveFullscreenEnabled:
			config.settings?.immersiveFullscreenEnabled !== false,
	};
}

function buildSigcfPairingUrl(deviceId: string): string {
	const url = new URL(SIGCF_PAIRING_BASE_URL);
	url.searchParams.set('device_id', deviceId);
	url.searchParams.set('service_type', 'sigcf');
	return url.toString();
}
