const SCRIPT_ID = '__iwe-runtime-injected__';

const ensureRuntimeInjected = () => {
	const root =
		document.documentElement || document.head || document.body || null;
	if (!root) {
		return;
	}

	if (document.getElementById(SCRIPT_ID)) {
		return;
	}

	const script = document.createElement('script');
	script.id = SCRIPT_ID;
	script.type = 'text/javascript';
	script.src = chrome.runtime.getURL('build/iwe.min.js');
	script.async = false;
	const firstChild = root.firstChild;
	if (firstChild) {
		root.insertBefore(script, firstChild);
	} else {
		root.appendChild(script);
	}
};

ensureRuntimeInjected();
