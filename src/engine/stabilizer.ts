// One-euro filter based stabiliser (0 = off, 100 = heavy smoothing). Runs on input points
// before they are stored, so saved strokes are already smooth and rendering is deterministic.

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  get last(): number | null {
    return this.y;
  }
}

const alphaFor = (cutoff: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private xf = new LowPass();
  private dxf = new LowPass();
  private lastX: number | null = null;
  private lastT = 0;
  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff = 1,
  ) {}
  filter(x: number, tMs: number): number {
    if (this.lastX === null) {
      this.lastX = x;
      this.lastT = tMs;
      return this.xf.filter(x, 1);
    }
    const dt = Math.max(0.001, (tMs - this.lastT) / 1000);
    const dx = (x - this.lastX) / dt;
    const edx = this.dxf.filter(dx, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.lastX = x;
    this.lastT = tMs;
    return this.xf.filter(x, alphaFor(cutoff, dt));
  }
}

export type Sample = { x: number; y: number };

/** Smooths a stream of points. Coordinates are in screen pixels so the feel does not depend on zoom. */
export class Stabilizer {
  private fx: OneEuro | null = null;
  private fy: OneEuro | null = null;

  constructor(readonly amount: number) {}

  get active(): boolean {
    return this.amount > 0;
  }

  reset(): void {
    this.fx = this.fy = null;
  }

  push(x: number, y: number, tMs: number): Sample {
    if (!this.active) return { x, y };
    if (!this.fx || !this.fy) {
      const a = Math.min(100, Math.max(0, this.amount)) / 100;
      // 8 Hz (almost raw) down to 0.4 Hz (very smooth); beta keeps fast strokes responsive.
      const minCutoff = 8 * Math.pow(0.4 / 8, a);
      const beta = 0.004 + 0.02 * (1 - a);
      this.fx = new OneEuro(minCutoff, beta);
      this.fy = new OneEuro(minCutoff, beta);
    }
    return { x: this.fx.filter(x, tMs), y: this.fy.filter(y, tMs) };
  }
}
