export class OneEuroFilter {
  private prevValue = Number.NaN;
  private prevDeriv = 0;
  private prevTime = Number.NaN;

  constructor(
    private freq: number,
    private minCutoff = 1.0,
    private beta = 0.0,
    private dCutoff = 1.0,
  ) {}

  public setBeta(newBeta: number): void {
    this.beta = newBeta;
  }

  public shift(delta: number): void {
    if (!Number.isNaN(this.prevValue)) {
      this.prevValue += delta;
    }
  }

  public reset(): void {
    this.prevValue = Number.NaN;
    this.prevDeriv = 0;
    this.prevTime = Number.NaN;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  public filter(value: number, timestampSeconds: number): number {
    if (Number.isNaN(this.prevTime)) {
      this.prevTime = timestampSeconds;
      this.prevValue = value;
      this.prevDeriv = 0.0;
      return value;
    }

    const dt = Math.max(timestampSeconds - this.prevTime, 1e-12);
    this.prevTime = timestampSeconds;
    this.freq = 1.0 / dt;

    const deriv = (value - this.prevValue) * this.freq;
    const alphaDer = this.alpha(this.dCutoff, dt);
    const smDeriv = (1.0 - alphaDer) * this.prevDeriv + alphaDer * deriv;

    const cutoff = this.minCutoff + this.beta * Math.abs(smDeriv);
    const alphaPos = this.alpha(cutoff, dt);
    const smValue = (1.0 - alphaPos) * this.prevValue + alphaPos * value;

    this.prevValue = smValue;
    this.prevDeriv = smDeriv;
    return smValue;
  }
}
