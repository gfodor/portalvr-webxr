import { useEffect, useRef, useState } from 'react';
import qrcodeGenerator from 'qrcode-generator';
import { ASSET_SWIPE_CALIBRATION } from '../generated/assets.js';
import {
	useQuestUsbDetection,
	ADB_BUSY_MESSAGE,
	type QuestUsbDetectionState,
	type AdbControllerCallbacks,
} from '../hooks/useQuestUsbDetection.js';
import type { AdbControllerStreamer } from 'portalvr';
import {
	QUEST_USB_PERMISSION_DATA_URI,
	VR_CONTROLLERS_DATA_URI,
	PHONE_CONTROLLER_DATA_URI,
} from '../assets/embedded.js';

export type PortalQrPromptProps = {
	pairingUrl: string;
	deviceName: string;
	deviceUiCode: string;
	deviceId: string;
	// Old prop `visible` is replaced by `status`. Keep it optional for back-compat but unused now.
	visible?: boolean;
	status: 'qr' | 'tracking-issues' | 'focus-lost' | 'swipe' | 'hidden';
	swipeVariant?: 'base' | 'recenter' | 'trackpad' | 'quest-stick';
	searchCountdownSeconds?: number | null;
	isSearchingActively?: boolean;
	onSearchNow?: () => void;
	controllerConnected?: boolean;
	isOpenxrQuest?: boolean;
	onFirstControllerLaunch?: () => void;
	/** Callbacks for ADB controller state - wire these to XRDevice */
	adbControllerCallbacks?: AdbControllerCallbacks;
	/** Called when ADB streamer is created/disposed */
	onAdbStreamerChange?: (streamer: AdbControllerStreamer | null) => void;
};

const QR_SIZE = 384;
const QR_MARGIN = 4;

export function PortalQrPrompt({
	pairingUrl,
	deviceName,
	deviceId,
	status,
	swipeVariant = 'base',
	searchCountdownSeconds,
	isSearchingActively = false,
	onSearchNow,
	controllerConnected = false,
	isOpenxrQuest = false,
	onFirstControllerLaunch,
	adbControllerCallbacks,
	onAdbStreamerChange,
}: PortalQrPromptProps): JSX.Element | null {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const prevAdbStreamerRef = useRef<AdbControllerStreamer | null>(null);
	const questUsb = useQuestUsbDetection(
		status === 'qr',
		pairingUrl,
		controllerConnected,
		onFirstControllerLaunch,
		adbControllerCallbacks,
	);

	// Notify parent when ADB streamer changes
	useEffect(() => {
		if (questUsb.adbStreamer !== prevAdbStreamerRef.current) {
			prevAdbStreamerRef.current = questUsb.adbStreamer;
			onAdbStreamerChange?.(questUsb.adbStreamer);
		}
	}, [questUsb.adbStreamer, onAdbStreamerChange]);
	const handleManualRetry = () => {
		questUsb.restartLaunchLoop();
	};
	const questDetectedViaUsb =
		questUsb.state.kind === 'quest-detected' ||
		questUsb.state.kind === 'controller-setup';
	const waitingForUsbAuth =
		questUsb.state.kind === 'waiting' &&
		typeof questUsb.state.message === 'string' &&
		(questUsb.state.message.toLowerCase().includes('quest detected over usb') ||
		 questUsb.state.message.toLowerCase().includes('usb link ready') ||
		 questUsb.state.message.toLowerCase().includes('usb debugging'));
	const showPhoneSection = !(
		questDetectedViaUsb ||
		waitingForUsbAuth ||
		questUsb.state.kind === 'controller-setup' ||
		questUsb.state.kind === 'error'
	);

	const showUsbIconColumn =
		questUsb.state.kind === 'needs-permission' || questUsb.state.kind === 'idle';

	const showQrVisuals = status === 'qr' && (showPhoneSection || questUsb.state.kind === 'needs-permission');

	useEffect(() => {
		if (status !== 'qr') {
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const qr = qrcodeGenerator(0, 'M');
		qr.addData(pairingUrl);
		qr.make();

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return;
		}

		canvas.width = QR_SIZE;
		canvas.height = QR_SIZE;

		ctx.clearRect(0, 0, QR_SIZE, QR_SIZE);
		ctx.fillStyle = 'rgb(191, 191, 191)';
		ctx.fillRect(0, 0, QR_SIZE, QR_SIZE);
		ctx.fillStyle = '#000000';

		const moduleCount = qr.getModuleCount();
		const tileSize = QR_SIZE / (moduleCount + QR_MARGIN * 2);

		for (let row = 0; row < moduleCount; row += 1) {
			for (let col = 0; col < moduleCount; col += 1) {
				if (!qr.isDark(row, col)) {
					continue;
				}
				const x = Math.round((col + QR_MARGIN) * tileSize);
				const y = Math.round((row + QR_MARGIN) * tileSize);
				const size = Math.ceil(tileSize);
				ctx.fillRect(x, y, size, size);
			}
		}

		return () => {
			ctx.clearRect(0, 0, QR_SIZE, QR_SIZE);
		};
	}, [pairingUrl, status]);

	if (status === 'hidden') {
		return null;
	}

	const isSwipePrompt = status === 'swipe';
	const showSwipeVideo = isSwipePrompt && swipeVariant === 'base';
	const clampedCountdown =
		searchCountdownSeconds != null ? Math.max(0, searchCountdownSeconds) : null;

	const footerLabel = isSearchingActively
		? 'Searching...'
		: clampedCountdown != null
			? `Searching in ${clampedCountdown}s`
			: 'Searching...';

	const title =
		status === 'qr'
			? `Scan to pair ${deviceName}`
			: status === 'focus-lost'
				? 'Controller app lost focus. Try clicking the system/Oculus/Meta button or checking the headset.'
				: status === 'tracking-issues'
					? isOpenxrQuest
						? 'Check your headset. Tracking issues detected, maybe due to a popup.'
						: 'Tracking issues, hold the controller still and ensure camera is clear.'
					: swipeVariant === 'recenter'
						? 'To recenter, hold the gamepad facing forward and press the Recenter button.'
						: swipeVariant === 'trackpad'
							? 'Click the controller trackpad to calibrate the controller.'
							: swipeVariant === 'quest-stick'
								? 'Press and hold the Menu button (left controller) to recenter your controllers.'
								: 'To calibrate, point at screen from comfortable distance and swipe right edge.';

	const containerClassName = isSwipePrompt
		? 'portal-qr-pill portal-qr-pill--swipe'
		: 'portal-qr-pill';

	// Hide footer (Searching...) when Quest is detected via USB - that's only for SIGCF
	const showFooter = status === 'qr' && !questDetectedViaUsb && !waitingForUsbAuth;

	return (
		<aside className={containerClassName} role="status" aria-live="polite">
				{showSwipeVideo && (
					<video
					className="portal-qr-pill__swipe-video"
					src={ASSET_SWIPE_CALIBRATION}
					width={75}
					muted
					autoPlay
					loop
					playsInline
					aria-hidden="true"
				/>
			)}
			<div className="portal-qr-pill__content">
				{status === 'qr' ? (
					<QuestUsbInstructions
						questState={questUsb.state}
						onRequestPermission={questUsb.requestPermission}
						onManualRetry={handleManualRetry}
						showPhoneSection={showPhoneSection}
						showUsbIconColumn={showUsbIconColumn}
				/>
				) : (
					<span className="portal-qr-pill__title">{title}</span>
				)}
				{showQrVisuals && (
					<canvas
						ref={canvasRef}
						className="portal-qr-pill__canvas"
						width={QR_SIZE}
						height={QR_SIZE}
						aria-label={`PortalVR pairing QR code for ${deviceName}`}
					/>
				)}
					{showFooter && (
						<div className="portal-qr-pill__footer">
							<span className="portal-qr-pill__search-status">{footerLabel}</span>
							{!isSearchingActively && onSearchNow && clampedCountdown != null && (
								<button
									type="button"
									className="portal-qr-pill__search-button"
									onClick={onSearchNow}
								>
									Search Now
								</button>
							)}
						</div>
					)}
					{showQrVisuals && <span className="portal-qr-pill__code">{deviceId}</span>}
				</div>
			</aside>
	);
}

