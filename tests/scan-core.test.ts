import { describe, expect, it } from 'vitest';
import { autoAlign, captureRect, cellRect, cellsOf, computeGrid, defaultBase, detectPage, downscale, extractMask, hasInk, initialGrid, pageOf, rotate90, scLayout, templateChars, type RGBA } from '@/scan/scan-core';
import { renderTemplate, stem } from './helpers/scanFixture';

const latin = (cell = 'medium') => scLayout({ mode: 'template', project: { set: 'latin', cell } });

describe('layout (mirrors the printed template)', () => {
  it('latin, medium cells: 4 columns of 46 mm, 3 pages of 20, 20 and 12 cells', () => {
    const L = latin();
    expect(L.cols).toBe(4);
    expect(L.cw).toBe(46);
    expect(L.chars).toHaveLength(52);
    expect(L.pages.map((p) => p.count)).toEqual([20, 20, 12]);
    expect(L.pages.map((p) => p.top)).toEqual([31, 14, 14]);
    expect(L.pages.map((p) => p.start)).toEqual([0, 20, 40]);
  });
  it('cell sizes change the column count (small 6, medium 4, large 3)', () => {
    expect(latin('small').cols).toBe(6);
    expect(latin('large').cols).toBe(3);
    expect(latin('standard').cols).toBe(4);
    expect(latin('???').cols).toBe(4);
  });
  it('Bengali templates start lower to make room for the longer header', () => {
    const L = scLayout({ mode: 'template', project: { set: 'bengali', cell: 'medium' } });
    expect(L.pages[0]!.top).toBe(35);
    expect(L.chars).toHaveLength(76);
    expect(L.pages.reduce((n, p) => n + p.count, 0)).toBe(76);
  });
  it('every character is on exactly one page, in print order', () => {
    for (const set of ['latin', 'bengali', 'bengali-ext', 'latin-ext', 'all']) {
      const L = scLayout({ mode: 'template', project: { set, cell: 'small' } });
      const seen: number[] = [];
      L.pages.forEach((_, i) => cellsOf(L, i + 1).forEach((c) => seen.push(c.gi)));
      expect(seen).toEqual(L.chars.map((_, i) => i));
    }
  });
  it('an unknown set falls back to everything, like the PDF', () => {
    expect(templateChars('weird')).toEqual(templateChars('all'));
  });
  it('custom grids use the whole sheet, no gaps, no label strip', () => {
    const L = scLayout({ mode: 'custom', custom: { cols: 6, rows: 8, chars: ['A', 'B'] } });
    expect(L.custom).toBe(true);
    expect(L.gap).toBe(0);
    expect(L.pages).toHaveLength(1);
    expect(L.pages[0]!.count).toBe(48);
    expect(L.cw).toBeCloseTo(33, 6);
    expect(cellsOf(L, 1)).toHaveLength(48);
  });
  it('pageOf clamps out-of-range page numbers', () => {
    const L = latin();
    expect(pageOf(L, 0)).toBe(L.pages[0]);
    expect(pageOf(L, 99)).toBe(L.pages[2]);
  });
});

describe('grid geometry', () => {
  it('an A4-shaped image maps millimetres straight to pixels', () => {
    const b = defaultBase(1260, 1782);
    expect(b.sx).toBeCloseTo(6, 6);
    expect(b.sy).toBeCloseTo(6, 6);
  });
  it('a non-A4 image keeps square pixels based on its width', () => {
    const b = defaultBase(1000, 1000);
    expect(b.sx).toBe(b.sy);
  });
  it('the first cell lands at its printed position', () => {
    const L = latin();
    const g = computeGrid(L, 1, initialGrid(1260, 1782));
    const r = cellRect(L, g, 1, cellsOf(L, 1)[0]!);
    expect(r.x).toBeCloseTo(12 * 6, 4);
    expect(r.y).toBeCloseTo(31 * 6, 4);
    expect(r.w).toBeCloseTo(46 * 6, 4);
  });
  it('offset and zoom move the grid about the first cell', () => {
    const L = latin();
    const base = initialGrid(1260, 1782);
    const g = computeGrid(L, 1, { ...base, ox: 10, oy: -5, k: 1.1 });
    const r0 = cellRect(L, g, 1, cellsOf(L, 1)[0]!);
    expect(r0.x).toBeCloseTo(12 * 6 + 10, 4); // pivot is the first cell's corner
    expect(r0.y).toBeCloseTo(31 * 6 - 5, 4);
    expect(r0.w).toBeCloseTo(46 * 6 * 1.1, 4);
  });
  it('a per-cell nudge moves only that cell rectangle', () => {
    const L = latin();
    const g = computeGrid(L, 1, initialGrid(1260, 1782));
    const c = cellsOf(L, 1)[1]!;
    const a = cellRect(L, g, 1, c), b = cellRect(L, g, 1, c, { dx: 1, dy: 2 });
    expect(b.x - a.x).toBeCloseTo(6, 6);
    expect(b.y - a.y).toBeCloseTo(12, 6);
  });
  it('capture trims the border and drops the printed label strip', () => {
    const L = latin();
    const g = computeGrid(L, 1, initialGrid(1260, 1782));
    const R = cellRect(L, g, 1, cellsOf(L, 1)[0]!);
    const withLabel = captureRect(L, g, R, 1, true), without = captureRect(L, g, R, 1, false);
    expect(withLabel.x).toBeCloseTo(R.x + 6, 6);
    expect(without.h - withLabel.h).toBeCloseTo(2.8 * 6, 6);
    const C = scLayout({ mode: 'custom', custom: { cols: 6, rows: 8, chars: [] } });
    const gc = computeGrid(C, 1, initialGrid(1260, 1782));
    const Rc = cellRect(C, gc, 1, cellsOf(C, 1)[0]!);
    expect(captureRect(C, gc, Rc, 1, true).h).toBeCloseTo(captureRect(C, gc, Rc, 1, false).h, 6);
  });
});

