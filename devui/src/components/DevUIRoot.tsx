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
	type CameraDragHand,
	type PlayerHeight,
	updatePortalEmulatorConfig,
	type AdbControllerStreamer,
	type ControllerState,
} from 'portalvr';
import type { AdbControllerCallbacks } from '../hooks/useQuestUsbDetection.js';

import { ensurePortalStyles } from '../styles/injectPortalStyles.js';
import { PortalQrPrompt } from './PortalQrPrompt.js';
import {
	ASSET_ICON_FULLSCREEN,
	ASSET_ICON_HELP,
	ASSET_ICON_SETTINGS,
	ASSET_MODE_2D,
	ASSET_MODE_3D,
	ASSET_WATERMARK,
} from '../generated/assets.js';

type DevUIRootProps = {
	xrDevice: XRDevice;
	controllerPrompt: 'qr' | 'tracking-issues' | 'focus-lost' | 'swipe' | 'hidden';
	swipeVariant?: 'base' | 'recenter' | 'trackpad' | 'quest-stick';
};

type EmulatorSettingsState = {
	faceTrackingEnabled: boolean;
	stereoRenderingEnabled: boolean;
	immersiveFullscreenEnabled: boolean;
	connectToControllerViaLan: boolean;
	cameraDragHand: CameraDragHand;
	playerHeight: PlayerHeight;
};

const SIGCF_PAIRING_BASE_URL = 'https://portalvr.io/controller';
const AMAZON_3D_GLASSES_URL =
	'https://www.amazon.com/INFICOLOR-3D-Compatible-Assassins-Revelations/dp/B005UZB7KM';
const HOW_TO_PLAY_URL = 'https://portalvr.io/how-to-play-webxr';
const DOCUMENTATION_URL = 'https://portalvr.io/docs';
const INTERACTION_MODE_OPENXR_QUEST = 0x10;

