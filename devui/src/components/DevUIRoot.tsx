import {
	ChangeEvent,
	MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	XRDevice,
	portalConfigProvider,
	type PortalEmulatorConfig,
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
	controllerPrompt: 'qr' | 'tracking-issues' | 'swipe' | 'hidden';
	swipeVariant?: 'base' | 'recenter' | 'trackpad';
};

type EmulatorSettingsState = {
	faceTrackingEnabled: boolean;
	stereoRenderingEnabled: boolean;
	immersiveFullscreenEnabled: boolean;
	connectToControllerViaLan: boolean;
};

const SIGCF_PAIRING_BASE_URL = 'https://portalvr.io/controller';
const AMAZON_3D_GLASSES_URL =
	'https://www.amazon.com/INFICOLOR-3D-Compatible-Assassins-Revelations/dp/B005UZB7KM';

export function DevUIRoot({
	xrDevice,
	controllerPrompt,
	swipeVariant = 'base',
}: DevUIRootProps): JSX.Element {
	const [isSettingsOpen, setSettingsOpen] = useState(false);
	const [settings, setSettings] = useState<EmulatorSettingsState>(() =>
		readSettings(portalConfigProvider.getConfigSync()),
	);
	const [deviceLabel, setDeviceLabel] = useState<DeviceLabel>(() =>
		buildDeviceLabelFromXRDevice(xrDevice),
	);
	const [initialStereoMode, setInitialStereoMode] = useState<boolean>(
		() => xrDevice.stereoEnabled,
	);
	const [showStereoReloadNotice, setShowStereoReloadNotice] = useState(false);
	const [nextSearchAttemptAtMs, setNextSearchAttemptAtMs] = useState<number | null>(null);
	const [searchCountdownSeconds, setSearchCountdownSeconds] = useState<number | null>(null);
	const [isActiveSearch, setIsActiveSearch] = useState(true);
	const [isSigcfConnected, setIsSigcfConnected] = useState(false);

	const scrimRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		ensurePortalStyles();
	}, []);

	useEffect(() => {
		let isMounted = true;
		const applyConfig = (config: PortalEmulatorConfig | null) => {
			if (!isMounted || !config) {
				return;
			}
			setSettings(readSettings(config));
			setDeviceLabel(buildDeviceLabelFromConfig(config));
		};
		const snapshot = portalConfigProvider.getConfigSync();
		if (snapshot) {
			applyConfig(snapshot);
		} else {
			portalConfigProvider
				.waitForConfig({ requireSuffix: false })
				.then((config) => {
					applyConfig(config);
				})
				.catch(() => undefined);
		}
		const unsubscribe = portalConfigProvider.subscribe((config) => {
			applyConfig(config);
		}, false);
		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		const unsubscribe = xrDevice.onControllerSearchStatus((status) => {
			const connected = Boolean(status?.connected);
			setIsSigcfConnected(connected);
			if (!status || connected) {
				setIsActiveSearch(false);
				setNextSearchAttemptAtMs(null);
				return;
			}
			if (status.nextBackoffMs > 0) {
				setIsActiveSearch(false);
				setNextSearchAttemptAtMs((prev) => {
					const target = Date.now() + status.nextBackoffMs;
					if (prev != null && Math.abs(prev - target) < 250) {
						return prev;
					}
					return target;
				});
				return;
			}
			setIsActiveSearch(true);
			setNextSearchAttemptAtMs(null);
		});
		return () => {
			unsubscribe();
		};
	}, [xrDevice]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			setSearchCountdownSeconds(null);
			return;
		}
		if (nextSearchAttemptAtMs == null) {
			setSearchCountdownSeconds(null);
			return;
		}
		const updateCountdown = () => {
			const diff = nextSearchAttemptAtMs - Date.now();
			if (diff <= 0) {
				setNextSearchAttemptAtMs(null);
				setSearchCountdownSeconds(null);
				return;
			}
			setSearchCountdownSeconds(Math.max(0, Math.ceil(diff / 1000)));
		};
		updateCountdown();
		const timer = window.setInterval(updateCountdown, 1000);
		return () => {
			window.clearInterval(timer);
		};
	}, [nextSearchAttemptAtMs]);

	const openSettings = useCallback(() => {
		const nextSettings = readSettings(portalConfigProvider.getConfigSync());
		setSettings(nextSettings);
		const runtimeStereo = xrDevice.stereoEnabled;
		setInitialStereoMode(runtimeStereo);
		setShowStereoReloadNotice(false);
		setSettingsOpen(true);
	}, [xrDevice]);

	const closeSettings = useCallback(() => {
		setSettingsOpen(false);
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

	const selectMode = useCallback(
		(enabled: boolean) => {
			if (settings.stereoRenderingEnabled === enabled) {
				setShowStereoReloadNotice(enabled !== initialStereoMode);
				return;
			}
			setSettings((prev) => ({
				...prev,
				stereoRenderingEnabled: enabled,
			}));
			setShowStereoReloadNotice(enabled !== initialStereoMode);
			updatePortalEmulatorConfig({
				settings: { stereoRenderingEnabled: enabled },
			});
		},
		[initialStereoMode, settings.stereoRenderingEnabled],
	);

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

	const toggleControllerLan = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const enabled = event.currentTarget.checked;
			setSettings((prev) => ({
				...prev,
				connectToControllerViaLan: enabled,
			}));
			updatePortalEmulatorConfig({
				settings: { connectToControllerViaLan: enabled },
			});
		},
		[],
	);

	const closeOnScrimClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (event.target === scrimRef.current) {
				setSettingsOpen(false);
			}
		},
		[],
	);

	const deviceName = deviceLabel.name;
	const deviceUiCode = deviceLabel.uiCode;
	const deviceId = deviceLabel.id;

	const pairingUrl = useMemo(
		() => buildSigcfPairingUrl(deviceId),
		[deviceId],
	);

	const handleReload = useCallback(() => {
		if (typeof window !== 'undefined') {
			window.location.reload();
		}
	}, []);

	const handleSearchNow = useCallback(() => {
		setIsActiveSearch(true);
		setNextSearchAttemptAtMs(null);
		setSearchCountdownSeconds(null);
		xrDevice.forceControllerSearchNow();
	}, [xrDevice]);

	const showSearchButton =
		controllerPrompt === 'qr' &&
		!isSigcfConnected &&
		!isActiveSearch &&
		searchCountdownSeconds != null;



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
				<a
					className="portal-icon-button"
					href="https://youtu.be/g30wYsLU9AI"
					target="_blank"
					rel="noreferrer"
					aria-label="Watch help video"
				>
					<img src={ASSET_ICON_HELP} alt="" aria-hidden="true" />
				</a>
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
				status={controllerPrompt}
				swipeVariant={swipeVariant}
				searchCountdownSeconds={
					showSearchButton ? searchCountdownSeconds : null
				}
				isSearchingActively={controllerPrompt === 'qr' && isActiveSearch}
				onSearchNow={
					showSearchButton ? handleSearchNow : undefined
				}
			/>

			<div
				ref={scrimRef}
				className="portal-settings-scrim"
				aria-hidden={!isSettingsOpen}
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
						<h3 className="portal-section__heading">Controller Connection</h3>
						<label className="portal-toggle-row">
							<input
								type="checkbox"
								checked={settings.connectToControllerViaLan}
								onChange={toggleControllerLan}
							/>
							<span>Connect to controller via LAN</span>
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
					{showStereoReloadNotice && (
						<p className="portal-reload-note">
							Changing this value requires a reload.{' '}
							<button
								type="button"
								className="portal-link"
								onClick={handleReload}
							>
								Reload now
							</button>
						</p>
					)}
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
			</div>
		</div>
	);
}

