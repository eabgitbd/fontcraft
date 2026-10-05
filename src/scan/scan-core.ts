// Pure port of v3's scanner (`scLayout`, `scCells`, grid geometry, `scProcess`, `scDetectPage`,
// `scAutoAlign`). Same algorithms and default values as v3; no DOM, so it runs in a worker and in tests.
import { charsForSet, type CharSetId } from '@/app/charsets';

export type RGBA = { data: Uint8ClampedArray; width: number; height: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type PageSpec = { top: number; start: number; rows: number; count: number };
export type Layout = { custom: boolean; cols: number; cw: number; ch: number; gap: number; left: number; pw: number; ph: number; chars: string[]; pages: PageSpec[] };
export type Cell = { i: number; r: number; c: number; gi: number };

export type LayoutInput = {
  mode: 'template' | 'custom';
  custom?: { cols: number; rows: number; chars: readonly string[] };
  project?: { set: string; cell: string };
};

/** Columns per template row for each cell size. v3 used small, medium and large. */
export const CELL_COLS: Record<string, number> = { small: 6, medium: 4, standard: 4, large: 3 };
export const colsFor = (cell: string | undefined): number => CELL_COLS[cell ?? 'medium'] ?? 4;

/** Characters printed on the template for a project, in print order (identical to what the PDF uses). */
export const templateChars = (set: string): string[] => charsForSet((set in { latin: 1, bengali: 1, 'bengali-ext': 1, 'latin-ext': 1, all: 1 } ? set : 'all') as CharSetId);

export function scLayout(input: LayoutInput): Layout {
  if (input.mode === 'custom') {
    const cols = Math.max(1, input.custom?.cols ?? 6);
    const rows = Math.max(1, input.custom?.rows ?? 8);
    const left = 6, top = 30, pw = 210, ph = 297;
    return { custom: true, cols, cw: (pw - left * 2) / cols, ch: (ph - top - 8) / rows, gap: 0, left, pw, ph, chars: [...(input.custom?.chars ?? [])], pages: [{ top, start: 0, rows, count: cols * rows }] };
  }
  const set = input.project?.set ?? 'latin';
  const isBn = set.includes('bengali');
  const cols = colsFor(input.project?.cell);
  const margin = 12, pw = 210, ph = 297;
  const cw = Math.floor((pw - margin * 2) / cols);
  const gap = 2;
  const chars = templateChars(set);
  const pages: PageSpec[] = [];
  let y = isBn ? 35 : 31;
  let cur: PageSpec = { top: y, start: 0, rows: 0, count: 0 };
  let col = 0;
  chars.forEach((_c, idx) => {
    if (y + cw > ph - 8) {
      pages.push(cur);
      y = 14;
      cur = { top: 14, start: idx, rows: 0, count: 0 };
      col = 0;
    }
    if (col === 0) cur.rows++;
    col++;
    if (col >= cols) {
      col = 0;
      y += cw + gap;
    }
  });
  pages.push(cur);
  pages.forEach((p, i) => {
    p.count = Math.min(p.rows * cols, (pages[i + 1] ? pages[i + 1]!.start : chars.length) - p.start);
  });
  return { custom: false, cols, cw, ch: cw, gap, left: margin, pw, ph, chars, pages };
}

/** 1-based page number, clamped to the pages that exist. */
export const pageOf = (L: Layout, page: number): PageSpec => L.pages[Math.min(Math.max(1, page), L.pages.length) - 1]!;

export function cellsOf(L: Layout, page: number): Cell[] {
  const pg = pageOf(L, page);
  const list: Cell[] = [];
  for (let r = 0; r < pg.rows; r++)
    for (let c = 0; c < L.cols; c++) {
      const i = r * L.cols + c;
      if (i >= pg.count) break;
      list.push({ i, r, c, gi: pg.start + i });
    }
  return list;
}

// ---- grid geometry (millimetres on the page to image pixels) ----------------------------------

export type Base = { px0: number; py0: number; sx: number; sy: number };
export type GridState = { base: Base; ox: number; oy: number; k: number };

export function defaultBase(W: number, H: number): Base {
  const a = W / H;
  const a4 = 210 / 297;
  if (Math.abs(a / a4 - 1) < 0.04) return { px0: 0, py0: 0, sx: W / 210, sy: H / 297 };
  const s = W / 210;
  return { px0: 0, py0: 0, sx: s, sy: s };
}

export const initialGrid = (W: number, H: number): GridState => ({ base: defaultBase(W, H), ox: 0, oy: 0, k: 1 });

export function computeGrid(L: Layout, page: number, g: GridState): Base {
  const pg = pageOf(L, page);
  const b = g.base;
  const sx = b.sx * g.k;
  const sy = b.sy * g.k;
  const pX = b.px0 + L.left * b.sx;
  const pY = b.py0 + pg.top * b.sy; // pivot = top-left of the first cell
  return { sx, sy, px0: pX + g.ox - L.left * sx, py0: pY + g.oy - pg.top * sy };
}

export function cellRect(L: Layout, grid: Base, page: number, cell: Cell, adj?: { dx: number; dy: number }): Rect {
  const pg = pageOf(L, page);
  const a = adj ?? { dx: 0, dy: 0 };
  const mx = L.left + cell.c * (L.cw + L.gap) + a.dx;
  const my = pg.top + cell.r * (L.ch + L.gap) + a.dy;
  return { x: grid.px0 + mx * grid.sx, y: grid.py0 + my * grid.sy, w: L.cw * grid.sx, h: L.ch * grid.sy };
}

/** The part of a cell that is read: trimmed by `trimMm`, and without the printed label strip. */
export function captureRect(L: Layout, grid: Base, R: Rect, trimMm: number, labelStrip: boolean): Rect {
  const lab = labelStrip && !L.custom ? 2.8 : 0;
  return { x: R.x + trimMm * grid.sx, y: R.y + trimMm * grid.sy, w: Math.max(2, R.w - 2 * trimMm * grid.sx), h: Math.max(2, R.h - (2 * trimMm + lab) * grid.sy) };
}

// ---- reading a cell -------------------------------------------------------------------------

export type Mask = { w: number; h: number; alpha: Uint8Array; n: number; area: number };

export const SOFT = 24;
export const DEFAULTS = { threshold: 128, trim: 1, labelStrip: true } as const;

const luma = (d: Uint8ClampedArray, p: number) => d[p]! * 0.299 + d[p + 1]! * 0.587 + d[p + 2]! * 0.114;

/**
 * Ink coverage (0..255) of one cell at full image resolution, as v3's `scProcess` computed it: a soft
 * threshold around `thr` so edges stay smooth, restricted to the capture rectangle. Pixels outside the
 * image count as paper.
 */
export function extractMask(img: RGBA, R: Rect, C: Rect, thr: number, soft = SOFT): Mask {
  const ox = Math.round(R.x), oy = Math.round(R.y);
  const ow = Math.max(2, Math.round(R.w)), oh = Math.max(2, Math.round(R.h));
  const alpha = new Uint8Array(ow * oh);
  const cx0 = Math.max(0, Math.round(C.x - ox)), cy0 = Math.max(0, Math.round(C.y - oy));
  const cx1 = Math.min(ow, Math.round(C.x + C.w - ox)), cy1 = Math.min(oh, Math.round(C.y + C.h - oy));
  let n = 0;
  for (let y = cy0; y < cy1; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = cx0; x < cx1; x++) {
      const sx = ox + x;
      if (sx < 0 || sx >= img.width) continue;
      const l = luma(img.data, (sy * img.width + sx) * 4);
      let a = (thr + soft - l) / (2 * soft);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      if (a >= 0.5) n++;
      alpha[y * ow + x] = Math.round(a * 255);
    }
  }
  return { w: ow, h: oh, alpha, n, area: Math.max(1, (cx1 - cx0) * (cy1 - cy0)) };
}

