// Bitmap to vector. The plan allowed a Potrace WASM package or "marching squares plus fit.ts"; this is
// the second: no dependencies, sub-pixel accurate (iso-contours of the coverage field, so edges are
// not stair-stepped), and it reuses the same curve fitter as hand-drawn strokes.
import type { Contour } from '@/storage/types';
import { fitShapes } from '@/engine/geometry/fit';
import { flattenContour } from '@/engine/geometry/flatten';
import { groupRings } from '@/engine/geometry/rings';
import { signedArea, type Ring } from '@/engine/geometry/types';

/** Light [1 2 1] blur in both directions; removes single-pixel noise before contouring. */
export function blur121(src: ArrayLike<number>, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = src[y * w + Math.max(0, x - 1)]!, b = src[y * w + x]!, c = src[y * w + Math.min(w - 1, x + 1)]!;
      tmp[y * w + x] = (a + 2 * b + c) / 4;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = tmp[Math.max(0, y - 1) * w + x]!, b = tmp[y * w + x]!, c = tmp[Math.min(h - 1, y + 1) * w + x]!;
      out[y * w + x] = (a + 2 * b + c) / 4;
    }
  return out;
}

/**
 * Closed rings along the `level` iso-line of a w x h field (values >= level are inside). Coordinates are
 * in pixel units with y pointing down. The field is padded with background so shapes touching the
 * border still close.
 */