type DeviceLabel = {
	name: string;
	id: string;
	uiCode: string;
};

function readSettings(config?: PortalEmulatorConfig | null): EmulatorSettingsState {
	const source = config ?? portalConfigProvider.getConfigSync();
	return {
		faceTrackingEnabled: source?.settings?.faceTrackingEnabled !== false,
		stereoRenderingEnabled: Boolean(source?.settings?.stereoRenderingEnabled),
		immersiveFullscreenEnabled:
			source?.settings?.immersiveFullscreenEnabled !== false,
		connectToControllerViaLan:
			source?.settings?.connectToControllerViaLan !== false,
	};
}

function buildDeviceLabelFromXRDevice(xrDevice: XRDevice): DeviceLabel {
	return {
		name: xrDevice.portalDeviceName ?? xrDevice.name ?? 'PortalVR',
		id: xrDevice.portalDeviceId ?? 'PORTALVR-0000',
		uiCode: xrDevice.portalDeviceUiCode ?? '0000',
	};
}

function buildDeviceLabelFromConfig(config: PortalEmulatorConfig): DeviceLabel {
	const suffix = (config.device?.suffix ?? '').trim().toUpperCase();
	if (!suffix) {
		return {
			name: 'PortalVR',
			id: 'PORTALVR-0000',
			uiCode: '0000',
		};
	}
	const name = `PORTALVR-${suffix}`;
	return {
		name,
		id: name,
		uiCode: suffix.substring(0, Math.min(4, suffix.length)),
	};
}

function buildSigcfPairingUrl(deviceId: string): string {
	const url = new URL(SIGCF_PAIRING_BASE_URL);
	url.searchParams.set('device_id', deviceId);
	url.searchParams.set('service_type', 'sigcf');
	return url.toString();
}
