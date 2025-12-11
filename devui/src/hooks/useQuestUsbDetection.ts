import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Adb,
	AdbCredentialStore,
	AdbDaemonTransport,
	AdbPrivateKey,
} from '@yume-chan/adb';
import {
	AdbDaemonWebUsbDevice,
	AdbDaemonWebUsbDeviceManager,
} from '@yume-chan/adb-daemon-webusb';
import {
	getPortalEmulatorConfig,
	portalConfigProvider,
	updatePortalEmulatorConfig,
	type PortalEmulatorConfig,
	AdbControllerStreamer,
	type ControllerState,
} from 'portalvr';

const QUEST_VENDOR_IDS = [0x2833];
const QUEST_DEVICE_FILTERS: USBDeviceFilter[] = QUEST_VENDOR_IDS.map((vendorId) => ({
	vendorId,
}));

const QUEST_KEY_NAME = 'PortalVR WebADB';
const POLL_INTERVAL_MS = 4000;
const PROXIMITY_CLOSE_ACTION = 'com.oculus.vrpowermanager.prox_close';
const CONTROLLER_PKG_NAME = 'io.portalvr.controller';
const CONTROLLER_APK_REMOTE_PATH = '/data/local/tmp/io.portalvr.controller.apk';
const MAX_CONTROLLER_LAUNCH_ATTEMPTS = 5;
const CONTROLLER_LAUNCH_RETRY_DELAY_MS = 4000;
const REPO_BASE_URL = 'https://repo.portalvr.io';
const REPO_INDEX_PATH = '/index-v2.json';
const MAX_SOCKET_ATTEMPTS = 2;
const SOCKET_RETRY_DELAY_MS = 1000;
const ADB_SOCKET_NAME = 'localabstract:PORTALVR-ADB';

const LOG_PREFIX = '[QuestUSB]';
export const ADB_BUSY_MESSAGE =
	"Another app is connected to your Quest. Try closing Unreal, Unity, Android Studio, SideQuest, or run 'adb kill-server' from the command line.";

function logDebug(...args: unknown[]): void {
	// Keep lightweight runtime logging to help diagnose WebUSB flakiness
	if (typeof console !== 'undefined' && console.info) {
		console.info(LOG_PREFIX, ...args);
	}
}

type AdbUsbStorageState = PortalEmulatorConfig['adbUsb'];

const ADB_USB_DEFAULT_STATE: AdbUsbStorageState = {
	adbPrivateKeyPkcs8: null,
};

export type QuestUsbUnsupportedReason = 'no-webusb' | 'insecure-context';

type ControllerSetupPhase =
	| 'checking'
	| 'downloading'
	| 'installing'
	| 'launching'
	| 'ready';

type ControllerSetupState = {
	kind: 'controller-setup';
	phase: ControllerSetupPhase;
	message?: string;
	progressPct: number | null;
	attempts?: number;
	showRetryPrompt?: boolean;
};

type RepoVersion = {
	fileName: string;
	versionCode: number;
	sha256Hex: string;
	nativeAbis: string[];
};

type RepoPackage = {
	packageName: string;
	versions: RepoVersion[];
};

type RepoIndex = {
	repoAddress: string;
	packages: Record<string, RepoPackage>;
};

type ControllerRepoInfo = {
	versionCode: number;
	apkUrl: string;
	sha256Hex?: string;
};

export type QuestUsbDetectionState =
	| { kind: 'idle' }
	| { kind: 'unsupported'; reason: QuestUsbUnsupportedReason }
	| { kind: 'needs-permission' }
	| { kind: 'requesting-permission' }
	| { kind: 'waiting'; message?: string }
	| { kind: 'quest-detected'; model?: string; manufacturer?: string }
	| ControllerSetupState
	| { kind: 'error'; message: string };

export type QuestUsbDetectionResult = {
	state: QuestUsbDetectionState;
	requestPermission: () => Promise<void>;
	hasPermission: boolean;
	restartLaunchLoop: () => void;
	/** ADB controller streamer when connected via USB. When non-null, skip SIGCF/WebRTC. */
	adbStreamer: AdbControllerStreamer | null;
};

type QuestInfo = {
	model?: string;
	manufacturer?: string;
};

export interface AdbControllerCallbacks {
	onControllerState?: (state: ControllerState) => void;
	onOrientationReset?: (hand: 'left' | 'right') => void;
	onConnectionChange?: (connected: boolean) => void;
}