export function DevUIRoot({
	xrDevice,
	controllerPrompt,
	swipeVariant = 'base',
}: DevUIRootProps): JSX.Element {
	const [isSettingsOpen, setSettingsOpen] = useState(false);
	const [isHelpOpen, setHelpOpen] = useState(false);
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
	const [adbStreamer, setAdbStreamer] = useState<AdbControllerStreamer | null>(null);
	const [isAdbConnected, setIsAdbConnected] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	const lastInteractionMode = (xrDevice as any)?.getLastControllerInteractionMode?.() ?? 0;
	const isOpenxrQuest = lastInteractionMode === 0x10;

	// ADB controller callbacks - wire to XRDevice handlers
	const adbControllerCallbacks = useMemo<AdbControllerCallbacks>(() => ({
		onControllerState: (state: ControllerState) => {
			// Call XRDevice's internal handler
			(xrDevice as any).handleControllerState?.(state);
		},
		onOrientationReset: (hand: 'left' | 'right') => {
			(xrDevice as any).handleOrientationReset?.(hand);
		},
		onConnectionChange: (connected: boolean) => {
			setIsAdbConnected(connected);
			// Pass fromAdb=true so XRDevice knows this is an ADB connection
			(xrDevice as any).handleControllerConnectionChange?.(connected, true);
		},
	}), [xrDevice]);

	const handleAdbStreamerChange = useCallback((streamer: AdbControllerStreamer | null) => {
		setAdbStreamer(streamer);
		if (streamer) {
			// Disable WebRTC when ADB is active
			xrDevice.enableAdbControllerStreaming(streamer);
		} else {
			xrDevice.disableAdbControllerStreaming();
		}
	}, [xrDevice]);

	const handleFirstControllerLaunch = useCallback(() => {
		xrDevice.forceControllerSearchNow();
		setIsActiveSearch(true);
		setNextSearchAttemptAtMs(null);
		setSearchCountdownSeconds(null);
	}, [xrDevice]);

	const scrimRef = useRef<HTMLDivElement | null>(null);
	const helpScrimRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		ensurePortalStyles();
	}, []);

	// Track fullscreen state
	useEffect(() => {
		const updateFullscreenState = () => {
			const fullscreenElement =
				document.fullscreenElement ??
				(document as any).webkitFullscreenElement ??
				(document as any).mozFullScreenElement ??
				(document as any).msFullscreenElement ??
				null;
			setIsFullscreen(fullscreenElement != null);
		};

		updateFullscreenState();
		document.addEventListener('fullscreenchange', updateFullscreenState);
		document.addEventListener('webkitfullscreenchange', updateFullscreenState);
		document.addEventListener('mozfullscreenchange', updateFullscreenState);
		document.addEventListener('MSFullscreenChange', updateFullscreenState);

		return () => {
			document.removeEventListener('fullscreenchange', updateFullscreenState);
			document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
			document.removeEventListener('mozfullscreenchange', updateFullscreenState);
			document.removeEventListener('MSFullscreenChange', updateFullscreenState);
		};
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

	const selectCameraDragHand = useCallback(
		(hand: CameraDragHand) => {
			setSettings((prev) => ({
				...prev,
				cameraDragHand: hand,
			}));
			updatePortalEmulatorConfig({
				settings: { cameraDragHand: hand },
			});
			// Notify XRDevice of the change
			try {
				(xrDevice as any).setCameraDragHand?.(hand);
			} catch {
				// ignore if not supported
			}
		},
		[xrDevice],
	);

	const selectPlayerHeight = useCallback(
		(height: PlayerHeight) => {
			setSettings((prev) => ({
				...prev,
				playerHeight: height,
			}));
			updatePortalEmulatorConfig({
				settings: { playerHeight: height },
			});
			// Notify XRDevice of the change
			try {
				(xrDevice as any).setPlayerHeight?.(height);
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
			}
		},
		[],
	);

	const closeHelpOnScrimClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (event.target === helpScrimRef.current) {
				setHelpOpen(false);
			}
		},
		[],
	);

	const handleHelpClick = useCallback(() => {
		const interactionMode = (xrDevice as any)?.getLastControllerInteractionMode?.() ?? 0;
		if (interactionMode === INTERACTION_MODE_OPENXR_QUEST) {
			setHelpOpen(true);
		} else {
			window.open(HOW_TO_PLAY_URL, '_blank', 'noreferrer');
		}
	}, [xrDevice]);

	const closeHelp = useCallback(() => {
		setHelpOpen(false);
	}, []);

	const handleEnterFullscreen = useCallback(() => {
		const element = document.documentElement;
		const requestFullscreen =
			element.requestFullscreen ??
			(element as any).webkitRequestFullscreen ??
			(element as any).mozRequestFullScreen ??
			(element as any).msRequestFullscreen;
		if (requestFullscreen) {
			try {
				const result = requestFullscreen.call(element);
				if (result && typeof (result as Promise<void>).catch === 'function') {
					(result as Promise<void>).catch(() => {
						// ignore fullscreen request errors
					});
				}
			} catch {
				// ignore fullscreen request errors
			}
		}
	}, []);

	const isDualTrackedMode = useCallback(() => {
		return (xrDevice as any)?.isDualTrackedMode?.() ?? false;
	}, [xrDevice]);

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
				<button
					className="portal-icon-button"
					type="button"
					aria-label="Help"
					onClick={handleHelpClick}
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
				{!isFullscreen && (
					<button
						className="portal-icon-button"
						type="button"
						aria-label="Enter fullscreen"
						onClick={handleEnterFullscreen}
					>
						<img src={ASSET_ICON_FULLSCREEN} alt="" aria-hidden="true" />
					</button>
				)}
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
				controllerConnected={isSigcfConnected || isAdbConnected}
				isOpenxrQuest={isOpenxrQuest}
				onFirstControllerLaunch={handleFirstControllerLaunch}
				adbControllerCallbacks={adbControllerCallbacks}
				onAdbStreamerChange={handleAdbStreamerChange}
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
						<h3 className="portal-section__heading">Player Height</h3>
						<p className="portal-section__description">
							In-game default camera height
						</p>
						<div className="portal-mode-toggle portal-mode-toggle--inline">
							<button
								type="button"
								className={`portal-mode-button portal-mode-button--compact${
									settings.playerHeight === 'standing'
										? ' portal-mode-button--selected'
										: ''
								}`}
								onClick={() => selectPlayerHeight('standing')}
							>
								<span>Standing</span>
							</button>
							<button
								type="button"
								className={`portal-mode-button portal-mode-button--compact${
									settings.playerHeight === 'sitting'
										? ' portal-mode-button--selected'
										: ''
								}`}
								onClick={() => selectPlayerHeight('sitting')}
							>
								<span>Sitting</span>
							</button>
						</div>
					</section>

					<section className="portal-section">
						<h3 className="portal-section__heading">Camera Drag Hand</h3>
						<p className="portal-section__description">
							Which hands can move the camera
						</p>
						<div className="portal-mode-toggle portal-mode-toggle--inline">
							<button
								type="button"
								className={`portal-mode-button portal-mode-button--compact${
									settings.cameraDragHand === 'left'
										? ' portal-mode-button--selected'
										: ''
								}`}
								onClick={() => selectCameraDragHand('left')}
							>
								<span>Left</span>
							</button>
							<button
								type="button"
								className={`portal-mode-button portal-mode-button--compact${
									settings.cameraDragHand === 'right'
										? ' portal-mode-button--selected'
										: ''
								}`}
								onClick={() => selectCameraDragHand('right')}
							>
								<span>Right</span>
							</button>
							<button
								type="button"
								className={`portal-mode-button portal-mode-button--compact${
									settings.cameraDragHand === 'both'
										? ' portal-mode-button--selected'
										: ''
								}`}
								onClick={() => selectCameraDragHand('both')}
							>
								<span>Both</span>
							</button>
						</div>
					</section>

						<section className="portal-section">
							<h3 className="portal-section__heading">Rendering</h3>
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

			<div
				ref={helpScrimRef}
				className="portal-settings-scrim"
				aria-hidden={!isHelpOpen}
				onClick={closeHelpOnScrimClick}
			>
				{isHelpOpen && (
					<div className="portal-help-dialog" role="dialog" aria-modal="true">
						<h2>Help</h2>
						{isDualTrackedMode() ? (
							<div className="portal-help-text">
								<p>Press and hold the Menu button (left controller) to recenter controllers.</p>
								<p>Place your finger on either thumbstick to move the camera. Click in and hold either thumbstick to aim.</p>
								<p>Turn your wrist as you reach forward to stretch farther.</p>
								<p>
									For more information, see the{' '}
									<a href={DOCUMENTATION_URL} target="_blank" rel="noreferrer">
										documentation
									</a>
									.
								</p>
							</div>
						) : (
							<div className="portal-help-text">
								<p>Press and hold the Menu button (left controller) to recenter controllers.</p>
								<p>Place your finger on either thumbstick to move the camera. Press in the thumbstick and tilt it left or right to change hands. Press it in and tilt it up or down to zoom in or out.</p>
								<p>Turn your wrist as you reach forward to stretch farther.</p>
								<p>
									For more information, see the{' '}
									<a href={DOCUMENTATION_URL} target="_blank" rel="noreferrer">
										documentation
									</a>
									.
								</p>
							</div>
						)}
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
		cameraDragHand: source?.settings?.cameraDragHand ?? 'left',
		playerHeight: source?.settings?.playerHeight ?? 'standing',
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
