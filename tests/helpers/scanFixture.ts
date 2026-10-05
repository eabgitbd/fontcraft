// Renders what a scan of the printed template looks like (same geometry as the PDF), optionally scaled
// and shifted like a slightly misaligned photograph, with simple "handwriting" in chosen cells.
import { cellsOf, pageOf, type Layout, type RGBA } from '@/scan/scan-core';

export type Ink = { x: number; y: number; w: number; h: number }; // fractions of the cell
export type FixtureOpts = { pxPerMm?: number; scale?: number; dx?: number; dy?: number; ink?: (gi: number) => Ink[] | null; rules?: boolean };

function rect(img: RGBA, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + Math.max(1, w))), y1 = Math.min(img.height, Math.round(y + Math.max(1, h)));
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      const p = (yy * img.width + xx) * 4;
      img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2]; img.data[p + 3] = 255;
    }
}

export function renderTemplate(L: Layout, page: number, o: FixtureOpts = {}): RGBA {
  const ppm = o.pxPerMm ?? 6, k = o.scale ?? 1, dx = o.dx ?? 0, dy = o.dy ?? 0;
  const img: RGBA = { width: Math.round(210 * ppm), height: Math.round(297 * ppm), data: new Uint8ClampedArray(Math.round(210 * ppm) * Math.round(297 * ppm) * 4).fill(255) };
  const X = (mm: number) => (mm * k + dx) * ppm;
  const Y = (mm: number) => (mm * k + dy) * ppm;
  const S = (mm: number) => mm * k * ppm;
  const pg = pageOf(L, page);
  // header band: dark and tall on page 1, thin on later pages
  rect(img, 0, 0, img.width, S(page === 1 ? 24 : 10) + dy * ppm, [15, 15, 17]);
  if (o.rules !== false) {
    for (const cell of cellsOf(L, page)) {
      const x = L.left + cell.c * (L.cw + L.gap), y = pg.top + cell.r * (L.ch + L.gap);
      const lw = Math.max(1, S(0.28));
      const border: [number, number, number] = [175, 175, 195];
      rect(img, X(x), Y(y), S(L.cw), lw, border);
      rect(img, X(x), Y(y + L.ch) - lw, S(L.cw), lw, border);
      rect(img, X(x), Y(y), lw, S(L.ch), border);
      rect(img, X(x + L.cw) - lw, Y(y), lw, S(L.ch), border);
      const gl = Math.max(1, S(0.15));
      const g: Array<[number, [number, number, number]]> = [[0.18, [160, 160, 240]], [0.4, [140, 190, 240]], [0.74, [160, 210, 160]], [0.88, [240, 160, 160]]];
      for (const [f, c] of g) rect(img, X(x + 1.5), Y(y + L.ch * f), S(L.cw - 3), gl, c);
      const ink = o.ink?.(cell.gi);
      if (ink) for (const r of ink) rect(img, X(x + r.x * L.cw), Y(y + r.y * L.ch), S(r.w * L.cw), S(r.h * L.ch), [10, 10, 12]);
    }
  }
  return img;
}

/** A recognisable stand-in for a letter: a vertical stem and a crossbar. */
export const stem = (): Ink[] => [{ x: 0.4, y: 0.2, w: 0.08, h: 0.55 }, { x: 0.3, y: 0.42, w: 0.3, h: 0.07 }];