export function useQuestUsbDetection(
	enabled: boolean,
	controllerLaunchUrl?: string,
	controllerConnected?: boolean,
	onFirstLaunch?: () => void,
	adbCallbacks?: AdbControllerCallbacks,
): QuestUsbDetectionResult {
	const manager = useMemo(() => AdbDaemonWebUsbDeviceManager.BROWSER, []);
	const [state, setState] = useState<QuestUsbDetectionState>({ kind: 'idle' });
	const [hasPermission, setHasPermission] = useState(false);
	const [adbStreamer, setAdbStreamer] = useState<AdbControllerStreamer | null>(null);
	const questDetectedRef = useRef(false);
	const credentialStoreRef = useRef<QuestCredentialStore | null>(null);
	const pipelineStartedRef = useRef(false);
	const launchRetryTimeoutRef = useRef<number | null>(null);
	const exhaustedPromptTimeoutRef = useRef<number | null>(null);
	const enabledRef = useRef(enabled);
	const controllerConnectedRef = useRef(Boolean(controllerConnected));
	const unmountedRef = useRef(false);
	const firstLaunchFiredRef = useRef(false);
	const onFirstLaunchRef = useRef(onFirstLaunch);
	const adbStreamerRef = useRef<AdbControllerStreamer | null>(null);
	const adbCallbacksRef = useRef(adbCallbacks);
	const exitedFullscreenForUsbRef = useRef(false);

	useEffect(() => {
		onFirstLaunchRef.current = onFirstLaunch;
	}, [onFirstLaunch]);

	useEffect(() => {
		adbCallbacksRef.current = adbCallbacks;
	}, [adbCallbacks]);

	useEffect(() => {
		enabledRef.current = enabled;
	}, [enabled]);

	useEffect(() => () => {
		unmountedRef.current = true;
		if (typeof window !== 'undefined' && launchRetryTimeoutRef.current != null) {
			window.clearTimeout(launchRetryTimeoutRef.current);
			launchRetryTimeoutRef.current = null;
		}
		if (typeof window !== 'undefined' && exhaustedPromptTimeoutRef.current != null) {
			window.clearTimeout(exhaustedPromptTimeoutRef.current);
			exhaustedPromptTimeoutRef.current = null;
		}
		// Dispose ADB streamer on unmount
		if (adbStreamerRef.current) {
			void adbStreamerRef.current.dispose();
			adbStreamerRef.current = null;
		}
	}, []);

	useEffect(() => {
		controllerConnectedRef.current = Boolean(controllerConnected);
		if (controllerConnected && typeof window !== 'undefined') {
			if (launchRetryTimeoutRef.current != null) {
				window.clearTimeout(launchRetryTimeoutRef.current);
				launchRetryTimeoutRef.current = null;
			}
			if (exhaustedPromptTimeoutRef.current != null) {
				window.clearTimeout(exhaustedPromptTimeoutRef.current);
				exhaustedPromptTimeoutRef.current = null;
			}
		}
	}, [controllerConnected]);

	useEffect(() => {
		questDetectedRef.current =
			state.kind === 'quest-detected' || state.kind === 'controller-setup';
	}, [state.kind]);

	const ensureCredentialStore = useCallback(() => {
		if (!credentialStoreRef.current) {
			credentialStoreRef.current = new QuestCredentialStore();
		}
		return credentialStoreRef.current;
	}, []);

	const restartLaunchLoop = useCallback(() => {
		if (unmountedRef.current || !enabledRef.current) {
			return;
		}
		if (!manager || !hasPermission || !controllerLaunchUrl) {
			return;
		}
		if (typeof window !== 'undefined') {
			if (launchRetryTimeoutRef.current != null) {
				window.clearTimeout(launchRetryTimeoutRef.current);
				launchRetryTimeoutRef.current = null;
			}
			if (exhaustedPromptTimeoutRef.current != null) {
				window.clearTimeout(exhaustedPromptTimeoutRef.current);
				exhaustedPromptTimeoutRef.current = null;
			}
		}
		controllerConnectedRef.current = Boolean(controllerConnectedRef.current);
		void launchControllerWithRetries(
			manager,
			ensureCredentialStore,
			controllerLaunchUrl,
			setState,
			controllerConnectedRef,
			launchRetryTimeoutRef,
			exhaustedPromptTimeoutRef,
			onFirstLaunchRef,
			firstLaunchFiredRef,
			adbStreamerRef,
			setAdbStreamer,
			adbCallbacksRef,
		);
	}, [manager, hasPermission, controllerLaunchUrl, ensureCredentialStore]);

	useEffect(() => {
		if (!enabled) {
			setState({ kind: 'idle' });
			setHasPermission(false);
			questDetectedRef.current = false;
			pipelineStartedRef.current = false;
			firstLaunchFiredRef.current = false;
			if (typeof window !== 'undefined' && launchRetryTimeoutRef.current != null) {
				window.clearTimeout(launchRetryTimeoutRef.current);
				launchRetryTimeoutRef.current = null;
			}
			if (typeof window !== 'undefined' && exhaustedPromptTimeoutRef.current != null) {
				window.clearTimeout(exhaustedPromptTimeoutRef.current);
				exhaustedPromptTimeoutRef.current = null;
			}
			// Don't dispose ADB streamer when disabled if it's actively connected
			// The streamer should keep running to maintain the controller connection
			// Only dispose on unmount (handled in a separate effect)
			return;
		}

		if (typeof window === 'undefined') {
			return;
		}

		if (!window.isSecureContext) {
			setState({ kind: 'unsupported', reason: 'insecure-context' });
			return;
		}

		if (!manager) {
			setState({ kind: 'unsupported', reason: 'no-webusb' });
			return;
		}

		// If we already have an active ADB streamer that is connected,
		// we already have permission and don't need to re-check or show the permission dialog
		const existingStreamer = adbStreamerRef.current;
		if (existingStreamer && existingStreamer.isConnected()) {
			setHasPermission(true);
			// Also mark quest as detected so we don't re-probe
			questDetectedRef.current = true;
			return;
		}

		let cancelled = false;

		const initializePermission = async () => {
			try {
				const devices = await manager.getDevices({ filters: QUEST_DEVICE_FILTERS });
				if (cancelled) {
					return;
				}
				if (devices.length > 0) {
					setHasPermission(true);
					setState({
						kind: 'waiting',
						message: 'Looking for Quest over USB...',
					});
				} else {
					setHasPermission(false);
					setState({ kind: 'needs-permission' });
				}
			} catch (error) {
				// Swallow transient USB errors - retry will handle them
				if (!cancelled && !isTransientUsbError(error)) {
					setState({ kind: 'error', message: formatError(error) });
				}
			}
		};

		void initializePermission();

		return () => {
			cancelled = true;
		};
	}, [enabled, manager]);

	useEffect(() => {
		if (!enabled || !manager || !hasPermission) {
			return;
		}

		let cancelled = false;
		let timeoutId: number | null = null;
		let running = false;
		let retryImmediately = false;

		const schedule = () => {
			if (!cancelled && !questDetectedRef.current && typeof window !== 'undefined') {
				const delay = retryImmediately ? 0 : POLL_INTERVAL_MS;
				retryImmediately = false;
				timeoutId = window.setTimeout(runPoll, delay);
			}
		};

		const runPoll = async () => {
			if (cancelled || questDetectedRef.current || running) {
				schedule();
				return;
			}
			running = true;
			try {
				const devices = await manager.getDevices({ filters: QUEST_DEVICE_FILTERS });
				if (cancelled || questDetectedRef.current) {
					return;
				}
				const questDevice = devices.find(isQuestUsbDevice);
				if (!questDevice) {
					setState((prev) =>
						prev.kind === 'quest-detected' || prev.kind === 'controller-setup'
							? prev
							: {
									kind: 'waiting',
									message: 'Waiting for Quest to be connected...',
								},
					);
					return;
				}
				setState((prev) =>
					prev.kind === 'quest-detected' || prev.kind === 'controller-setup'
						? prev
						: {
								kind: 'waiting',
								message:
									'Quest detected over USB. Put on your headset and approve the USB debugging prompt.',
							},
				);
				const info = await probeQuestDevice(questDevice, ensureCredentialStore());
				if (cancelled || questDetectedRef.current) {
					return;
				}
				if (info) {
					questDetectedRef.current = true;
					setState({
						kind: 'quest-detected',
						model: info.model,
						manufacturer: info.manufacturer,
					});
				} else {
					setState({
						kind: 'waiting',
						message:
							'USB link ready. Waiting for USB debugging approval...',
					});
				}
			} catch (error) {
				// Swallow transient USB errors and retry immediately
				if (isTransientUsbError(error)) {
					retryImmediately = true;
				} else if (!cancelled && !questDetectedRef.current) {
					setState({ kind: 'error', message: formatError(error) });
				}
			} finally {
				running = false;
				schedule();
			}
		};

		runPoll();

		return () => {
			cancelled = true;
			if (timeoutId != null && typeof window !== 'undefined') {
				window.clearTimeout(timeoutId);
			}
		};
	}, [enabled, ensureCredentialStore, hasPermission, manager]);

	// After Quest is detected and ADB is authorized, ensure the controller app is installed,
	// then launch it with the SIGCF controller URL, retrying if the controller doesn't connect.
	useEffect(() => {
		if (!enabled || !manager || !hasPermission) {
			return;
		}
		if (state.kind !== 'quest-detected') {
			return;
		}
		if (pipelineStartedRef.current) {
			return;
		}
		pipelineStartedRef.current = true;
		logDebug('Starting controller pipeline');

		const safeSetState = (
			value:
				| QuestUsbDetectionState
				| ((prev: QuestUsbDetectionState) => QuestUsbDetectionState),
		): void => {
			if (unmountedRef.current || !enabledRef.current) {
				return;
			}
			setState(value);
		};

		const run = async () => {
			let adb: Adb | null = null;
			try {
				safeSetState({
					kind: 'controller-setup',
					phase: 'checking',
					message: 'Checking controller app on Quest...',
					progressPct: null,
				});

				adb = await openQuestAdb(manager, ensureCredentialStore());

				// Disable the proximity sensor so the headset stays awake while streaming.
				await safeRunShellIgnoreError(adb, [
					'am',
					'broadcast',
					'-a',
					PROXIMITY_CLOSE_ACTION,
				]);

				const deviceAbis = await readDeviceAbis(adb);
				logDebug('Device ABIs', deviceAbis);

				let repoInfo: ControllerRepoInfo | null = null;
				try {
					repoInfo = await fetchControllerRepoInfo(deviceAbis);
					if (repoInfo) {
						logDebug('Repo controller version', repoInfo.versionCode, repoInfo.apkUrl);
					}
				} catch {
					// Repo unreachable or invalid; treat as offline and fall back to on-device install.
					repoInfo = null;
					logDebug('Repo unreachable, falling back to installed version');
				}

				const installedVersion = await readInstalledControllerVersion(adb);
				logDebug('Installed controller version', installedVersion);

				if (!repoInfo) {
					if (installedVersion == null) {
						throw new Error(
							'Controller app is not installed, and the PortalVR repo could not be reached.',
						);
					}
					// Repo offline but controller exists – continue to launch below.
				} else {
					// Always enforce the repo version when available. If the installed
					// version differs at all, download and install the repo build,
					// forcing downgrades/upgrades with -d -r.
					const needsInstall =
						installedVersion == null ||
						installedVersion !== repoInfo.versionCode;
					logDebug('Version check', {
						installedVersion,
						repoVersion: repoInfo.versionCode,
						needsInstall,
					});

					if (needsInstall) {
							safeSetState({
								kind: 'controller-setup',
								phase: 'downloading',
								message: 'Downloading controller app (0%)',
								progressPct: 0,
							});

						const apkBytes = await downloadApkWithProgress(
							repoInfo.apkUrl,
							(percent) => {
								const pct = clampPercent(percent);
								if (pct === 0 || pct === 100 || pct % 10 === 0) {
									logDebug('APK download progress', `${pct}%`);
								}
								safeSetState((prev) =>
									prev.kind === 'controller-setup' &&
									prev.phase === 'downloading'
										? {
											...prev,
											message: `Downloading controller app (${pct}%)`,
											progressPct: pct,
										}
										: prev,
								);
							},
						);

						if (repoInfo.sha256Hex && repoInfo.sha256Hex.length > 0) {
							const actualSha = await sha256Hex(apkBytes);
							logDebug('APK sha256', { expected: repoInfo.sha256Hex, actual: actualSha });
							if (!equalsHex(actualSha, repoInfo.sha256Hex)) {
								throw new Error(
									'Downloaded controller app failed integrity verification.',
								);
							}
						}

						safeSetState({
							kind: 'controller-setup',
							phase: 'installing',
							message: 'Installing controller app...',
							progressPct: 0,
						});

						await installControllerApk(adb, apkBytes, (percent) => {
							const pct = clampPercent(percent);
							if (pct === 0 || pct === 100 || pct % 10 === 0) {
								logDebug('APK install progress', `${pct}%`);
							}
							safeSetState((prev) =>
								prev.kind === 'controller-setup' &&
								prev.phase === 'installing'
									? {
											...prev,
											message: `Installing controller app (${pct}%)`,
											progressPct: pct,
										}
									: prev,
							);
						});

						const afterVersion = await readInstalledControllerVersion(adb);
						logDebug('Post-install controller version', afterVersion);
						if (afterVersion == null) {
							throw new Error(
								'Controller app did not install correctly on the Quest.',
							);
						}
					}
				}
			} catch (error) {
				// Swallow transient USB errors - retry will handle them
				if (!unmountedRef.current && enabledRef.current && !isTransientUsbError(error)) {
					logDebug('Controller pipeline error', error);
					safeSetState({
						kind: 'error',
						message: formatError(error),
					});
				}
				return;
			} finally {
				await adb?.close().catch(() => undefined);
			}

			// At this point we know the controller app is present on the device.
			if (!controllerLaunchUrl) {
				logDebug('Controller installed; no launch URL provided');
				safeSetState({
					kind: 'controller-setup',
					phase: 'ready',
					message: 'Quest connected via USB. Controller app installed.',
					progressPct: null,
				});
				return;
		}

			restartLaunchLoop();
		};

		void run();
	}, [
		enabled,
		manager,
		hasPermission,
		state.kind,
		controllerLaunchUrl,
		ensureCredentialStore,
		restartLaunchLoop,
	]);

	// When the controller connects via SIGCF, mark setup as ready and cancel
	// any pending launch retries.
	useEffect(() => {
		if (!controllerConnected) {
			return;
		}
		if (typeof window !== 'undefined' && launchRetryTimeoutRef.current != null) {
			window.clearTimeout(launchRetryTimeoutRef.current);
			launchRetryTimeoutRef.current = null;
		}
		setState((prev) =>
			prev.kind === 'controller-setup'
				? {
						...prev,
						phase: 'ready',
						message: 'Controller connected.',
						progressPct: null,
					}
				: prev,
		);
	}, [controllerConnected]);

	const requestPermission = useCallback(async () => {
		if (!enabled) {
			return;
		}

		if (typeof window === 'undefined') {
			return;
		}

		if (!window.isSecureContext) {
			setState({ kind: 'unsupported', reason: 'insecure-context' });
			return;
		}

		if (!manager) {
			setState({ kind: 'unsupported', reason: 'no-webusb' });
			return;
		}

		// Chrome doesn't show the USB device chooser dialog in fullscreen mode.
		// Exit fullscreen first and return - the user will need to click again.
		// This is necessary because the user gesture gets consumed by exiting fullscreen,
		// leaving no valid gesture for the permission dialog.
		if (isInFullscreen()) {
			await exitFullscreen();
			// Track that we exited fullscreen for USB so we can re-enter after permission granted
			exitedFullscreenForUsbRef.current = true;
			// Stay in needs-permission state so the button is still visible
			setState({ kind: 'needs-permission' });
			return;
		}

		setState({ kind: 'requesting-permission' });
		try {
			const device = await manager.requestDevice({ filters: QUEST_DEVICE_FILTERS });

			if (!device) {
				setState({ kind: 'needs-permission' });
				return;
			}

			// Re-enter fullscreen if we exited it for USB permission
			if (exitedFullscreenForUsbRef.current) {
				exitedFullscreenForUsbRef.current = false;
				await requestFullscreen();
			}

			setHasPermission(true);
			setState({
				kind: 'waiting',
				message: 'Looking for Quest over USB...',
			});
		} catch (error) {
			if (isUserCancellation(error)) {
				setState({ kind: 'needs-permission' });
				return;
			}
			// Swallow transient USB errors - retry will handle them
			if (!isTransientUsbError(error)) {
				setState({ kind: 'error', message: formatError(error) });
			}
		}
	}, [enabled, manager]);

	return {
		state,
		hasPermission,
		requestPermission,
		restartLaunchLoop,
		adbStreamer,
	};
}

