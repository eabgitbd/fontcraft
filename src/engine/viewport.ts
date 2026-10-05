// Pan and zoom. Screen = (tx + x*k, ty - y*k): font units are y-up, the screen is y-down.
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type ViewState = { k: number; tx: number; ty: number };

export const MIN_K = 0.02;
export const MAX_K = 24;

export class Viewport {
  k = 1;
  tx = 0;
  ty = 0;

  toScreen(x: number, y: number): [number, number] {
    return [this.tx + x * this.k, this.ty - y * this.k];
  }
  toWorld(px: number, py: number): [number, number] {
    return [(px - this.tx) / this.k, (this.ty - py) / this.k];
  }

  /** Zooms by `factor`, keeping the world point under screen position (px, py) fixed. */
  zoomAt(px: number, py: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const [wx, wy] = this.toWorld(px, py);
    this.k = Math.min(MAX_K, Math.max(MIN_K, this.k * factor));
    this.tx = px - wx * this.k;
    this.ty = py + wy * this.k;
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  /** Fits `box` (font units) into a canvas of cw x ch CSS pixels, centred. */
  fit(cw: number, ch: number, box: Box, marginPx = 8): void {
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const k = Math.min(Math.max(1, cw - marginPx * 2) / w, Math.max(1, ch - marginPx * 2) / h);
    this.k = Math.min(MAX_K, Math.max(MIN_K, k));
    this.tx = (cw - w * this.k) / 2 - box.minX * this.k;
    this.ty = (ch - h * this.k) / 2 + box.maxY * this.k;
  }

  /** One pinch/pan step: scale about (cx, cy) then translate by (dx, dy). */
  gesture(cx: number, cy: number, scale: number, dx: number, dy: number): void {
    this.zoomAt(cx, cy, scale);
    this.panBy(dx, dy);
  }

  get state(): ViewState {
    return { k: this.k, tx: this.tx, ty: this.ty };
  }
  set(v: ViewState): void {
    this.k = v.k;
    this.tx = v.tx;
    this.ty = v.ty;
  }
}