describe('reading cells', () => {
  const L = latin();
  const inked = new Set([0, 2, 5]);
  const scan = renderTemplate(L, 1, { ink: (gi) => (inked.has(gi) ? stem() : null) });
  const grid = computeGrid(L, 1, initialGrid(scan.width, scan.height));
  const read = (gi: number) => {
    const c = cellsOf(L, 1).find((x) => x.gi === gi)!;
    const R = cellRect(L, grid, 1, c);
    return extractMask(scan, R, captureRect(L, grid, R, 1, true), 128);
  };

  it('finds the handwriting in inked cells and nothing in blank ones', () => {
    for (let gi = 0; gi < 20; gi++) {
      const m = read(gi);
      expect(hasInk(m.n, m.area), `cell ${gi}`).toBe(inked.has(gi));
    }
  });
  it('printed rules and guide lines are not mistaken for ink', () => {
    const m = read(1);
    expect(m.n).toBe(0);
  });
  it('the mask covers the whole cell and ink pixels are fully covered', () => {
    const m = read(0);
    expect(m.w).toBe(Math.round(46 * 6));
    expect(m.alpha.length).toBe(m.w * m.h);
    expect(Math.max(...m.alpha)).toBe(255);
  });
  it('a cell partly outside the image does not crash and counts the outside as paper', () => {
    const g2 = computeGrid(L, 1, { ...initialGrid(scan.width, scan.height), ox: -400, oy: -400 });
    const c = cellsOf(L, 1)[0]!;
    const R = cellRect(L, g2, 1, c);
    expect(() => extractMask(scan, R, captureRect(L, g2, R, 1, true), 128)).not.toThrow();
  });
  it('a higher threshold reads more as ink (faint pencil)', () => {
    const faint: RGBA = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(255) };
    for (let y = 10; y < 30; y++) for (let x = 18; x < 22; x++) { const p = (y * 40 + x) * 4; faint.data[p] = faint.data[p + 1] = faint.data[p + 2] = 170; }
    const R = { x: 0, y: 0, w: 40, h: 40 };
    // ink is anything at or below the threshold in brightness; the faint stroke is brightness 170
    expect(extractMask(faint, R, R, 100).n).toBe(0);
    expect(extractMask(faint, R, R, 185).n).toBeGreaterThan(50);
  });
  it('hasInk needs at least 20 pixels and a minimum share of the cell', () => {
    expect(hasInk(19, 100)).toBe(false);
    expect(hasInk(20, 100)).toBe(true);
    expect(hasInk(100, 1_000_000)).toBe(false);
    expect(hasInk(600, 1_000_000)).toBe(true);
  });
});

describe('page detection', () => {
  const L = latin();
  it('page 1 has the dark header band, later pages a thin one', () => {
    expect(detectPage(renderTemplate(L, 1), L).page).toBe(1);
    expect(detectPage(renderTemplate(L, 2), L).page).toBe(2);
  });
  it('single-page and custom layouts are always page 1', () => {
    const C = scLayout({ mode: 'custom', custom: { cols: 6, rows: 8, chars: [] } });
    expect(detectPage(renderTemplate(L, 2), C).page).toBe(1);
  });
});