function isQuestUsbDevice(device: AdbDaemonWebUsbDevice): boolean {
	return QUEST_VENDOR_IDS.includes(device.raw.vendorId);
}

async function probeQuestDevice(
	device: AdbDaemonWebUsbDevice,
	credentialStore: AdbCredentialStore,
): Promise<QuestInfo | null> {
	let adb: Adb | undefined;
	try {
		const connection = await device.connect();
		const transport = await AdbDaemonTransport.authenticate({
			serial: device.serial || device.name,
			connection,
			credentialStore,
		});
		adb = new Adb(transport);
		const [modelRaw, manufacturerRaw, brandRaw] = await Promise.all([
			adb.getProp('ro.product.model').catch(() => ''),
			adb.getProp('ro.product.manufacturer').catch(() => ''),
			adb.getProp('ro.product.brand').catch(() => ''),
		]);
		const model = sanitize(modelRaw);
		const manufacturer = sanitize(manufacturerRaw);
		const brand = sanitize(brandRaw);
		if (isQuestProduct({ model, manufacturer, brand })) {
			return { model, manufacturer };
		}
		return null;
	} finally {
		await adb?.close().catch(() => undefined);
	}
}

async function openQuestAdb(
	manager: AdbDaemonWebUsbDeviceManager,
	credentialStore: AdbCredentialStore,
): Promise<Adb> {
	const devices = await manager.getDevices({ filters: QUEST_DEVICE_FILTERS });
	const questDevice = devices.find(isQuestUsbDevice);
	if (!questDevice) {
		throw new Error('Quest is no longer connected over USB.');
	}
	const connection = await questDevice.connect();
	const transport = await AdbDaemonTransport.authenticate({
		serial: questDevice.serial || questDevice.name,
		connection,
		credentialStore,
	});
	return new Adb(transport);
}

type AdbShellTextResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

async function runShellText(
	adb: Adb,
	command: string | string[],
): Promise<AdbShellTextResult> {
	const adbAny = adb as any;
	const subprocess = adbAny.subprocess;
	const shellProtocol = subprocess?.shellProtocol;
	if (!shellProtocol) {
		throw new Error(
			'This Quest device does not support the ADB shell protocol required for controller setup.',
		);
	}
	const result = await shellProtocol.spawnWaitText(command);
	return result as AdbShellTextResult;
}

async function safeRunShellIgnoreError(
	adb: Adb,
	command: string | string[],
): Promise<void> {
	try {
		await runShellText(adb, command);
	} catch {
		// best-effort only
	}
}

function isQuestProduct(value: {
	model: string;
	manufacturer: string;
	brand: string;
}): boolean {
	if (/quest/i.test(value.model)) {
		return true;
	}
	const manufacturerMatch = /(meta|oculus)/i;
	return (
		manufacturerMatch.test(value.manufacturer) ||
		manufacturerMatch.test(value.brand)
	);
}

function sanitize(value: string | null | undefined): string {
	return (value ?? '').trim();
}

async function readDeviceAbis(adb: Adb): Promise<string[]> {
	try {
		const abilist = sanitize(
			await adb.getProp('ro.product.cpu.abilist').catch(() => ''),
		);
		if (abilist) {
			return abilist
				.split(',')
				.map((part) => part.trim())
				.filter((part) => part.length > 0);
		}
		const abi = sanitize(await adb.getProp('ro.product.cpu.abi').catch(() => ''));
		if (abi) {
			return [abi];
		}
	} catch {
		// ignore and fall back to empty list
	}
	return [];
}

