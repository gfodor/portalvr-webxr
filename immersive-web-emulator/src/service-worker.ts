export {};

const MESSAGE_TYPE_GET_IDENTITY = 'portalvr:get-portal-device-identity';
const STORAGE_KEY = 'portalvrDeviceIdentity';
const NAME_PREFIX = 'PORTAL-';
const SUFFIX_LENGTH = 12;
const UI_SUFFIX_LENGTH = 4;
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

interface PortalDeviceIdentity {
    suffix: string;
    fullName: string;
    uiCode: string;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isIdentityRequest(message)) {
        return;
    }

    getOrCreatePortalDeviceIdentity()
        .then((identity) => sendResponse(identity))
        .catch(() => sendResponse(null));

    return true;
});

function isIdentityRequest(message: unknown): message is { type: string } {
    return (
        !!message &&
        typeof message === 'object' &&
        'type' in message &&
        (message as { type?: unknown }).type === MESSAGE_TYPE_GET_IDENTITY
    );
}

async function getOrCreatePortalDeviceIdentity(): Promise<PortalDeviceIdentity> {
    const stored = await readStoredIdentity();
    if (stored) {
        if (stored.needsUpdate) {
            await chrome.storage.local.set({ [STORAGE_KEY]: stored.identity });
        }
        return stored.identity;
    }

    const generatedSuffix = generateSuffix();
    const identity = buildIdentity(generatedSuffix);
    await chrome.storage.local.set({ [STORAGE_KEY]: identity });
    return identity;
}

async function readStoredIdentity(): Promise<
    { identity: PortalDeviceIdentity; needsUpdate: boolean } | null
> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const candidate = stored?.[STORAGE_KEY];
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const suffixValue = (candidate as { suffix?: unknown }).suffix;
    const normalizedSuffix = normalizeSuffix(
        typeof suffixValue === 'string' ? suffixValue : null,
    );
    if (!normalizedSuffix) {
        return null;
    }

    const identity = buildIdentity(normalizedSuffix);
    const needsUpdate =
        (candidate as { suffix?: unknown }).suffix !== identity.suffix ||
        (candidate as { fullName?: unknown }).fullName !== identity.fullName ||
        (candidate as { uiCode?: unknown }).uiCode !== identity.uiCode;
    return { identity, needsUpdate };
}

function buildIdentity(suffix: string): PortalDeviceIdentity {
    return {
        suffix,
        fullName: `${NAME_PREFIX}${suffix}`,
        uiCode: suffix.substring(0, UI_SUFFIX_LENGTH),
    };
}

function normalizeSuffix(candidate: string | null): string | null {
    if (!candidate) {
        return null;
    }

    const trimmed = candidate.trim().toUpperCase();
    if (trimmed.length < UI_SUFFIX_LENGTH) {
        return null;
    }

    for (let i = 0; i < trimmed.length; i += 1) {
        if (!ALPHANUM.includes(trimmed[i])) {
            return null;
        }
    }

    let result = trimmed;
    if (result.length > SUFFIX_LENGTH) {
        result = result.substring(0, SUFFIX_LENGTH);
    }

    if (result.length < SUFFIX_LENGTH) {
        const needed = SUFFIX_LENGTH - result.length;
        result += generateCharacters(needed);
    }

    return result;
}

function generateSuffix(): string {
    return generateCharacters(SUFFIX_LENGTH);
}

function generateCharacters(count: number): string {
    let output = '';
    for (let i = 0; i < count; i += 1) {
        output += randomChar();
    }
    return output;
}

function randomChar(): string {
    const alphabetLength = ALPHANUM.length;
    const cryptoObj = getCrypto();
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
        const maxValid = Math.floor(256 / alphabetLength) * alphabetLength;
        const buffer = new Uint8Array(1);
        while (true) {
            cryptoObj.getRandomValues(buffer);
            const value = buffer[0];
            if (value < maxValid) {
                return ALPHANUM.charAt(value % alphabetLength);
            }
        }
    }

    const fallback = Math.floor(Math.random() * alphabetLength);
    return ALPHANUM.charAt(fallback);
}

function getCrypto(): Crypto | null {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) {
        return globalThis.crypto;
    }
    return null;
}
