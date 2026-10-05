// The scanner's heavy operations, expressed over plain data so they run in a worker or directly.
import type { Contour } from '@/storage/types';
import {
  captureRect, cellRect, cellsOf, computeGrid, extractMask, hasInk, scLayout, SOFT,
  type AlignResult, type GridState, type LayoutInput, type RGBA,
} from './scan-core';
import { containMapper, customCellMapper, legacyMapper, placeWithBearings, templateCellMapper, thumbOfMask, traceField, type GlyphArt, type Metrics } from './trace';

export type ScanParams = {
  layout: LayoutInput;
  page: number;
  grid: GridState;
  adj: Record<number, { dx: number; dy: number }>;
  threshold: number;
  trim: number;
  labelStrip: boolean;
};

export type CellInfo = { gi: number; has: boolean; n: number; thumb: Uint8Array };

function readCell(img: RGBA, p: ScanParams, gi: number) {
  const L = scLayout(p.layout);
  const cell = cellsOf(L, p.page).find((c) => c.gi === gi);
  if (!cell) return null;
  const grid = computeGrid(L, p.page, p.grid);
  const R = cellRect(L, grid, p.page, cell, p.adj[gi]);
  const C = captureRect(L, grid, R, p.trim, p.labelStrip);
  return { L, mask: extractMask(img, R, C, p.threshold, SOFT) };
}

/** Thumbnails and "has handwriting" flags for the cells of a page (or just `only`). */
export function analyzeCells(img: RGBA, p: ScanParams, only?: readonly number[]): CellInfo[] {
  const L = scLayout(p.layout);
  const list = cellsOf(L, p.page).filter((c) => !only || only.includes(c.gi));
  const out: CellInfo[] = [];
  for (const c of list) {
    const r = readCell(img, p, c.gi);
    if (!r) continue;
    out.push({ gi: c.gi, has: hasInk(r.mask.n, r.mask.area), n: r.mask.n, thumb: thumbOfMask(r.mask.alpha, r.mask.w, r.mask.h, 64) });
  }
  return out;
}

/** Traces one scanned cell to vector contours placed at the default left bearing. */
export function traceScanCell(img: RGBA, p: ScanParams, gi: number, m: Metrics, tolerance = 1.5): GlyphArt | null {
  const r = readCell(img, p, gi);
  if (!r) return null;
  const map = r.L.custom ? customCellMapper(r.mask.h, m) : templateCellMapper(r.mask.h, m);
  const contours = traceField(r.mask.alpha, r.mask.w, r.mask.h, map, { tolerance });
  return placeWithBearings(contours, m);
}

/**
 * v3 glyph bitmaps (white strokes on a near-black ground, mapped by v3's exporter to the whole em box).
 * Coverage is the red channel weighted by alpha, with the iso level at v3's "red > 128" test.
 */
export function traceLegacyBitmap(img: RGBA, advance: number, m: Metrics, tolerance = 1.5): Contour[] {
  const w = img.width, h = img.height;
  const field = new Float32Array(w * h);
  for (let i = 0; i < field.length; i++) field[i] = (img.data[i * 4 + 3]! / 255) * img.data[i * 4]!;
  return traceField(field, w, h, legacyMapper(w, h, advance, m), { tolerance, level: 128 });
}

/** A dark-on-light reference picture traced inside the em box. `threshold` is the brightness cut (0..255). */
export function traceReferenceImage(img: RGBA, threshold: number, advance: number, m: Metrics, tolerance = 1.5): Contour[] {
  const w = img.width, h = img.height;
  const field = new Uint8Array(w * h);
  for (let i = 0; i < field.length; i++) {
    const p = i * 4;
    const a = img.data[p + 3]! / 255;
    // transparent pixels count as paper
    const l = (img.data[p]! * 0.299 + img.data[p + 1]! * 0.587 + img.data[p + 2]! * 0.114) * a + 255 * (1 - a);
    const v = (threshold + SOFT - l) / (2 * SOFT);
    field[i] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
  }
  return traceField(field, w, h, containMapper(w, h, advance, m), { tolerance });
}

export type { AlignResult };