async function readInstalledControllerVersion(adb: Adb): Promise<number | null> {
	try {
		const result = await runShellText(adb, [
			'dumpsys',
			'package',
			CONTROLLER_PKG_NAME,
		]);
		const output = `${result.stdout}\n${result.stderr ?? ''}`;
		if (
			result.exitCode !== 0 ||
			/Unable to find package/i.test(output)
		) {
			return null;
		}
		const match = output.match(/versionCode=(\d+)/);
		if (match && match[1]) {
			const parsed = Number.parseInt(match[1], 10);
			if (Number.isFinite(parsed) && parsed > 0) {
				return parsed;
			}
		}
		return null;
	} catch {
		return null;
	}
}

async function fetchControllerRepoInfo(
	deviceAbis: string[],
): Promise<ControllerRepoInfo | null> {
	const index = await fetchRepoIndex();
	const controller = index.packages[CONTROLLER_PKG_NAME];
	if (!controller) {
		return null;
	}
	const best = pickBestVersionForAbis(controller, deviceAbis);
	if (!best || !best.fileName || !best.versionCode) {
		return null;
	}
	const apkUrl = buildRepoFileUrl(index.repoAddress, best.fileName);
	return {
		versionCode: best.versionCode,
		apkUrl,
		sha256Hex: best.sha256Hex,
	};
}

async function fetchRepoIndex(): Promise<RepoIndex> {
	const url = REPO_BASE_URL + REPO_INDEX_PATH;
	const response = await fetchWithTimeout(url, 20_000);
	if (!response.ok) {
		throw new Error(`Failed to load PortalVR repo index (${response.status})`);
	}
	const json = (await response.json()) as {
		repo?: { address?: string };
		packages?: Record<string, any>;
	};

	const repoAddressRaw =
		typeof json.repo?.address === 'string' && json.repo.address.length > 0
			? json.repo.address
			: `${REPO_BASE_URL}/repo`;

	const repoAddress = repoAddressRaw;

	const packagesSource = json.packages ?? {};
	const packages: Record<string, RepoPackage> = {};

	for (const [pkgNameKey, pkgVal] of Object.entries(packagesSource)) {
		const pkgObject = (pkgVal ?? {}) as {
			packageName?: string;
			versions?: Record<string, any>;
		};
		const packageName =
			typeof pkgObject.packageName === 'string' && pkgObject.packageName.length > 0
				? pkgObject.packageName
				: pkgNameKey;
		const versionsSource = pkgObject.versions ?? {};
		const versions: RepoVersion[] = [];

		for (const [shaKey, versionVal] of Object.entries(versionsSource)) {
			const v = versionVal ?? {};
			const file = v.file ?? {};
			const manifest = v.manifest ?? {};
			const fileName: string | undefined = file.name;
			const versionCodeRaw = manifest.versionCode;
			const versionCode =
				typeof versionCodeRaw === 'number'
					? versionCodeRaw
					: typeof versionCodeRaw === 'string'
						? Number.parseInt(versionCodeRaw, 10)
						: 0;
			const sha256HexValue: string | undefined = file.sha256 ?? shaKey;
			const nativeCodeArray: unknown = manifest.nativecode;
			const nativeAbis: string[] = Array.isArray(nativeCodeArray)
				? nativeCodeArray
						.map((item) => (typeof item === 'string' ? item.trim() : ''))
						.filter((item) => item.length > 0)
				: [];

			if (!fileName || !Number.isFinite(versionCode) || versionCode <= 0) {
				continue;
			}
			versions.push({
				fileName,
				versionCode,
				sha256Hex:
					typeof sha256HexValue === 'string'
						? sha256HexValue.toLowerCase()
						: '',
				nativeAbis,
			});
		}

		packages[packageName] = {
			packageName,
			versions,
		};
	}

	return {
		repoAddress,
		packages,
	};
}

function pickBestVersionForAbis(
	pkg: RepoPackage,
	deviceAbis: string[],
): RepoVersion | null {
	if (!pkg.versions.length) {
		return null;
	}
	const abisLower = deviceAbis.map((abi) => abi.toLowerCase());
	let best: RepoVersion | null = null;
	for (const v of pkg.versions) {
		if (!best) {
			best = v;
			continue;
		}
		if (v.versionCode <= best.versionCode) {
			continue;
		}
		if (!v.nativeAbis.length) {
			best = v;
			continue;
		}
		const hasIntersection = v.nativeAbis.some((abi) =>
			abisLower.includes(abi.toLowerCase()),
		);
		if (hasIntersection) {
			best = v;
		}
	}
	return best;
}

function buildRepoFileUrl(repoAddress: string, fileName: string): string {
	try {
		const base = repoAddress.endsWith('/')
			? repoAddress
			: `${repoAddress}/`;
		const path = fileName.startsWith('/') ? fileName.substring(1) : fileName;
		const url = new URL(path, base);
		return url.toString();
	} catch {
		return `${repoAddress.replace(/\/$/, '')}/${fileName.replace(/^\//, '')}`;
	}
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	if (typeof fetch === 'undefined') {
		throw new Error('This browser does not support fetch for repo access.');
	}
	if (typeof AbortController === 'undefined') {
		return fetch(url);
	}
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(id);
	}
}

