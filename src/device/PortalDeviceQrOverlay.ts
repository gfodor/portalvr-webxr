import QRCode from 'qrcode';

interface PortalDeviceQrOverlayOptions {
  parent: HTMLElement;
  pairingUrl: string;
  deviceName: string;
  deviceUiCode: string;
  deviceId: string;
}

const QR_SIZE = 192;
const QR_MARGIN = 4;

export class PortalDeviceQrOverlay {
  private readonly container: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly subtitle: HTMLDivElement;
  private url: string;
  private visible = false;
  private renderPromise: Promise<void> | null = null;
  private lastRenderedUrl: string | null = null;

  constructor(options: PortalDeviceQrOverlayOptions) {
    const { parent, pairingUrl, deviceName, deviceUiCode, deviceId } = options;
    this.url = pairingUrl;
    this.container = document.createElement('div');
    this.container.style.position = 'absolute';
    this.container.style.bottom = '16px';
    this.container.style.right = '16px';
    this.container.style.display = 'none';
    this.container.style.zIndex = '10000';
    this.container.style.pointerEvents = 'none';

    this.panel = document.createElement('div');
    this.panel.style.display = 'flex';
    this.panel.style.flexDirection = 'column';
    this.panel.style.alignItems = 'center';
    this.panel.style.gap = '8px';
    this.panel.style.padding = '12px';
    this.panel.style.borderRadius = '12px';
    this.panel.style.background = 'rgba(0, 0, 0, 0.75)';
    this.panel.style.color = '#ffffff';
    this.panel.style.fontFamily = 'sans-serif';
    this.panel.style.fontSize = '13px';
    this.panel.style.lineHeight = '1.3';
    this.panel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)';
    this.panel.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.textContent = `Scan to pair ${deviceName}`;
    title.style.fontWeight = '600';
    title.style.textAlign = 'center';

    this.subtitle = document.createElement('div');
    this.subtitle.textContent = `${deviceUiCode} · ${deviceId}`;
    this.subtitle.style.opacity = '0.8';
    this.subtitle.style.textAlign = 'center';
    this.subtitle.style.fontSize = '12px';

    this.canvas = document.createElement('canvas');
    this.canvas.width = QR_SIZE;
    this.canvas.height = QR_SIZE;
    this.canvas.style.width = `${QR_SIZE}px`;
    this.canvas.style.height = `${QR_SIZE}px`;
    this.canvas.style.imageRendering = 'pixelated';

    this.panel.appendChild(title);
    this.panel.appendChild(this.canvas);
    this.panel.appendChild(this.subtitle);
    this.container.appendChild(this.panel);
    parent.appendChild(this.container);

    void this.renderIfNeeded();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) {
      return;
    }
    this.visible = visible;
    this.container.style.display = visible ? 'block' : 'none';
    if (visible) {
      void this.renderIfNeeded();
    }
  }

  setPairingUrl(url: string): void {
    if (url === this.url) {
      return;
    }
    this.url = url;
    this.lastRenderedUrl = null;
    if (this.visible) {
      void this.renderIfNeeded();
    }
  }

  setDeviceLabel(deviceId: string, uiCode: string): void {
    this.subtitle.textContent = `${uiCode} · ${deviceId}`;
  }

  dispose(): void {
    this.container.remove();
  }

  private async renderIfNeeded(): Promise<void> {
    if (!this.url || this.url === this.lastRenderedUrl) {
      return;
    }
    if (this.renderPromise) {
      await this.renderPromise;
      return;
    }
    this.renderPromise = QRCode.toCanvas(this.canvas, this.url, {
      width: QR_SIZE,
      margin: QR_MARGIN,
      color: {
        dark: '#000000ff',
        light: '#ffffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then(() => {
        this.lastRenderedUrl = this.url;
      })
      .catch((error: unknown) => {
        console.error('[PortalDeviceQrOverlay] Failed to render QR code', error);
      })
      .finally(() => {
        this.renderPromise = null;
      });
    await this.renderPromise;
  }
}
