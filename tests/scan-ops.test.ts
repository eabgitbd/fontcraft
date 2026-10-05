import { describe, expect, it } from 'vitest';
import { DirectEngine, createScanEngine, type ScanParams } from '@/scan/engine';
import { analyzeCells, traceLegacyBitmap, traceReferenceImage, traceScanCell } from '@/scan/scan-ops';
import { initialGrid, scLayout, type LayoutInput, type RGBA } from '@/scan/scan-core';
import { flattenContour } from '@/engine/geometry/flatten';
import { signedArea } from '@/engine/geometry/types';
import type { Contour } from '@/storage/types';
import { renderTemplate, stem } from './helpers/scanFixture';

const M = { ascender: 800, descender: -200, capheight: 700, defLsb: 50, defRsb: 50 };
const layout: LayoutInput = { mode: 'template', project: { set: 'latin', cell: 'medium' } };
const bounds = (cs: Contour[]) => {
  const pts = cs.flatMap((c) => flattenContour(c, 0.2));
  return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
};
const params = (img: RGBA, over: Partial<ScanParams> = {}): ScanParams => ({ layout, page: 1, grid: initialGrid(img.width, img.height), adj: {}, threshold: 128, trim: 1, labelStrip: true, ...over });

describe('analyzing a page', () => {
  const only = new Set([0, 3, 7]);
  const scan = renderTemplate(scLayout(layout), 1, { ink: (gi) => (only.has(gi) ? stem() : null) });
  const cells = analyzeCells(scan, params(scan));

  it('returns one entry per cell on the page', () => {
    expect(cells).toHaveLength(20);
    expect(cells.map((c) => c.gi)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
  it('flags exactly the cells with handwriting', () => {
    expect(cells.filter((c) => c.has).map((c) => c.gi)).toEqual([0, 3, 7]);
  });
  it('thumbnails are 64 x 64 coverage maps that show the ink', () => {
    const t = cells[0]!.thumb;
    expect(t).toHaveLength(64 * 64);
    expect(Math.max(...t)).toBe(255);
    expect(Math.max(...cells[1]!.thumb)).toBe(0);
  });
  it('can analyze a single cell', () => {
    const one = analyzeCells(scan, params(scan), [3]);
    expect(one).toHaveLength(1);
    expect(one[0]!.has).toBe(true);
  });
});

describe('tracing a scanned cell', () => {
  const scan = renderTemplate(scLayout(layout), 1, { ink: (gi) => (gi === 0 ? stem() : null) });
  const art = traceScanCell(scan, params(scan), 0, M)!;

  it('produces vector contours (one connected shape for a stem with a crossbar)', () => {
    expect(art.contours).toHaveLength(1);
    expect(art.contours[0]!.closed).toBe(true);
    expect(art.contours[0]!.nodes.length).toBeLessThan(40);
  });
  it('maps the printed guide lines to the font metrics: baseline to 0, cap line to the cap height', () => {
    const b = bounds(art.contours);
    // the stem was drawn from 20% to 75% of the cell: cap line is at 18%, baseline at 74%
    expect(b.maxY).toBeGreaterThan(700 * 0.9);
    expect(b.maxY).toBeLessThan(700 * 1.05);
    expect(b.minY).toBeGreaterThan(-30);
    expect(b.minY).toBeLessThan(10);
  });
  it('places the ink at the left bearing and derives advance and bearings', () => {
    const b = bounds(art.contours);
    expect(b.minX).toBeCloseTo(50, 0);
    expect(art.lsb).toBe(50);
    expect(art.rsb).toBe(50);
    expect(art.advance).toBeCloseTo(b.maxX - b.minX + 100, -1);
  });
  it('outer contours are clockwise, as the font format expects', () => {
    expect(signedArea(flattenContour(art.contours[0]!, 0.2))).toBeLessThan(0);
  });
  it('an empty cell traces to nothing', () => {
    expect(traceScanCell(scan, params(scan), 1, M)!.contours).toEqual([]);
  });
  it('an unknown cell index gives null', () => {
    expect(traceScanCell(scan, params(scan), 999, M)).toBeNull();
  });
  it('a higher cap height scales the glyph up proportionally', () => {
    const tall = traceScanCell(scan, params(scan), 0, { ...M, capheight: 1400 })!;
    expect(bounds(tall.contours).maxY).toBeCloseTo(bounds(art.contours).maxY * 2, -1);
  });
  it('custom grids span ascender to descender', () => {
    const custom: LayoutInput = { mode: 'custom', custom: { cols: 6, rows: 8, chars: ['A'] } };
    const cl = scLayout(custom);
    const img = renderTemplate(cl, 1, { ink: (gi) => (gi === 0 ? [{ x: 0.1, y: 0, w: 0.8, h: 1 }] : null), rules: true });
    const a = traceScanCell(img, { ...params(img), layout: custom }, 0, M)!;
    expect(a.contours.length).toBeGreaterThan(0);
  });
});

describe('tracing a v3 glyph bitmap (migration)', () => {
  /** A v3-style glyph image: near-black ground, white strokes. */
  const bitmap = (w: number, h: number, ink: (x: number, y: number) => boolean): RGBA => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4, v = ink(x, y) ? 255 : 15; data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255; }
    return { data, width: w, height: h };
  };

  it('maps the whole image to 0..advance and ascender..descender, as v3 export did', () => {
    // a block covering x 25..75% and y 25..75% of a 200 x 200 image
    const img = bitmap(200, 200, (x, y) => x >= 50 && x < 150 && y >= 50 && y < 150);
    const cs = traceLegacyBitmap(img, 600, M);
    const b = bounds(cs);
    expect(b.minX).toBeCloseTo(150, -1);
    expect(b.maxX).toBeCloseTo(450, -1);
    expect(b.maxY).toBeCloseTo(800 - 250, -1);
    expect(b.minY).toBeCloseTo(800 - 750, -1);
  });
  it('transparent pixels count as background', () => {
    const img = bitmap(100, 100, () => true);
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = 0;
    expect(traceLegacyBitmap(img, 500, M)).toEqual([]);
  });
  it('an empty bitmap traces to nothing', () => {
    expect(traceLegacyBitmap(bitmap(64, 64, () => false), 500, M)).toEqual([]);
  });
  it('keeps a hole (an "O" shape) as an outer contour plus a counter', () => {
    const img = bitmap(200, 200, (x, y) => { const d = Math.hypot(x - 100, y - 100); return d < 80 && d > 40; });
    const cs = traceLegacyBitmap(img, 500, M);
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => Math.sign(signedArea(flattenContour(c, 0.2)))).sort()).toEqual([-1, 1]);
  });
});

