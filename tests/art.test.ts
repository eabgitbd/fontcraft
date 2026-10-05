import { describe, expect, it } from 'vitest';
import { importArtInto, rebuildVariant, slotForImport, withTraced } from '@/engine/art';
import { EMPTY_STATE, History, SetTraced } from '@/engine/history';
import { blankGlyph } from '@/storage/projects';
import { isGlyphDrawn, type Contour, type Glyph, type Stroke } from '@/storage/types';

const square = (x: number, y: number, s: number, clockwise = true): Contour => {
  const pts = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] as const;
  const order = clockwise ? [0, 3, 2, 1] : [0, 1, 2, 3]; // y-up: clockwise visits bottom-left, top-left, top-right, bottom-right
  return { closed: true, nodes: order.map((i) => ({ p: { x: pts[i]![0], y: pts[i]![1] }, kind: 'corner' as const })) };
};
const art = { contours: [square(50, 0, 300)], advance: 450, lsb: 50, rsb: 50 };
const ink: Stroke = { pts: [{ x: 10, y: 10, pressure: 0.5 }, { x: 200, y: 10, pressure: 0.5 }], size: 30 };
const drawnGlyph = (): Glyph => ({ ...blankGlyph('A'), variants: [{ strokes: [ink], contours: [] }] });

describe('withTraced', () => {
  it('stores the art, rebuilds the exported contours and can set the widths', () => {
    const g = withTraced(blankGlyph('A'), 0, art.contours, { advance: 450, lsb: 50, rsb: 50 });
    expect(g.variants[0]!.traced).toHaveLength(1);
    expect(g.variants[0]!.contours).toHaveLength(1);
    expect(g.advance).toBe(450);
    expect(isGlyphDrawn(g)).toBe(true);
  });
  it('keeps strokes the user drew and merges them with the art', () => {
    const g = withTraced(drawnGlyph(), 0, art.contours);
    expect(g.variants[0]!.strokes).toHaveLength(1);
    expect(g.advance).toBe(500); // widths untouched without metrics
    // the stroke at y=10 overlaps the square (50..350 x 0..300), so one merged shape
    expect(g.variants[0]!.contours).toHaveLength(1);
  });
  it('passing no contours removes the art layer', () => {
    const g = withTraced(withTraced(blankGlyph('A'), 0, art.contours), 0, []);
    expect(g.variants[0]!.traced).toBeUndefined();
    expect(g.variants[0]!.contours).toEqual([]);
  });
  it('only the chosen variant changes', () => {
    const g0 = { ...blankGlyph('A'), variants: [{ strokes: [ink], contours: [] }, { strokes: [], contours: [] }] };
    const g = withTraced(g0, 1, art.contours);
    expect(g.variants[0]!.traced).toBeUndefined();
    expect(g.variants[1]!.traced).toHaveLength(1);
  });
  it('rebuildVariant never loses a bitmap reference layer', () => {
    const png = new Blob(['x']);
    expect(rebuildVariant({ strokes: [], contours: [], legacyPng: png }).legacyPng).toBe(png);
  });
});

describe('slotForImport', () => {
  it('an undrawn glyph uses its first variant', () => {
    expect(slotForImport(blankGlyph('A'), 'variant').index).toBe(0);
    expect(slotForImport(blankGlyph('A'), 'replace').index).toBe(0);
  });
  it('a drawn glyph gets a new variant, or replaces the first when asked', () => {
    const g = drawnGlyph();
    const s = slotForImport(g, 'variant');
    expect(s.index).toBe(1);
    expect(s.glyph.variants).toHaveLength(2);
    expect(slotForImport(g, 'replace').index).toBe(0);
  });
  it('fills an empty variant before adding another', () => {
    const g = { ...drawnGlyph(), variants: [drawnGlyph().variants[0]!, { strokes: [], contours: [] }, drawnGlyph().variants[0]!] };
    expect(slotForImport(g, 'variant').index).toBe(1);
  });
  it('when all four variants are used it replaces the last, never exceeding four', () => {
    const v = drawnGlyph().variants[0]!;
    const full = { ...drawnGlyph(), variants: [v, v, v, v] };
    const s = slotForImport(full, 'variant');
    expect(s.index).toBe(3);
    expect(s.glyph.variants).toHaveLength(4);
  });
});

describe('importArtInto', () => {
  it('an empty glyph takes the art and its widths', () => {
    const { glyph, index } = importArtInto(blankGlyph('A'), art, 'variant');
    expect(index).toBe(0);
    expect(glyph.advance).toBe(450);
    expect(glyph.variants[0]!.contours.length).toBeGreaterThan(0);
  });
  it('as a new variant it keeps the first variant and the glyph widths', () => {
    const base = withTraced(blankGlyph('A'), 0, [square(0, 0, 100)], { advance: 300, lsb: 20, rsb: 20 });
    const { glyph, index } = importArtInto(base, art, 'variant');
    expect(index).toBe(1);
    expect(glyph.variants).toHaveLength(2);
    expect(glyph.advance).toBe(300);
    expect(glyph.variants[0]!.traced).toHaveLength(1);
    expect(glyph.variants[1]!.traced![0]!.nodes[0]!.p.x).toBe(50);
  });
  it('replace discards the old drawing of the first variant and takes the new widths', () => {
    const old = drawnGlyph();
    const { glyph } = importArtInto(old, art, 'replace');
    expect(glyph.variants[0]!.strokes).toEqual([]);
    expect(glyph.advance).toBe(450);
  });
  it('replace keeps an old bitmap as a reference layer', () => {
    const png = new Blob(['x']);
    const g: Glyph = { ...blankGlyph('A'), variants: [{ strokes: [ink], contours: [], legacyPng: png }] };
    expect(importArtInto(g, art, 'replace').glyph.variants[0]!.legacyPng).toBe(png);
  });
});

describe('SetTraced command', () => {
  it('is undoable and redoable', () => {
    const h = new History();
    let s = h.run(new SetTraced([], art.contours, 'Import'), EMPTY_STATE);
    expect(s.traced).toHaveLength(1);
    s = h.undo(s)!;
    expect(s.traced).toEqual([]);
    s = h.redo(s)!;
    expect(s.traced).toHaveLength(1);
  });
  it('Clear-style resets include the art layer', () => {
    expect(EMPTY_STATE.traced).toEqual([]);
  });
});
