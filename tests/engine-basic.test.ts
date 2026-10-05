import { describe, expect, it } from 'vitest';
import { autoBearings, distToSegment, strokeBounds, strokeHit, thinPoints } from '@/engine/basic';
import { layoutLine, layoutText, kernLookup } from '@/engine/layout';
import { blankGlyph } from '@/storage/projects';
import type { Glyph, Stroke } from '@/storage/types';

const line = (x1: number, y1: number, x2: number, y2: number, size = 20): Stroke => ({
  pts: [{ x: x1, y: y1, pressure: 0.5 }, { x: x2, y: y2, pressure: 0.5 }],
  size,
});

describe('distToSegment', () => {
  it('measures to the nearest point on the segment, clamped at the ends', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(13, 4, 0, 0, 10, 0)).toBe(5);
  });
  it('handles a zero-length segment', () => {
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('strokeBounds / autoBearings', () => {
  it('includes the brush radius', () => {
    expect(strokeBounds([line(100, 0, 300, 400, 20)])).toEqual({ minX: 90, minY: -10, maxX: 310, maxY: 410 });
  });
  it('is null for no ink and ignores eraser strokes', () => {
    expect(strokeBounds([])).toBeNull();
    expect(strokeBounds([{ ...line(0, 0, 1, 1), erase: true }])).toBeNull();
    expect(autoBearings([], 500)).toBeNull();
  });
  it('measures bearings from the ink and never goes negative', () => {
    expect(autoBearings([line(100, 0, 300, 400, 20)], 500)).toEqual({ lsb: 90, rsb: 190 });
    expect(autoBearings([line(-30, 0, 600, 0, 20)], 500)).toEqual({ lsb: 0, rsb: 0 });
  });
});

describe('strokeHit', () => {
  const s = line(0, 0, 200, 0, 20);
  it('hits within radius plus half the brush, misses beyond it', () => {
    expect(strokeHit(s, 100, 10, 0)).toBe(true);
    expect(strokeHit(s, 100, 11, 0)).toBe(false);
    expect(strokeHit(s, 100, 30, 20)).toBe(true);
  });
  it('treats a single point as a dot', () => {
    const dot: Stroke = { pts: [{ x: 50, y: 50, pressure: 1 }], size: 10 };
    expect(strokeHit(dot, 54, 50, 0)).toBe(true);
    expect(strokeHit(dot, 60, 50, 0)).toBe(false);
    expect(strokeHit({ pts: [], size: 10 }, 0, 0, 100)).toBe(false);
  });
});

describe('thinPoints', () => {
  it('keeps first and last point and drops near duplicates', () => {
    const pts = [0, 1, 2, 3, 10, 11, 20].map((x) => ({ x, y: 0 }));
    expect(thinPoints(pts, 5).map((p) => p.x)).toEqual([0, 10, 20]);
    expect(thinPoints([{ x: 0, y: 0 }], 5)).toHaveLength(1);
  });
});

describe('layout', () => {
  const drawn = (ch: string, advance: number): Glyph => ({ ...blankGlyph(ch), advance, variants: [{ strokes: [line(0, 0, 10, 10)], contours: [] }] });
  const glyphs = new Map<string, Glyph>([['A', drawn('A', 600)], ['V', drawn('V', 580)], ['B', blankGlyph('B')]]);
  const opts = { tracking: 0, letterSpacing: 0, fallbackAdvance: 400 };

  it('advances by width, tracking and letter spacing', () => {
    const r = layoutLine('AV', glyphs, [], { ...opts, tracking: 10, letterSpacing: 5 });
    expect(r.items.map((i) => [i.char, i.x])).toEqual([['A', 0], ['V', 615]]);
    expect(r.width).toBe(615 + 580 + 15);
  });
  it('applies kerning between the right pair only', () => {
    const r = layoutLine('AVA', glyphs, [{ left: 'A', right: 'V', value: -60 }], opts);
    expect(r.items.map((i) => i.x)).toEqual([0, 540, 1120]);
  });
  it('reports undrawn characters but treats spaces as plain advance', () => {
    const r = layoutLine('A B?', glyphs, [], opts);
    expect(r.missing.sort()).toEqual(['?', 'B']);
    expect(r.items.map((i) => i.char)).toEqual(['A']);
  });
  it('handles Bengali conjunct glyphs as one character and keeps code point order', () => {
    const conj = new Map<string, Glyph>([['ক', drawn('ক', 500)]]);
    expect(layoutLine('কক', conj, [], opts).items).toHaveLength(2);
  });
  it('splits lines and looks kerning up by exact pair', () => {
    expect(layoutText('A\nV', glyphs, [], opts)).toHaveLength(2);
    const k = kernLookup([{ left: 'A', right: 'V', value: -5 }]);
    expect(k('A', 'V')).toBe(-5);
    expect(k('V', 'A')).toBe(0);
  });
});
