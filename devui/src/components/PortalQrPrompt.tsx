import { useEffect, useRef } from 'react';
import qrcodeGenerator from 'qrcode-generator';
import { ASSET_SWIPE_CALIBRATION } from '../generated/assets.js';
import {
	useQuestUsbDetection,
	type QuestUsbDetectionState,
} from '../hooks/useQuestUsbDetection.js';

export type PortalQrPromptProps = {
	pairingUrl: string;
	deviceName: string;
	deviceUiCode: string;
	deviceId: string;
	// Old prop `visible` is replaced by `status`. Keep it optional for back-compat but unused now.
	visible?: boolean;
	status: 'qr' | 'tracking-issues' | 'swipe' | 'hidden';
	swipeVariant?: 'base' | 'recenter' | 'trackpad' | 'quest-stick';
	searchCountdownSeconds?: number | null;
	isSearchingActively?: boolean;
	onSearchNow?: () => void;
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
}: PortalQrPromptProps): JSX.Element | null {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const questUsb = useQuestUsbDetection(status === 'qr');

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
			: status === 'tracking-issues'
				? 'Tracking issues, hold the controller still and ensure camera is clear.'
				: swipeVariant === 'recenter'
					? 'To recenter, hold the gamepad facing forward and press the Recenter button.'
				: swipeVariant === 'trackpad'
					? 'Click the controller trackpad to calibrate the controller.'
					: swipeVariant === 'quest-stick'
						? 'To calibrate, click the stick on each controller.'
						: 'To calibrate, point at screen from comfortable distance and swipe right edge.';

	const containerClassName = isSwipePrompt
		? 'portal-qr-pill portal-qr-pill--swipe'
		: 'portal-qr-pill';

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
					/>
				) : (
					<span className="portal-qr-pill__title">{title}</span>
				)}
				{status === 'qr' && (
					<canvas
						ref={canvasRef}
						className="portal-qr-pill__canvas"
						width={QR_SIZE}
						height={QR_SIZE}
						aria-label={`PortalVR pairing QR code for ${deviceName}`}
					/>
				)}
					{status === 'qr' && (
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
					<span className="portal-qr-pill__code">{deviceId}</span>
				</div>
			</aside>
	);
}

type QuestUsbInstructionsProps = {
	questState: QuestUsbDetectionState;
	onRequestPermission: () => Promise<void>;
};

function QuestUsbInstructions({
	questState,
	onRequestPermission,
}: QuestUsbInstructionsProps): JSX.Element {
	const showButton =
		questState.kind === 'needs-permission' ||
		questState.kind === 'requesting-permission';

	const handleRequest = () => {
		void onRequestPermission();
	};

	const statusClassName = buildUsbStatusClassName(questState);
	const statusLabel = buildUsbStatusLabel(questState);

	return (
		<div className="portal-qr-pill__usb-block">
			<span className="portal-qr-pill__subtitle-line">
				Connect a Meta Quest in developer mode to use tracked controllers.
			</span>
			{showButton ? (
				<button
					type="button"
					className="portal-qr-pill__usb-button"
					onClick={handleRequest}
					disabled={questState.kind === 'requesting-permission'}
				>
					{questState.kind === 'requesting-permission'
						? 'Waiting for USB approval...'
						: 'Connect via USB'}
				</button>
			) : (
				<span className={statusClassName}>{statusLabel}</span>
			)}
			<span className="portal-qr-pill__separator" aria-hidden="true">
				–or–
			</span>
			<span className="portal-qr-pill__subtitle-line">Connect to your phone:</span>
		</div>
	);
}

function buildUsbStatusLabel(state: QuestUsbDetectionState): string {
	switch (state.kind) {
		case 'quest-detected':
			return 'Quest connected via USB. Ready for updates.';
		case 'error':
			return state.message;
		case 'unsupported':
			return 'Use Chrome or Edge over HTTPS to connect via USB.';
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
	if (state.kind === 'quest-detected') {
		return `${base} portal-qr-pill__usb-status--success`;
	}
	if (state.kind === 'error') {
		return `${base} portal-qr-pill__usb-status--error`;
	}
	return base;
}