describe('tracing a reference picture', () => {
  const picture = (w: number, h: number, ink: (x: number, y: number) => boolean): RGBA => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4, v = ink(x, y) ? 30 : 245; data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255; }
    return { data, width: w, height: h };
  };
  it('traces dark ink on light paper, contained and centred in the em box', () => {
    const img = picture(300, 150, (x, y) => x > 100 && x < 200 && y > 40 && y < 110);
    const b = bounds(traceReferenceImage(img, 128, 500, M));
    expect(b.minX).toBeGreaterThan(0);
    expect(b.maxX).toBeLessThan(500);
    expect(b.maxY).toBeLessThan(800);
    expect(b.minY).toBeGreaterThan(-200);
  });
  it('a lower threshold ignores faint marks that a higher threshold keeps', () => {
    const img = picture(200, 200, () => false);
    for (let y = 60; y < 140; y++) for (let x = 90; x < 110; x++) { const p = (y * 200 + x) * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = 170; }
    expect(traceReferenceImage(img, 100, 500, M)).toEqual([]);
    expect(traceReferenceImage(img, 200, 500, M).length).toBeGreaterThan(0);
  });
  it('a blank picture traces to nothing', () => {
    expect(traceReferenceImage(picture(50, 50, () => false), 128, 500, M)).toEqual([]);
  });
});

describe('DirectEngine', () => {
  it('runs the whole flow and refuses to work before an image is loaded', async () => {
    const e = new DirectEngine();
    await expect(e.analyze(params({ width: 1, height: 1, data: new Uint8ClampedArray(4) }))).rejects.toThrow(/No scan/);
    const scan = renderTemplate(scLayout(layout), 1, { scale: 1.03, dx: 4, dy: 3, ink: (gi) => (gi < 6 ? stem() : null) });
    expect(await e.load(scan)).toEqual({ width: scan.width, height: scan.height });
    expect((await e.detectPage(layout)).page).toBe(1);
    const al = await e.align(layout, 1);
    expect(al.ok).toBe(true);
    const cells = await e.analyze(params(scan, { grid: { base: al.base, ox: 0, oy: 0, k: 1 } }));
    expect(cells.filter((c) => c.has).map((c) => c.gi)).toEqual([0, 1, 2, 3, 4, 5]);
    e.dispose();
    await expect(e.detectPage(layout)).rejects.toThrow();
  });
  it('rotation changes the image the engine works on', async () => {
    const e = new DirectEngine();
    await e.load({ width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) });
    expect(await e.rotate(1)).toEqual({ width: 2, height: 4 });
  });
  it('createScanEngine falls back to the in-process engine when workers are unavailable', () => {
    expect(createScanEngine()).toBeInstanceOf(DirectEngine); // jsdom/node has no OffscreenCanvas
  });
});