describe('auto-align', () => {
  const L = latin();
  const inkSet = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const trueBase = (ppm: number, k: number, dx: number, dy: number) => ({ sx: k * ppm, sy: k * ppm, px0: dx * ppm, py0: dy * ppm });

  it('recovers scale and offset of a misaligned scan', () => {
    const k = 1.03, dx = 4, dy = -3, ppm = 6;
    const scan = renderTemplate(L, 1, { scale: k, dx, dy, ink: (gi) => (inkSet.has(gi) ? stem() : null) });
    const res = autoAlign(scan, L, 1);
    const t = trueBase(ppm, k, dx, dy);
    expect(res.ok).toBe(true);
    expect(Math.abs(res.base.sx / t.sx - 1)).toBeLessThan(0.006);
    expect(Math.abs(res.base.sy / t.sy - 1)).toBeLessThan(0.006);
    expect(Math.abs(res.base.px0 - t.px0)).toBeLessThan(4);
    expect(Math.abs(res.base.py0 - t.py0)).toBeLessThan(4);
  });

  it('after aligning, handwriting is read from exactly the right cells', () => {
    const k = 1.03, dx = 5, dy = 4;
    const only = new Set([0, 5, 10, 15]);
    const scan = renderTemplate(L, 1, { scale: k, dx, dy, ink: (gi) => (only.has(gi) ? stem() : null) });
    const al = autoAlign(scan, L, 1);
    const hits = (base: typeof al.base) => {
      const found: number[] = [];
      for (const c of cellsOf(L, 1)) {
        const R = cellRect(L, base, 1, c);
        const m = extractMask(scan, R, captureRect(L, base, R, 1, true), 128);
        if (hasInk(m.n, m.area)) found.push(c.gi);
      }
      return found;
    };
    expect(hits(computeGrid(L, 1, { base: al.base, ox: 0, oy: 0, k: 1 }))).toEqual([0, 5, 10, 15]);
  });

  it('an unshifted, unscaled scan stays on the plain page layout', () => {
    const scan = renderTemplate(L, 1);
    const res = autoAlign(scan, L, 1);
    expect(Math.abs(res.base.sx - 6)).toBeLessThan(0.1);
    expect(Math.abs(res.base.px0)).toBeLessThan(2);
  });

  it('works on page 2 as well', () => {
    const scan = renderTemplate(L, 2, { scale: 0.98, dx: -3, dy: 2 });
    const res = autoAlign(scan, L, 2);
    expect(res.ok).toBe(true);
    expect(Math.abs(res.base.sx / (0.98 * 6) - 1)).toBeLessThan(0.006);
  });

  it('a blank page is not confidently aligned and falls back to the default layout', () => {
    const blank: RGBA = { width: 1260, height: 1782, data: new Uint8ClampedArray(1260 * 1782 * 4).fill(255) };
    const res = autoAlign(blank, L, 1);
    expect(res.ok).toBe(false);
    expect(res.base).toEqual(defaultBase(1260, 1782));
  });

  it('custom grids are not auto-aligned', () => {
    const C = scLayout({ mode: 'custom', custom: { cols: 6, rows: 8, chars: [] } });
    expect(autoAlign(renderTemplate(L, 1), C, 1).ok).toBe(false);
  });
});

describe('image helpers', () => {
  const px = (w: number, h: number, f: (x: number, y: number) => number): RGBA => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), p = (y * w + x) * 4; data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255; }
    return { data, width: w, height: h };
  };
  it('downscale averages blocks', () => {
    const d = downscale(px(4, 4, (x) => (x < 2 ? 0 : 200)), 2, 2);
    expect([d.data[0], d.data[4]]).toEqual([0, 200]);
    expect(downscale(px(4, 4, () => 7), 4, 4).width).toBe(4);
  });
  it('four quarter turns are the identity and each turn swaps the sides', () => {
    const img = px(5, 3, (x, y) => x * 10 + y);
    let r = img;
    for (let i = 0; i < 4; i++) r = rotate90(r, 1);
    expect(Array.from(r.data)).toEqual(Array.from(img.data));
    expect([rotate90(img, 1).width, rotate90(img, 1).height]).toEqual([3, 5]);
    expect([rotate90(img, 2).width, rotate90(img, 2).height]).toEqual([5, 3]);
    expect(rotate90(img, -1).width).toBe(3);
  });
  it('a clockwise quarter turn sends the top-left pixel to the top-right', () => {
    const img = px(4, 2, (x, y) => (x === 0 && y === 0 ? 255 : 0));
    const r = rotate90(img, 1); // 2 wide, 4 tall
    expect(r.data[(0 * 2 + 1) * 4]).toBe(255);
  });
});
