import { resolveRuntimeAssetUrl } from 'portalvr';

const STYLE_ID = 'portalvr-devui-styles';

export function ensurePortalStyles(): void {
	if (typeof document === 'undefined') {
		return;
	}

	if (document.getElementById(STYLE_ID)) {
		return;
	}

	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = portalCss;
	document.head.appendChild(style);
}

// Injected CSS derived from ui-package/css/portal-ui.css with only the required selectors.
const portalCss = buildPortalCss();

function buildPortalCss(): string {
	return `
${buildFontFaceDeclaration()}
:root,
.portal-reset-boundary {
  --portal-color-scrim: rgba(0, 0, 0, 0.4);
  --portal-color-card: #061139;
  --portal-color-primary: #4c63b6;
  --portal-color-accent: #98aeeb;
  --portal-color-text-primary: #e0e8f9;
  --portal-color-text-secondary: #98aeeb;
  --portal-color-text-inverse: #ffffff;
  --portal-color-qr-pill: rgba(51, 51, 51, 0.85);
  --portal-spacing-xs: 0.25rem;
  --portal-spacing-sm: 0.5rem;
  --portal-spacing-md: 0.75rem;
  --portal-spacing-lg: 1rem;
  --portal-radius-card: 12px;
  --portal-radius-button: 12px;
  --portal-radius-pill: 20px;
  --portal-settings-icon-size: 40px;
  --portal-mode-icon-size: 72px;
}

.portal-reset-boundary {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  font-family: 'PortalInter', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: var(--portal-color-text-primary);
}

:where(.portal-reset-boundary *),
:where(.portal-reset-boundary *::before),
:where(.portal-reset-boundary *::after) {
  box-sizing: border-box;
}

:where(.portal-reset-boundary *) {
  margin: 0;
  padding: 0;
  font: inherit;
  color: inherit;
}

:where(.portal-reset-boundary a) {
  color: inherit;
  text-decoration: none;
}

:where(.portal-reset-boundary ul),
:where(.portal-reset-boundary ol) {
  list-style: none;
}

:where(.portal-reset-boundary button,
.portal-reset-boundary input,
.portal-reset-boundary textarea,
.portal-reset-boundary select) {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
}

:where(.portal-reset-boundary img),
:where(.portal-reset-boundary svg),
:where(.portal-reset-boundary picture) {
  max-width: 100%;
  display: block;
}

:where(.portal-reset-boundary canvas) {
  display: block;
  background: transparent;
  border: none;
  box-shadow: none;
}

.portal-overlay-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10000;
  font-family: 'PortalInter', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--portal-color-text-primary);
}

.portal-watermark {
  position: fixed;
  left: 0.5cm;
  bottom: 0.5cm;
  width: 250px;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  image-rendering: auto;
  display: block;
}

.portal-watermark img {
  width: 100%;
  height: auto;
  display: block;
}

.portal-top-icons {
  position: fixed;
  top: 0.5cm;
  right: 0.5cm;
  display: flex;
  gap: var(--portal-spacing-md);
  pointer-events: auto;
}

.portal-icon-button {
  width: var(--portal-settings-icon-size);
  height: var(--portal-settings-icon-size);
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: rgba(76, 99, 182, 0.8);
  cursor: pointer;
  padding: 0;
}

.portal-icon-button img {
  width: 100%;
  height: 100%;
}

.portal-settings-scrim {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--portal-color-scrim);
  pointer-events: auto;
  padding: var(--portal-spacing-lg);
}

.portal-settings-scrim[aria-hidden="false"] {
  display: flex;
}

.portal-settings-card {
  width: min(576px, 75vw);
  max-width: min(576px, 88vw);
  max-height: 100%;
  background: var(--portal-color-card);
  color: var(--portal-color-text-primary);
  border-radius: var(--portal-radius-card);
  padding: var(--portal-spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--portal-spacing-md);
  overflow-y: auto;
}

.portal-settings-card h2 {
  margin: 0;
  font-size: 1rem;
  letter-spacing: 0.02em;
}

.portal-section {
  display: flex;
  flex-direction: column;
  gap: var(--portal-spacing-sm);
}

.portal-section__heading {
  margin: 0;
  font-size: 0.875rem;
  color: var(--portal-color-text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.portal-toggle-row {
  display: flex;
  align-items: center;
  gap: var(--portal-spacing-sm);
  font-size: 0.875rem;
}

.portal-toggle-row input {
  accent-color: var(--portal-color-accent);
}

.portal-mode-toggle {
  display: flex;
  justify-content: center;
  gap: var(--portal-spacing-md);
  flex-wrap: wrap;
}

.portal-mode-button {
  width: 12.5rem;
  padding: var(--portal-spacing-md);
  border-radius: var(--portal-radius-button);
  border: 2px solid var(--portal-color-accent);
  background: var(--portal-color-primary);
  color: var(--portal-color-text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--portal-spacing-sm);
  cursor: pointer;
}

.portal-mode-button img {
  width: var(--portal-mode-icon-size);
  height: var(--portal-mode-icon-size);
}

.portal-mode-button--selected {
  border-width: 3px;
  border-color: var(--portal-color-text-inverse);
}

.portal-mode-toggle--inline {
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: var(--portal-spacing-sm);
}

.portal-mode-button--compact {
  width: auto;
  min-width: 4.5rem;
  padding: var(--portal-spacing-sm) var(--portal-spacing-md);
}

.portal-help-dialog {
  width: min(400px, 80vw);
  background: var(--portal-color-card);
  color: var(--portal-color-text-primary);
  padding: var(--portal-spacing-lg);
  border-radius: var(--portal-radius-card);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: var(--portal-spacing-md);
}

.portal-help-dialog h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--portal-color-text-inverse);
}

.portal-help-text {
  font-size: 0.875rem;
  color: var(--portal-color-text-secondary);
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: var(--portal-spacing-sm);
}

.portal-help-text p {
  margin: 0;
}

.portal-help-text a {
  color: var(--portal-color-accent);
  text-decoration: underline;
}

.portal-qr-pill {
  position: fixed;
  right: calc(0.5cm + env(safe-area-inset-right, 0px));
  bottom: calc(0.5cm + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--portal-spacing-sm);
  padding: var(--portal-spacing-sm) var(--portal-spacing-lg);
  border-radius: var(--portal-radius-pill);
  background: var(--portal-color-qr-pill);
  color: var(--portal-color-text-inverse);
  pointer-events: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.portal-qr-pill--swipe {
  flex-direction: row;
  align-items: center;
  gap: var(--portal-spacing-md);
}

.portal-qr-pill__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--portal-spacing-sm);
  text-align: center;
}

.portal-qr-pill__usb-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--portal-spacing-xs);
  max-width: 280px;
}

.portal-qr-pill__usb-row {
  display: flex;
  align-items: flex-start;
  gap: var(--portal-spacing-sm);
  flex-direction: column;
  justify-content: flex-end;
}

.portal-qr-pill__controller-icon {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  color: #dfe8ff;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
  align-self: center;
}

.portal-qr-pill__phone-row {
  display: flex;
  align-items: center;
  gap: var(--portal-spacing-sm);
}

.portal-qr-pill__phone-icon {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
}

.portal-qr-pill__subtitle-line {
  font-size: 0.85rem;
  line-height: 1.3;
}

.portal-qr-pill__separator {
  font-size: 0.72rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  opacity: 0.6;
  margin-top: var(--portal-spacing-xs);
}

.portal-qr-pill--swipe .portal-qr-pill__content {
  align-items: flex-start;
  text-align: left;
}

.portal-qr-pill__swipe-video {
  width: 125px;
  border-radius: var(--portal-radius-card);
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  object-ft: cover;
}

.portal-qr-pill__title {
  font-size: 0.875rem;
  font-weight: 600;
}

.portal-qr-pill__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--portal-spacing-sm);
  width: 100%;
}

.portal-qr-pill__usb-button {
  padding: var(--portal-spacing-xs) var(--portal-spacing-lg);
  border-radius: var(--portal-radius-button);
  border: none;
  background: var(--portal-color-text-inverse);
  color: var(--portal-color-card);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 120ms ease, transform 120ms ease;
}

.portal-qr-pill__usb-button--secondary {
  background: #4c4f57;
  color: #ffffff;
}

.portal-qr-pill__usb-button:hover:not(:disabled) {
  opacity: 0.85;
  transform: translateY(-1px);
}

.portal-qr-pill__usb-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.portal-qr-pill__search-status {
  font-size: 0.75rem;
  opacity: 0.85;
}

.portal-qr-pill__usb-status {
  font-size: 0.8rem;
  opacity: 0.85;
  text-align: center;
}

.portal-qr-pill__usb-status--success {
  color: #8de1c6;
}

.portal-qr-pill__usb-status--error {
  color: #ff9b9b;
}

.portal-qr-pill__usb-status--unsupported {
  color: #9aa0ad;
  font-size: 0.75rem;
}

.portal-qr-pill__retry-callout {
  margin-top: var(--portal-spacing-sm);
  color: #cfd4dc;
  font-size: 0.8rem;
  display: flex;
  gap: var(--portal-spacing-sm);
  align-items: center;
  justify-content: center;
  text-align: center;
  flex-wrap: wrap;
}

.portal-qr-pill__error-callout {
  background: #2f2f2f;
  color: #fff;
  padding: var(--portal-spacing-sm) var(--portal-spacing-md);
  border-radius: var(--portal-radius-card);
  text-align: center;
  line-height: 1.35;
}

.portal-qr-pill__permission-callout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--portal-spacing-sm);
}

.portal-qr-pill__permission-img {
  width: 240px;
  max-width: 100%;
  border-radius: var(--portal-radius-card);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.portal-qr-pill__hint {
  font-size: 0.7rem;
  opacity: 0.7;
  margin-top: var(--portal-spacing-xs);
}

.portal-qr-pill__search-button {
  padding: var(--portal-spacing-xs) var(--portal-spacing-md);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: var(--portal-radius-button);
  background: rgba(255, 255, 255, 0.12);
  color: var(--portal-color-text-inverse);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}

.portal-qr-pill__search-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.24);
  border-color: rgba(255, 255, 255, 0.6);
}

.portal-qr-pill__search-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.portal-qr-pill__subtitle {
  font-size: 0.75rem;
  opacity: 0.8;
}

.portal-qr-pill__code {
  font-size: 0.75rem;
  opacity: 0.85;
  letter-spacing: 0.08em;
}

.portal-qr-pill__canvas,
canvas.portal-qr-pill__canvas {
  width: 4cm;
  height: 4cm;
  position: static;
  inset: auto;
  left: auto;
  top: auto;
  right: auto;
  bottom: auto;
  z-index: auto;
  margin: 0;
  touch-action: auto;
  image-rendering: pixelated;
}

.portal-link {
  color: var(--portal-color-text-secondary);
  text-decoration: underline;
  font-weight: 600;
}

.portal-link:hover {
  text-decoration: underline;
}

.portal-settings-card a,
.portal-help-dialog a {
  text-decoration: underline;
}

.portal-reload-note {
  font-size: 0.8125rem;
  color: var(--portal-color-text-secondary);
  text-align: center;
}

.portal-mode-footer {
  text-align: center;
}

.portal-close-button {
  align-self: center;
  padding: calc(var(--portal-spacing-sm) + 4px) var(--portal-spacing-lg);
  border-radius: 8px;
  border: none;
  background: var(--portal-color-primary);
  color: var(--portal-color-text-primary);
  cursor: pointer;
}

@media (max-width: 720px) {
  .portal-mode-button {
    width: min(45vw, 11rem);
  }
}
`;
}

function buildFontFaceDeclaration(): string {
	const localFontUrl = resolveRuntimeAssetUrl('runtime/fonts/inter/Inter-Latin-Variable.woff2');
	if (localFontUrl) {
		return `
@font-face {
  font-family: 'PortalInter';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('${localFontUrl}') format('woff2');
}
`;
	}
	return "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');";
}