async function downloadApkWithProgress(
	url: string,
	onProgress?: (percent: number) => void,
): Promise<Uint8Array> {
	const response = await fetchWithTimeout(url, 60_000);
	if (!response.ok || !response.body) {
		throw new Error(`Failed to download controller app (HTTP ${response.status}).`);
	}
	const contentLengthHeader = response.headers.get('content-length');
	const totalBytes =
		contentLengthHeader != null ? Number.parseInt(contentLengthHeader, 10) : 0;

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;

	// Read the stream and report progress if total size is known.
	// eslint-disable-next-line no-constant-condition
	while (true) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (!value) {
			continue;
		}
		chunks.push(value);
		loaded += value.length;
		if (totalBytes > 0 && onProgress) {
			const pct = Math.floor((loaded * 100) / totalBytes);
			onProgress(clampPercent(pct));
		}
	}

	const result = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	if (onProgress) {
		onProgress(100);
	}
	return result;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const crypto = getWebCrypto();
	if (!crypto || !crypto.subtle) {
		throw new Error('WebCrypto is not available to verify controller APK integrity.');
	}
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
	const array = new Uint8Array(digest);
	let hex = '';
	for (let i = 0; i < array.length; i += 1) {
		const byte = array[i]!;
		const part = byte.toString(16);
		if (part.length === 1) {
			hex += `0${part}`;
		} else {
			hex += part;
		}
	}
	return hex.toLowerCase();
}

function equalsHex(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function clampPercent(value: number | null | undefined): number {
	if (value == null || Number.isNaN(value)) {
		return 0;
	}
	if (value < 0) {
		return 0;
	}
	if (value > 100) {
		return 100;
	}
	return Math.floor(value);
}

async function installControllerApk(
	adb: Adb,
	apkBytes: Uint8Array,
	onProgress?: (percent: number) => void,
): Promise<void> {
	const adbAny = adb as any;
	const sync = await adbAny.sync();

	const total = apkBytes.length;
	const chunkSize = 64 * 1024;
	let offset = 0;

	if (typeof ReadableStream === 'undefined') {
		throw new Error(
			'This browser does not support ReadableStream required for controller install over USB.',
		);
	}

	const fileStream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= total) {
				controller.close();
				if (onProgress) {
					onProgress(100);
				}
				return;
			}
			const end = Math.min(total, offset + chunkSize);
			const chunk = apkBytes.subarray(offset, end);
			controller.enqueue(chunk);
			offset = end;
			if (onProgress) {
				const pct = Math.floor((offset * 100) / total);
				onProgress(clampPercent(pct));
			}
		},
	});

	await sync.write({
		filename: CONTROLLER_APK_REMOTE_PATH,
		// Tango's AdbSync typings use a different ReadableStream type; cast through `never`.
		file: fileStream as never,
	}).catch((error: unknown) => {
		logDebug('APK push failed', error);
		throw error;
	});

	const result = await runShellText(adb, [
		'pm',
		'install',
		'-d',
		'-r',
		CONTROLLER_APK_REMOTE_PATH,
	]).catch((error: unknown) => {
		logDebug('pm install failed', error);
		throw error;
	});

	if (result.exitCode !== 0 || !/Success/i.test(result.stdout)) {
		throw new Error(
			`Controller app install failed: ${
				result.stderr || result.stdout || `exit code ${result.exitCode}`
			}`,
		);
	}
	logDebug('pm install success');

	await safeRunShellIgnoreError(adb, ['rm', '-f', CONTROLLER_APK_REMOTE_PATH]);
}