export const hasInk = (n: number, area: number): boolean => n >= Math.max(20, area * 0.0005);

// ---- page and alignment ---------------------------------------------------------------------

/** Multi-page templates: page 1 has a dark header band, page 2 and later a thin one. */
export function detectPage(img: RGBA, L: Layout): { page: number; dark: boolean } {
  if (L.custom || L.pages.length < 2) return { page: 1, dark: true };
  const W = img.width, H = img.height;
  const x0 = Math.round(W * 0.15), x1 = Math.round(W * 0.85);
  const y0 = Math.round(H * 0.02), y1 = Math.max(y0 + 1, Math.round(H * 0.065));
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x += 4) {
      s += luma(img.data, (y * W + x) * 4);
      n++;
    }
  const dark = s / Math.max(1, n) < 90;
  return { page: dark ? 1 : 2, dark };
}

/** Box-filter downscale (area average). */
export function downscale(img: RGBA, ww: number, wh: number): RGBA {
  if (ww === img.width && wh === img.height) return img;
  const out = new Uint8ClampedArray(ww * wh * 4);
  const W = img.width, H = img.height;
  for (let dy = 0; dy < wh; dy++) {
    const y0 = Math.floor((dy * H) / wh), y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * H) / wh));
    for (let dx = 0; dx < ww; dx++) {
      const x0 = Math.floor((dx * W) / ww), x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * W) / ww));
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (let y = y0; y < y1 && y < H; y++)
        for (let x = x0; x < x1 && x < W; x++) {
          const p = (y * W + x) * 4;
          r += img.data[p]!; g += img.data[p + 1]!; b += img.data[p + 2]!; a += img.data[p + 3]!;
          c++;
        }
      const q = (dy * ww + dx) * 4;
      out[q] = r / c; out[q + 1] = g / c; out[q + 2] = b / c; out[q + 3] = a / c;
    }
  }
  return { data: out, width: ww, height: wh };
}

