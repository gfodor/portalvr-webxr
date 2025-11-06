import { useEffect, useRef } from 'react';
import qrcodeGenerator from 'qrcode-generator';

export type PortalQrPromptProps = {
	pairingUrl: string;
	deviceName: string;
	deviceUiCode: string;
	deviceId: string;
	// Old prop `visible` is replaced by `status`. Keep it optional for back-compat but unused now.
	visible?: boolean;
	status: 'qr' | 'tracking-issues' | 'swipe' | 'hidden';
	searchCountdownSeconds?: number | null;
	isSearchingActively?: boolean;
	onSearchNow?: () => void;
};

const QR_SIZE = 384;
const QR_MARGIN = 4;

export function PortalQrPrompt({
	pairingUrl,
	deviceName,
	deviceUiCode,
	deviceId,
	status,
	searchCountdownSeconds,
	isSearchingActively = false,
	onSearchNow,
}: PortalQrPromptProps): JSX.Element | null {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
				: 'Point controller at screen and swipe from right edge';

	return (
		<aside className="portal-qr-pill" role="status" aria-live="polite">
			<span className="portal-qr-pill__title">{title}</span>
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
			{status !== 'qr' && (
				<span className="portal-qr-pill__subtitle">
					{deviceUiCode} · {deviceId}
				</span>
			)}
		</aside>
	);
}