async function launchControllerWithRetries(
	manager: AdbDaemonWebUsbDeviceManager,
	getCredentialStore: () => AdbCredentialStore,
	controllerLaunchUrl: string,
	setState: (
		value:
			| QuestUsbDetectionState
			| ((prev: QuestUsbDetectionState) => QuestUsbDetectionState),
	) => void,
	controllerConnectedRef: { current: boolean },
	launchRetryTimeoutRef: { current: number | null },
	exhaustedPromptTimeoutRef: { current: number | null },
	onFirstLaunchRef?: { current: (() => void) | undefined },
	firstLaunchFiredRef?: { current: boolean },
	adbStreamerRef?: { current: AdbControllerStreamer | null },
	setAdbStreamer?: (streamer: AdbControllerStreamer | null) => void,
	adbCallbacksRef?: { current: AdbControllerCallbacks | undefined },
): Promise<void> {
	let attempt = 0;
	logDebug('Launch controller with retries', { controllerLaunchUrl });

	const attemptLaunch = async (): Promise<void> => {
		if (firstLaunchFiredRef && !firstLaunchFiredRef.current) {
			firstLaunchFiredRef.current = true;
			onFirstLaunchRef?.current?.();
		}
		if (controllerConnectedRef.current) {
			setState((prev) =>
				prev.kind === 'controller-setup'
					? {
							...prev,
							phase: 'ready',
							message: 'Controller connected.',
							progressPct: null,
						}
					: prev,
			);
			return;
		}

		if (attempt >= MAX_CONTROLLER_LAUNCH_ATTEMPTS) {
			// Give up; the user can still open the app manually.
			if (typeof window !== 'undefined' && exhaustedPromptTimeoutRef.current != null) {
				window.clearTimeout(exhaustedPromptTimeoutRef.current);
				exhaustedPromptTimeoutRef.current = null;
			}
			setState((prev) =>
				prev.kind === 'controller-setup'
					? {
							...prev,
							phase: 'ready',
							message:
								prev.message ??
								'Controller app launched. Waiting for connection...',
							progressPct: null,
							showRetryPrompt: false,
						}
					: prev,
			);
			if (typeof window !== 'undefined') {
				exhaustedPromptTimeoutRef.current = window.setTimeout(() => {
					if (controllerConnectedRef.current) {
						return;
					}
					setState((prev) =>
						prev.kind === 'controller-setup'
							? { ...prev, showRetryPrompt: true }
							: prev,
					);
				}, 5000);
			}
			return;
		}

		attempt += 1;
		logDebug('Launching controller attempt', attempt);

		setState({
			kind: 'controller-setup',
			phase: 'launching',
			message: 'Connecting...',
			progressPct: null,
			attempts: attempt,
			showRetryPrompt: false,
		});

		let adb: Adb | null = null;
		let socketConnected = false;
		try {
			adb = await openQuestAdb(manager, getCredentialStore());
			await safeRunShellIgnoreError(adb, [
				'am',
				'force-stop',
				CONTROLLER_PKG_NAME,
			]);
			// Modify the launch URL to use ADB binding type instead of SIGCF
			const adbLaunchUrl = (() => {
				try {
					const url = new URL(controllerLaunchUrl);
					url.searchParams.set('service_type', 'adb');
					return url.toString();
				} catch {
					// If URL parsing fails, append the parameter manually
					const separator = controllerLaunchUrl.includes('?') ? '&' : '?';
					return `${controllerLaunchUrl}${separator}service_type=adb`;
				}
			})();
			logDebug('Sending launch intent', {
				component: `${CONTROLLER_PKG_NAME}/.xr.XrHeadsetActivity`,
				action: 'android.intent.action.VIEW',
				data: adbLaunchUrl,
			});
			const quotedUrl = adbLaunchUrl.replace(/'/g, "'\\''");
			const intentCmd =
				`am start -n ${CONTROLLER_PKG_NAME}/.xr.XrHeadsetActivity ` +
				`-a android.intent.action.VIEW -d '${quotedUrl}'`;
			logDebug('Sending launch intent', { intentCmd });
			await runShellText(adb, intentCmd);
			logDebug('Launch intent sent');

			// Try to connect to the ADB socket with retries
			if (adbStreamerRef && setAdbStreamer && adb) {
				for (let socketAttempt = 0; socketAttempt < MAX_SOCKET_ATTEMPTS; socketAttempt++) {
					try {
						logDebug(`Socket connection attempt ${socketAttempt + 1}/${MAX_SOCKET_ATTEMPTS}`);

						// Wait a bit for the app to initialize and create the socket server
						await sleep(SOCKET_RETRY_DELAY_MS);

						// Create the streamer with the existing adb instance
						// Pass factory for reconnects
						const callbacks = adbCallbacksRef?.current;
						const currentAdb = adb!; // We already checked adb is non-null above
						const streamer = new AdbControllerStreamer({
							adb: currentAdb, // Use existing connection
							adbFactory: async () => {
								// Factory for reconnects only
								return openQuestAdb(manager, getCredentialStore());
							},
							socketName: ADB_SOCKET_NAME,
							log: logDebug,
							onConnectionChange: (connected) => {
								logDebug('ADB streamer connection changed:', connected);
								controllerConnectedRef.current = connected;
								callbacks?.onConnectionChange?.(connected);
								if (connected) {
									setState((prev) =>
										prev.kind === 'controller-setup'
											? {
													...prev,
													phase: 'ready',
													message: 'Controller connected via USB.',
													progressPct: null,
												}
											: prev,
									);
								}
							},
							onControllerState: (state) => {
								// Forward to XRDevice via callback
								callbacks?.onControllerState?.(state);
							},
							onOrientationReset: (hand) => {
								logDebug('Orientation reset via ADB, hand=', hand);
								callbacks?.onOrientationReset?.(hand);
							},
						});

						// Give it some time to connect
						await sleep(500);

						if (streamer.isConnected()) {
							logDebug('ADB socket connected successfully');
							adbStreamerRef.current = streamer;
							setAdbStreamer(streamer);
							socketConnected = true;
							controllerConnectedRef.current = true;
							setState((prev) =>
								prev.kind === 'controller-setup'
									? {
											...prev,
											phase: 'ready',
											message: 'Controller connected via USB.',
											progressPct: null,
										}
									: prev,
							);
							// Don't close ADB - streamer owns it now
							adb = null;
							return;
						} else {
							// Not connected yet, dispose and retry
							logDebug(`Socket not connected after attempt ${socketAttempt + 1}`);
							await streamer.dispose();
						}
					} catch (err) {
						logDebug(`Socket connection attempt ${socketAttempt + 1} failed:`, err);
						if (socketAttempt < MAX_SOCKET_ATTEMPTS - 1) {
							await sleep(SOCKET_RETRY_DELAY_MS);
						}
					}
				}
				logDebug('All socket connection attempts failed, falling back to retry loop');
			}
		} catch {
			logDebug('Launch attempt failed');
			// Ignore individual launch errors; we'll retry below.
		} finally {
			// Only close ADB if we didn't hand it off to the streamer
			if (adb) {
				await adb.close().catch(() => undefined);
			}
		}

		if (controllerConnectedRef.current || socketConnected) {
			setState((prev) =>
				prev.kind === 'controller-setup'
					? {
							...prev,
							phase: 'ready',
							message: 'Controller connected.',
							progressPct: null,
						}
					: prev,
			);
			return;
		}

		if (typeof window !== 'undefined') {
			if (launchRetryTimeoutRef.current != null) {
				window.clearTimeout(launchRetryTimeoutRef.current);
			}
			if (exhaustedPromptTimeoutRef.current != null) {
				window.clearTimeout(exhaustedPromptTimeoutRef.current);
				exhaustedPromptTimeoutRef.current = null;
			}
			launchRetryTimeoutRef.current = window.setTimeout(() => {
				void attemptLaunch();
			}, CONTROLLER_LAUNCH_RETRY_DELAY_MS);
			logDebug('Scheduled controller relaunch retry', {
				attempt,
				delayMs: CONTROLLER_LAUNCH_RETRY_DELAY_MS,
			});
		}
	};

	await attemptLaunch();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUserCancellation(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotFoundError';
}

function isTransientUsbError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return (
		msg.includes('transferin') ||
		msg.includes('transferout') ||
		msg.includes('transfer error') ||
		msg.includes('device was disconnected')
	);
}

function formatError(error: unknown): string {
	if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
		return ADB_BUSY_MESSAGE;
	}
	if (error instanceof Error) {
		return error.message || 'Unexpected error while talking to Quest.';
	}
	return 'Unexpected error while talking to Quest.';
}

