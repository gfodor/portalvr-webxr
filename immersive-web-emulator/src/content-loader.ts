export {};

const RUNTIME_SCRIPT_ID = '__iwe-runtime-injected__';
const IDENTITY_SCRIPT_ID = '__iwe-portal-identity-injected__';
const MESSAGE_TYPE_GET_IDENTITY = 'portalvr:get-portal-device-identity';

interface PortalDeviceIdentity {
	suffix: string;
	fullName?: string;
	uiCode?: string;
}

const ensureRuntimeInjected = async () => {
	const root =
		document.documentElement || document.head || document.body || null;
	if (!root) {
		return;
	}

	if (document.getElementById(RUNTIME_SCRIPT_ID)) {
		return;
	}

	const identity = await requestPortalDeviceIdentity();
	if (identity?.suffix) {
		injectIdentityOverride(root, identity);
	}

	injectRuntimeScript(root);
};

function injectRuntimeScript(root: Element) {
	if (document.getElementById(RUNTIME_SCRIPT_ID)) {
		return;
	}

	const script = document.createElement('script');
	script.id = RUNTIME_SCRIPT_ID;
	script.type = 'text/javascript';
	script.src = chrome.runtime.getURL('build/iwe.min.js');
	script.async = false;

	const identityScript = document.getElementById(IDENTITY_SCRIPT_ID);
	if (identityScript && identityScript.parentNode) {
		identityScript.parentNode.insertBefore(script, identityScript.nextSibling);
		return;
	}

	const firstChild = root.firstChild;
	if (firstChild) {
		root.insertBefore(script, firstChild);
	} else {
		root.appendChild(script);
	}
}

function injectIdentityOverride(root: Element, identity: PortalDeviceIdentity) {
	if (document.getElementById(IDENTITY_SCRIPT_ID)) {
		return;
	}

	const script = document.createElement('script');
	script.id = IDENTITY_SCRIPT_ID;
	script.type = 'text/javascript';
	script.src = chrome.runtime.getURL('build/identity-bootstrap.js');
	script.dataset.identity = JSON.stringify(identity);
	const firstChild = root.firstChild;
	if (firstChild) {
		root.insertBefore(script, firstChild);
	} else {
		root.appendChild(script);
	}
}

function requestPortalDeviceIdentity(): Promise<PortalDeviceIdentity | null> {
	if (!chrome.runtime?.id) {
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage(
				{ type: MESSAGE_TYPE_GET_IDENTITY },
				(response?: unknown) => {
					if (chrome.runtime.lastError) {
						resolve(null);
						return;
					}

					if (
						response &&
						typeof response === 'object' &&
						typeof (response as { suffix?: unknown }).suffix === 'string'
					) {
						const normalized: PortalDeviceIdentity = {
							suffix: (response as { suffix: string }).suffix,
							fullName:
								typeof (response as { fullName?: unknown }).fullName === 'string'
									?
										(response as { fullName: string }).fullName
									: undefined,
							uiCode:
								typeof (response as { uiCode?: unknown }).uiCode === 'string'
									?
										(response as { uiCode: string }).uiCode
									: undefined,
						};
						resolve(normalized);
						return;
					}

					resolve(null);
				},
			);
		} catch (_) {
			resolve(null);
		}
	});
}

void ensureRuntimeInjected();