type QuestUsbInstructionsProps = {
	questState: QuestUsbDetectionState;
	onRequestPermission: () => Promise<void>;
	showPhoneSection: boolean;
	showUsbIconColumn: boolean;
	onManualRetry: () => void;
};

const USB_APPROVAL_DELAY_MS = 3000;

function QuestUsbInstructions({
	questState,
	onRequestPermission,
	showPhoneSection,
	showUsbIconColumn,
	onManualRetry,
}: QuestUsbInstructionsProps): JSX.Element {
	const showButton = questState.kind === 'needs-permission';

	const isWaitingForPermission = questState.kind === 'requesting-permission';
	const needsUsbApproval =
		questState.kind === 'waiting' &&
		typeof questState.message === 'string' &&
		questState.message.toLowerCase().includes('quest detected over usb');

	// Delay showing the USB approval prompt by 3 seconds to avoid flashing it briefly
	const [showUsbApprovalPrompt, setShowUsbApprovalPrompt] = useState(false);
	useEffect(() => {
		if (!needsUsbApproval) {
			setShowUsbApprovalPrompt(false);
			return;
		}
		const timer = setTimeout(() => {
			setShowUsbApprovalPrompt(true);
		}, USB_APPROVAL_DELAY_MS);
		return () => clearTimeout(timer);
	}, [needsUsbApproval]);

	const handleRequest = () => {
		void onRequestPermission();
	};

	const statusClassName = buildUsbStatusClassName(questState);
	const statusLabel =
		'message' in questState &&
		typeof questState.message === 'string' &&
		questState.message.length > 0
			? questState.message
			: buildUsbStatusLabel(questState);

	const showProgressBar =
		questState.kind === 'controller-setup' &&
		(questState.phase === 'downloading' || questState.phase === 'installing');
	const progressPct =
		questState.kind === 'controller-setup' &&
		typeof questState.progressPct === 'number'
			? Math.max(0, Math.min(100, questState.progressPct))
			: null;

	return (
		<div className="portal-qr-pill__usb-row">
			{showUsbIconColumn && (
				<img
					src={VR_CONTROLLERS_DATA_URI}
					alt="VR controller icon"
					className="portal-qr-pill__controller-icon"
				/>
			)}
			<div className="portal-qr-pill__usb-block">
			{showUsbIconColumn && (
				<span className="portal-qr-pill__subtitle-line">
					Connect a Quest in{'\u00a0'}
					<a
						href="https://www.youtube.com/watch?v=kRpZGBhWxis"
						target="_blank"
						rel="noreferrer"
						className="portal-link"
					>
						developer mode
					</a>{'\u00a0'}
					to use tracked controllers.
				</span>
			)}
				{showButton ? (
					<button
					type="button"
					className="portal-qr-pill__usb-button"
					onClick={handleRequest}
					disabled={isWaitingForPermission}
				>
					{isWaitingForPermission ? 'Waiting for USB approval...' : 'Connect via USB'}
				</button>
				) : (
					<>
					{showUsbApprovalPrompt ? (
						<div className="portal-qr-pill__error-callout portal-qr-pill__permission-callout">
							<span>Put on your headset and choose &ldquo;Always allow from this computer&rdquo;.</span>
							<img
								src={QUEST_USB_PERMISSION_DATA_URI}
								alt="Quest USB permission prompt showing the 'Always allow from this computer' checkbox"
									className="portal-qr-pill__permission-img"
								/>
							<span className="portal-qr-pill__hint">Stuck? Try re-plugging in.</span>
							</div>
						) : questState.kind === 'error' && statusLabel === ADB_BUSY_MESSAGE ? (
							<div className="portal-qr-pill__error-callout">{ADB_BUSY_MESSAGE}</div>
						) : (
							<span className={statusClassName}>{statusLabel}</span>
						)}
					{showProgressBar && progressPct != null && (
						<div
							className="portal-qr-pill__progress"
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={progressPct}
						>
							<div
								className="portal-qr-pill__progress-fill"
								style={{ width: `${progressPct}%` }}
							/>
						</div>
						)}
					{questState.kind === 'controller-setup' && questState.showRetryPrompt && (
						<div className="portal-qr-pill__retry-callout">
							<span>
								Please check the headset for any notifications or popups and ensure it is connected to Wifi, then click Retry.
							</span>
							<button
								type="button"
								className="portal-qr-pill__usb-button portal-qr-pill__usb-button--secondary"
								onClick={onManualRetry}
							>
								Retry
							</button>
						</div>
					)}
				</>
			)}
			{showPhoneSection && (
				<>
					<span className="portal-qr-pill__separator" aria-hidden="true">
						–or–
					</span>
					<div className="portal-qr-pill__phone-row">
						<img
							src={PHONE_CONTROLLER_DATA_URI}
							alt="Phone controller icon"
							className="portal-qr-pill__phone-icon"
						/>
						<span className="portal-qr-pill__subtitle-line">
							Use your phone as a controller:
						</span>
					</div>
				</>
			)}
		</div>
		</div>
	);
}