/**
 * Returns true if the document is currently in fullscreen mode.
 */
function isInFullscreen(): boolean {
	if (typeof document === 'undefined') {
		return false;
	}
	const doc = document as Document & {
		webkitFullscreenElement?: Element | null;
		mozFullScreenElement?: Element | null;
		msFullscreenElement?: Element | null;
	};
	return !!(
		doc.fullscreenElement ??
		doc.webkitFullscreenElement ??
		doc.mozFullScreenElement ??
		doc.msFullscreenElement
	);
}

/**
 * Exits fullscreen mode if currently active.
 */
async function exitFullscreen(): Promise<void> {
	if (typeof document === 'undefined') {
		return;
	}
	const doc = document as Document & {
		webkitExitFullscreen?: () => Promise<void>;
		mozCancelFullScreen?: () => Promise<void>;
		msExitFullscreen?: () => Promise<void>;
	};
	const exit =
		doc.exitFullscreen ??
		doc.webkitExitFullscreen ??
		doc.mozCancelFullScreen ??
		doc.msExitFullscreen;
	if (!exit) {
		return;
	}
	try {
		await exit.call(doc);
	} catch {
		// Ignore errors exiting fullscreen
	}
}

/**
 * Requests fullscreen on the canvas container if available.
 */
async function requestFullscreen(): Promise<void> {
	if (typeof document === 'undefined') {
		return;
	}
	// Try to find the canvas container first, otherwise use documentElement
	const container =
		document.querySelector('.portal-canvas-container') ??
		document.documentElement;
	const anyContainer = container as Element & {
		requestFullscreen?: () => Promise<void>;
		webkitRequestFullscreen?: () => Promise<void>;
		mozRequestFullScreen?: () => Promise<void>;
		msRequestFullscreen?: () => Promise<void>;
	};
	const request =
		anyContainer.requestFullscreen ??
		anyContainer.webkitRequestFullscreen ??
		anyContainer.mozRequestFullScreen ??
		anyContainer.msRequestFullscreen;
	if (!request) {
		return;
	}
	try {
		await request.call(anyContainer);
	} catch {
		// Ignore errors entering fullscreen
	}
}

class QuestCredentialStore implements AdbCredentialStore {
	#cachedKey: AdbPrivateKey | null = null;

	async generateKey(): Promise<AdbPrivateKey> {
		const crypto = getWebCrypto();
		if (!crypto) {
			throw new Error('WebCrypto is not available in this browser.');
		}
		const keyPair = await crypto.subtle.generateKey(
			{
				name: 'RSASSA-PKCS1-v1_5',
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256',
			},
			true,
			['sign'],
		);
		const exported = new Uint8Array(
			await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
		);
		persistPrivateKey(exported);
		this.#cachedKey = { buffer: exported, name: QUEST_KEY_NAME };
		return this.#cachedKey;
	}

	iterateKeys(): AsyncIterable<AdbPrivateKey> {
		const loadKey = () => this.#loadKey();
		return {
			async *[Symbol.asyncIterator]() {
				const key = await loadKey();
				if (key) {
					yield key;
				}
			},
		};
	}

	async #loadKey(): Promise<AdbPrivateKey | null> {
		if (this.#cachedKey) {
			return this.#cachedKey;
		}
		const serialized = readPersistedKey();
		if (!serialized) {
			return null;
		}
		this.#cachedKey = { buffer: serialized, name: QUEST_KEY_NAME };
		return this.#cachedKey;
	}
}

function getWebCrypto(): Crypto | null {
	if (typeof globalThis === 'undefined') {
		return null;
	}
	const crypto = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto;
	return crypto ?? null;
}

function persistPrivateKey(value: Uint8Array): void {
	updateAdbUsbState((state) => ({ ...state, adbPrivateKeyPkcs8: encodeBase64(value) }));
}

function readPersistedKey(): Uint8Array | null {
	const state = readAdbUsbState();
	if (!state?.adbPrivateKeyPkcs8) {
		return null;
	}
	try {
		return decodeBase64(state.adbPrivateKeyPkcs8);
	} catch {
		return null;
	}
}

function readAdbUsbState(): AdbUsbStorageState | null {
	if (typeof window === 'undefined') {
		return null;
	}
	const config = getConfigSnapshot();
	if (!config) {
		return null;
	}
	return cloneAdbUsbState(config.adbUsb);
}

function updateAdbUsbState(
	updater: (state: AdbUsbStorageState) => AdbUsbStorageState,
): AdbUsbStorageState | null {
	if (typeof window === 'undefined') {
		return null;
	}
	const currentState = cloneAdbUsbState(getConfigSnapshot()?.adbUsb);
	const nextAdbUsb = updater(currentState);
	try {
		const updated = updatePortalEmulatorConfig({ adbUsb: nextAdbUsb });
		return cloneAdbUsbState(updated.adbUsb);
	} catch {
		return null;
	}
}

function getConfigSnapshot(): PortalEmulatorConfig | null {
	try {
		return portalConfigProvider.getConfigSync() ?? getPortalEmulatorConfig();
	} catch {
		return null;
	}
}

function cloneAdbUsbState(state: AdbUsbStorageState | null | undefined): AdbUsbStorageState {
	if (!state) {
		return { ...ADB_USB_DEFAULT_STATE };
	}
	return {
		adbPrivateKeyPkcs8:
			typeof state.adbPrivateKeyPkcs8 === 'string' && state.adbPrivateKeyPkcs8.length > 0
				? state.adbPrivateKeyPkcs8
				: null,
	};
}

function encodeBase64(bytes: Uint8Array): string {
	const base64 = (globalThis as typeof globalThis & { btoa?: typeof btoa }).btoa;
	if (typeof base64 !== 'function') {
		throw new Error('Base64 encoding is not supported in this environment.');
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return base64(binary);
}

function decodeBase64(value: string): Uint8Array {
	const decode = (globalThis as typeof globalThis & { atob?: typeof atob }).atob;
	if (typeof decode !== 'function') {
		throw new Error('Base64 decoding is not supported in this environment.');
	}
	const binary = decode(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
