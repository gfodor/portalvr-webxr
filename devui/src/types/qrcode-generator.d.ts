declare module 'qrcode-generator' {
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  interface QRCode {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }

  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;

  export default qrcode;
}