function buildUsbStatusLabel(state: QuestUsbDetectionState): string {
	switch (state.kind) {
		case 'quest-detected':
			return 'Quest connected via USB. Preparing controller app...';
		case 'requesting-permission':
			return 'Waiting for USB approval...';
		case 'controller-setup': {
			switch (state.phase) {
				case 'checking':
					return (
						state.message ??
						'Checking controller app on Quest...'
					);
				case 'downloading':
					return state.message ?? 'Downloading controller app...';
				case 'installing':
					return state.message ?? 'Installing controller app...';
				case 'launching':
					return state.message ?? 'Launching controller...';
				case 'ready':
					return (
						state.message ??
						'Controller app installed and ready.'
					);
				default:
					return 'Preparing controller app...';
			}
		}
		case 'error':
			return state.message;
		case 'unsupported':
			return state.reason === 'no-webusb'
				? 'USB connectivity unsupported, try a Chrome, Edge, or Brave'
				: 'Use Chrome or Edge over HTTPS to connect via USB.';
		case 'waiting':
			return state.message ?? 'Looking for Quest over USB...';
		case 'idle':
			return 'Checking USB support...';
		default:
			return 'Looking for Quest over USB...';
	}
}

function buildUsbStatusClassName(state: QuestUsbDetectionState): string {
	const base = 'portal-qr-pill__usb-status';
	if (
		state.kind === 'quest-detected' ||
		(state.kind === 'controller-setup' && state.phase === 'ready')
	) {
		return `${base} portal-qr-pill__usb-status--success`;
	}
	if (state.kind === 'error') {
		return `${base} portal-qr-pill__usb-status--error`;
	}
	if (state.kind === 'unsupported') {
		return `${base} portal-qr-pill__usb-status--unsupported`;
	}
	return base;
}
