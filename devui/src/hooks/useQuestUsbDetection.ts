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
} from 'portalvr';

const QUEST_VENDOR_IDS = [0x2833];
const QUEST_DEVICE_FILTERS: USBDeviceFilter[] = QUEST_VENDOR_IDS.map((vendorId) => ({
	vendorId,
}));

const QUEST_KEY_NAME = 'PortalVR WebADB';
const POLL_INTERVAL_MS = 4000;

type AdbUsbStorageState = PortalEmulatorConfig['adbUsb'];

const ADB_USB_DEFAULT_STATE: AdbUsbStorageState = {
	adbPrivateKeyPkcs8: null,
};

export type QuestUsbUnsupportedReason = 'no-webusb' | 'insecure-context';

export type QuestUsbDetectionState =
	| { kind: 'idle' }
	| { kind: 'unsupported'; reason: QuestUsbUnsupportedReason }
	| { kind: 'needs-permission' }
	| { kind: 'requesting-permission' }
	| { kind: 'waiting'; message?: string }
	| { kind: 'quest-detected'; model?: string; manufacturer?: string }
	| { kind: 'error'; message: string };

export type QuestUsbDetectionResult = {
	state: QuestUsbDetectionState;
	requestPermission: () => Promise<void>;
	hasPermission: boolean;
};

type QuestInfo = {
	model?: string;
	manufacturer?: string;
};

export function useQuestUsbDetection(enabled: boolean): QuestUsbDetectionResult {
	const manager = useMemo(() => AdbDaemonWebUsbDeviceManager.BROWSER, []);
	const [state, setState] = useState<QuestUsbDetectionState>({ kind: 'idle' });
	const [hasPermission, setHasPermission] = useState(false);
	const questDetectedRef = useRef(false);
	const credentialStoreRef = useRef<QuestCredentialStore | null>(null);

	useEffect(() => {
		questDetectedRef.current = state.kind === 'quest-detected';
	}, [state.kind]);

	const ensureCredentialStore = useCallback(() => {
		if (!credentialStoreRef.current) {
			credentialStoreRef.current = new QuestCredentialStore();
		}
		return credentialStoreRef.current;
	}, []);

	useEffect(() => {
		if (!enabled) {
			setState({ kind: 'idle' });
			setHasPermission(false);
			questDetectedRef.current = false;
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

		let cancelled = false;

		const initializePermission = async () => {
			try {
				const devices = await manager.getDevices({ filters: QUEST_DEVICE_FILTERS });
				if (cancelled) {
					return;
				}
				if (devices.length > 0) {
					setHasPermission(true);
					setState({ kind: 'waiting', message: 'Looking for Quest over USB...' });
				} else {
					setHasPermission(false);
					setState({ kind: 'needs-permission' });
				}
			} catch (error) {
				if (!cancelled) {
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

		const schedule = () => {
			if (!cancelled && !questDetectedRef.current) {
				timeoutId = window.setTimeout(runPoll, POLL_INTERVAL_MS);
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
						prev.kind === 'quest-detected'
							? prev
							: {
								kind: 'waiting',
								message: 'Waiting for Quest to be connected...',
							},
					);
					return;
				}
				setState((prev) =>
					prev.kind === 'quest-detected'
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
				if (!cancelled && !questDetectedRef.current) {
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
			if (timeoutId != null) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [enabled, ensureCredentialStore, hasPermission, manager]);

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

		setState({ kind: 'requesting-permission' });
		try {
			const device = await manager.requestDevice({ filters: QUEST_DEVICE_FILTERS });
			if (!device) {
				setState({ kind: 'needs-permission' });
				return;
			}
			setHasPermission(true);
			setState({ kind: 'waiting', message: 'Looking for Quest over USB...' });
		} catch (error) {
			if (isUserCancellation(error)) {
				setState({ kind: 'needs-permission' });
				return;
			}
			setState({ kind: 'error', message: formatError(error) });
		}
	}, [enabled, manager]);

	return {
		state,
		hasPermission,
		requestPermission,
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

function isQuestProduct(value: {
	model: string;
	manufacturer: string;
	brand: string;
}): boolean {
	if (/quest/i.test(value.model)) {
		return true;
	}
	const manufacturerMatch = /(meta|oculus)/i;
	return manufacturerMatch.test(value.manufacturer) || manufacturerMatch.test(value.brand);
}

function sanitize(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function isUserCancellation(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotFoundError';
}

function formatError(error: unknown): string {
	if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
		return 'USB device is busy. Close any other adb tools and try again.';
	}
	if (error instanceof Error) {
		return error.message || 'Unexpected error while talking to Quest.';
	}
	return 'Unexpected error while talking to Quest.';
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
