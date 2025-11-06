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
const portalCss = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
:root {
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

.portal-overlay-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10000;
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--portal-color-text-primary);
}

.portal-watermark {
  position: fixed;
  left: 0.5cm;
  bottom: 0.5cm;
  width: clamp(120px, 12.5vw, 180px);
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  image-rendering: auto;
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
  color: var(--portal-color-accent);
  opacity: 0.85;
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
}

.portal-settings-scrim[aria-hidden="false"] {
  display: flex;
}

.portal-settings-card {
  width: min(576px, 75vw);
  max-width: min(576px, 88vw);
  background: var(--portal-color-card);
  color: var(--portal-color-text-primary);
  border-radius: var(--portal-radius-card);
  padding: var(--portal-spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--portal-spacing-md);
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

.portal-help-dialog {
  width: min(320px, 80vw);
  background: var(--portal-color-card);
  color: var(--portal-color-text-primary);
  padding: var(--portal-spacing-lg);
  border-radius: var(--portal-radius-card);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: var(--portal-spacing-md);
}

.portal-help-text {
  font-size: 0.875rem;
  color: var(--portal-color-text-secondary);
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

.portal-qr-pill__title {
  font-size: 0.875rem;
  font-weight: 600;
}

.portal-qr-pill__subtitle {
  font-size: 0.75rem;
  opacity: 0.8;
}

.portal-qr-pill__canvas {
  width: 4cm;
  height: 4cm;
  image-rendering: pixelated;
}

.portal-link {
  color: var(--portal-color-text-secondary);
  text-decoration: none;
  font-weight: 600;
}

.portal-link:hover {
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