export function marchingRings(field: ArrayLike<number>, w: number, h: number, level = 127.5): Ring[] {
  const W = w + 2;
  const H = h + 2;
  const f = new Float32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[(y + 1) * W + x + 1] = field[y * w + x]!;

  // Edge ids: horizontal edge (x,y)-(x+1,y) is 2*(y*W+x); vertical edge (x,y)-(x,y+1) is 2*(y*W+x)+1.
  const hE = (x: number, y: number) => 2 * (y * W + x);
  const vE = (x: number, y: number) => 2 * (y * W + x) + 1;
  const next = new Map<number, number>();
  const seg = (a: number, b: number) => next.set(a, b);

  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const tl = f[y * W + x]!, tr = f[y * W + x + 1]!, bl = f[(y + 1) * W + x]!, br = f[(y + 1) * W + x + 1]!;
      const idx = (tl >= level ? 1 : 0) | (tr >= level ? 2 : 0) | (br >= level ? 4 : 0) | (bl >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = hE(x, y), B = hE(x, y + 1), Lf = vE(x, y), R = vE(x + 1, y);
      // Every segment is oriented with the inside on its left (y-down image coordinates).
      switch (idx) {
        case 1: seg(Lf, T); break;
        case 2: seg(T, R); break;
        case 3: seg(Lf, R); break;
        case 4: seg(R, B); break;
        case 6: seg(T, B); break;
        case 7: seg(Lf, B); break;
        case 8: seg(B, Lf); break;
        case 9: seg(B, T); break;
        case 11: seg(B, R); break;
        case 12: seg(R, Lf); break;
        case 13: seg(R, T); break;
        case 14: seg(T, Lf); break;
        case 5:
        case 10: {
          const centre = (tl + tr + bl + br) / 4 >= level; // asymptotic decider for the ambiguous saddle
          if (idx === 5) {
            if (centre) { seg(R, T); seg(Lf, B); } else { seg(Lf, T); seg(R, B); }
          } else if (centre) { seg(T, Lf); seg(B, R); } else { seg(T, R); seg(B, Lf); }
          break;
        }
      }
    }

  const point = (id: number): [number, number] => {
    const vertical = (id & 1) === 1;
    const cell = id >> 1;
    const x = cell % W;
    const y = (cell - x) / W;
    const a = f[y * W + x]!;
    const b = vertical ? f[(y + 1) * W + x]! : f[y * W + x + 1]!;
    const t = a === b ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
    return vertical ? [x - 1, y - 1 + t] : [x - 1 + t, y - 1];
  };

  const rings: Ring[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring: Ring = [];
    let cur = start;
    let guard = next.size + 2;
    while (!seen.has(cur) && guard-- > 0) {
      seen.add(cur);
      ring.push(point(cur));
      const n = next.get(cur);
      if (n === undefined) break;
      cur = n;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export type Mapper = (x: number, y: number) => [number, number];

export type TraceOptions = {
  /** Curve fitting tolerance in font units. */
  tolerance?: number;
  /** Specks smaller than this (font units squared) are dropped. */
  minArea?: number;
  /** Iso level on the 0..255 coverage field. */
  level?: number;
  blur?: boolean;
};

/** Field to vector contours, in the units the `map` function produces (font units, y-up). */
export function traceField(field: ArrayLike<number>, w: number, h: number, map: Mapper, opts: TraceOptions = {}): Contour[] {
  const f = opts.blur === false ? field : blur121(field, w, h);
  const rings = marchingRings(f, w, h, opts.level ?? 127.5).map((r) => r.map((p) => map(p[0], p[1])));
  const shapes = groupRings(rings, opts.minArea ?? 30);
  return fitShapes(shapes, { tolerance: opts.tolerance ?? 1.5 });
}

// ---- mappings from bitmap pixels to glyph units ---------------------------------------------------

export type Metrics = { ascender: number; descender: number; capheight: number; defLsb: number; defRsb: number };

/**
 * v3 stored each glyph as a PNG covering the em box, and its exporter mapped the whole image to
 * x 0..advance, y ascender..descender. This is that mapping, used to convert migrated glyphs.
 */
export function legacyMapper(w: number, h: number, advance: number, m: Metrics): Mapper {
  const range = m.ascender - m.descender;
  return (x, y) => [(x / w) * advance, m.ascender - (y / h) * range];
}

/** An image contained in the em box (reference image tracing), centred. */
export function containMapper(w: number, h: number, advance: number, m: Metrics): Mapper {
  const range = m.ascender - m.descender;
  const s = Math.min(advance / w, range / h);
  const ox = (advance - w * s) / 2;
  const oy = (range - h * s) / 2;
  return (x, y) => [ox + x * s, m.ascender - oy - y * s];
}

/**
 * A scanned template cell. The printed guide lines sit at 18% (cap), 74% (baseline) of the cell height,
 * so the baseline maps to 0 and the cap line to the project's cap height. x is made relative; the caller
 * shifts the artwork to the left bearing.
 */
export function templateCellMapper(cellH: number, m: Metrics): Mapper {
  const s = m.capheight / (0.56 * cellH);
  return (x, y) => [x * s, (0.74 * cellH - y) * s];
}

/** A custom-grid cell has no guides: the cell height spans ascender to descender. */
export function customCellMapper(cellH: number, m: Metrics): Mapper {
  const s = (m.ascender - m.descender) / cellH;
  return (x, y) => [x * s, m.ascender - y * s];
}

export type GlyphArt = { contours: Contour[]; advance: number; lsb: number; rsb: number };

/** Horizontal extent of the real curves (control points can lie outside the ink, so flatten first). */
const nodeBounds = (cs: readonly Contour[]) => {
  let minX = Infinity, maxX = -Infinity;
  for (const c of cs) for (const [x] of flattenContour(c, 0.2)) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return { minX, maxX };
};

/** Shifts artwork so its ink starts at the default left bearing, and derives the advance width. */
export function placeWithBearings(contours: Contour[], m: Pick<Metrics, 'defLsb' | 'defRsb'>): GlyphArt {
  if (!contours.length) return { contours, advance: 0, lsb: m.defLsb, rsb: m.defRsb };
  const { minX, maxX } = nodeBounds(contours);
  const dx = m.defLsb - minX;
  const moved = contours.map((c) => ({
    ...c,
    nodes: c.nodes.map((n) => ({
      ...n,
      p: { x: n.p.x + dx, y: n.p.y },
      ...(n.hIn ? { hIn: { x: n.hIn.x + dx, y: n.hIn.y } } : {}),
      ...(n.hOut ? { hOut: { x: n.hOut.x + dx, y: n.hOut.y } } : {}),
    })),
  }));
  const width = maxX - minX;
  return { contours: moved, advance: Math.round(width + m.defLsb + m.defRsb), lsb: m.defLsb, rsb: m.defRsb };
}

export const ringArea = (r: Ring) => signedArea(r);

/** Downscales a coverage mask to size x size, contain-fit and centred, for cell thumbnails. */
export function thumbOfMask(alpha: ArrayLike<number>, w: number, h: number, size = 64): Uint8Array {
  const out = new Uint8Array(size * size);
  const s = Math.min(size / w, size / h);
  const dw = w * s, dh = h * s;
  const ox = (size - dw) / 2, oy = (size - dh) / 2;
  const sum = new Float32Array(size * size);
  const cnt = new Float32Array(size * size);
  for (let y = 0; y < h; y++) {
    const ty = Math.floor(oy + y * s);
    if (ty < 0 || ty >= size) continue;
    for (let x = 0; x < w; x++) {
      const tx = Math.floor(ox + x * s);
      if (tx < 0 || tx >= size) continue;
      const k = ty * size + tx;
      sum[k] = (sum[k] ?? 0) + alpha[y * w + x]!;
      cnt[k] = (cnt[k] ?? 0) + 1;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i]! ? Math.round(sum[i]! / cnt[i]!) : 0;
  return out;
}