/** Rotates by `quarters` x 90 degrees clockwise. */
export function rotate90(img: RGBA, quarters: number): RGBA {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return img;
  const W = img.width, H = img.height;
  const ow = q === 2 ? W : H, oh = q === 2 ? H : W;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [nx, ny] = q === 1 ? [H - 1 - y, x] : q === 2 ? [W - 1 - x, H - 1 - y] : [y, W - 1 - x];
      const s = (y * W + x) * 4, d = (ny * ow + nx) * 4;
      out[d] = img.data[s]!; out[d + 1] = img.data[s + 1]!; out[d + 2] = img.data[s + 2]!; out[d + 3] = img.data[s + 3]!;
    }
  return { data: out, width: ow, height: oh };
}

export type AlignResult = { ok: boolean; okX: boolean; okY: boolean; cx: number; cy: number; base: Base };

/**
 * Fits the template's printed rules to the scan (scale and offset on each axis), as v3's `scAutoAlign`:
 * only mid-grey rule pixels count, black ink and the pale guide letters are ignored, and the plain page
 * layout is kept unless the fitted layout is clearly better.
 */
export function autoAlign(img: RGBA, L: Layout, page: number): AlignResult {
  const none = (): AlignResult => ({ ok: false, okX: false, okY: false, cx: 0, cy: 0, base: defaultBase(img.width, img.height) });
  if (L.custom) return none();
  const pg = pageOf(L, page);
  const f = Math.min(1, 1600 / img.width);
  const ww = Math.max(60, Math.round(img.width * f)), wh = Math.max(60, Math.round(img.height * f));
  const sm = downscale(img, ww, wh);
  const d = sm.data;
  const colP = new Float32Array(ww), rowP = new Float32Array(wh);
  const yA = Math.round(wh * 0.12), yB = Math.round(wh * 0.95), xA = Math.round(ww * 0.06), xB = Math.round(ww * 0.96);
  const hdr = Math.round(wh * (pg.top > 20 ? 0.095 : 0.04));
  for (let y = 0; y < wh; y++)
    for (let x = 0; x < ww; x++) {
      const v = 255 - luma(d, (y * ww + x) * 4);
      if (v < 32 || v > 150) continue;
      if (y >= yA && y < yB) colP[x]! += v;
      if (x >= xA && x < xB && y >= hdr) rowP[y]! += v;
    }
  const prep = (a: Float32Array) => {
    const n = a.length;
    const cs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i]! + a[i]!;
    const o = new Float32Array(n);
    const R = 8;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - R), i1 = Math.min(n, i + R + 1);
      const m = (cs[i1]! - cs[i0]!) / (i1 - i0);
      o[i] = Math.max(0, a[i]! - m);
    }
    const q = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) q[i] = (o[i - 1]! + 2 * o[i]! + o[i + 1]!) / 4;
    return q;
  };
  const colS = prep(colP), rowS = prep(rowP);
  const at = (a: Float32Array, p: number) => {
    const i = Math.floor(p);
    if (i < 1 || i >= a.length - 2) return 0;
    const fr = p - i;
    return a[i]! * (1 - fr) + a[i + 1]! * fr;
  };
  const mean = (a: Float32Array, i0: number, i1: number) => {
    let s = 0;
    for (let i = i0; i < i1; i++) s += a[i]!;
    return s / Math.max(1, i1 - i0);
  };
  const search = (lines: (s: number, o: number) => number, s0: number, offMax: number) => {
    const def = lines(s0, 0);
    let best = { sc: -1, s: s0, o: 0 };
    for (let k = 0.9; k <= 1.1001; k += 0.002) {
      const s = s0 * k;
      for (let o = -offMax; o <= offMax; o += 1) {
        const v = lines(s, o);
        if (v > best.sc) best = { sc: v, s, o };
      }
    }
    if (best.sc < def * 1.1) best = { sc: def, s: s0, o: 0 }; // prefer the plain page layout unless clearly better
    return best;
  };
  const s0x = ww / L.pw;
  const offX = Math.min(0.12 * ww, 0.45 * (L.cw + L.gap) * s0x);
  const bx = search((s, o) => {
    let sum = 0;
    for (let c = 0; c < L.cols; c++) {
      const x1 = o + (L.left + c * (L.cw + L.gap)) * s;
      sum += at(colS, x1) + at(colS, x1 + L.cw * s);
    }
    return sum;
  }, s0x, offX);
  const cx = bx.sc / (2 * L.cols) / Math.max(1e-6, mean(colS, xA, xB));
  const s0y = wh / L.ph;
  const offY = Math.min(0.12 * wh, 0.45 * (L.ch + L.gap) * s0y);
  const fr = [0, 0.18, 0.4, 0.74, 0.88, 1];
  const by = search((s, o) => {
    let sum = 0;
    for (let r = 0; r < pg.rows; r++) {
      const y0 = o + (pg.top + r * (L.ch + L.gap)) * s;
      for (const q of fr) sum += at(rowS, y0 + q * L.ch * s);
    }
    return sum;
  }, s0y, offY);
  const cy = by.sc / (fr.length * pg.rows) / Math.max(1e-6, mean(rowS, hdr, wh));
  const okX = cx > 1.6, okY = cy > 1.6;
  const b = defaultBase(img.width, img.height);
  if (okX) {
    b.sx = bx.s / f;
    b.px0 = bx.o / f;
    if (!okY) b.sy = b.sx;
  }
  if (okY) {
    b.sy = by.s / f;
    b.py0 = by.o / f;
    if (!okX) b.sx = b.sy;
  }
  return { ok: okX && okY, okX, okY, cx, cy, base: b };
}
