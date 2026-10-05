import { describe, expect, it } from 'vitest';
import { blur121, containMapper, customCellMapper, legacyMapper, marchingRings, placeWithBearings, templateCellMapper, thumbOfMask, traceField } from '@/scan/trace';
import { groupRings, reverseContour, shapesOfContours } from '@/engine/geometry/rings';
import { buildContours } from '@/engine/geometry/build';
import { flattenContour } from '@/engine/geometry/flatten';
import { signedArea, type Ring } from '@/engine/geometry/types';
import type { Contour } from '@/storage/types';

const M = { ascender: 800, descender: -200, capheight: 700, defLsb: 50, defRsb: 50 };
/** A w x h coverage field with filled rectangles (and optional holes) drawn in it. */
function field(w: number, h: number, draw: (x: number, y: number) => boolean): Uint8Array {
  const f = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = draw(x, y) ? 255 : 0;
  return f;
}
const identity = (x: number, y: number): [number, number] => [x, -y]; // y-up like the font

const area = (cs: Contour[]) => cs.reduce((s, c) => s + signedArea(flattenContour(c, 0.2)), 0);

describe('marchingRings', () => {
  it('a filled rectangle gives one ring whose area matches', () => {
    const f = field(40, 30, (x, y) => x >= 10 && x < 30 && y >= 8 && y < 20);
    const rings = marchingRings(f, 40, 30);
    expect(rings).toHaveLength(1);
    expect(Math.abs(signedArea(rings[0]!))).toBeCloseTo(20 * 12, -1);
  });
  it('a ring shape gives an outer and an inner ring', () => {
    const f = field(60, 60, (x, y) => { const d = Math.hypot(x - 30, y - 30); return d < 22 && d > 12; });
    expect(marchingRings(f, 60, 60)).toHaveLength(2);
  });
  it('two separate blobs give two rings', () => {
    const f = field(60, 30, (x, y) => (x > 5 && x < 20 && y > 5 && y < 25) || (x > 35 && x < 52 && y > 8 && y < 22));
    expect(marchingRings(f, 60, 30)).toHaveLength(2);
  });
  it('shapes touching the image border still close', () => {
    const f = field(20, 20, () => true);
    const rings = marchingRings(f, 20, 20);
    expect(rings).toHaveLength(1);
    expect(Math.abs(signedArea(rings[0]!))).toBeGreaterThan(300);
  });
  it('is sub-pixel accurate: a soft edge moves the contour proportionally', () => {
    // left half 255, right half 0, with the boundary pixel at 64 (a quarter of full coverage)
    const w = 20, h = 10;
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = x < 10 ? 255 : x === 10 ? 64 : 0;
    const ring = marchingRings(f, w, h, 127.5)[0]!;
    const xs = ring.map((p) => p[0]);
    // iso-line between 255 (x=9) and 64 (x=10) at 127.5 is at 9 + (255-127.5)/(255-64)
    expect(Math.max(...xs)).toBeCloseTo(9 + (255 - 127.5) / (255 - 64), 1);
  });
  it('resolves the ambiguous diagonal case without losing or duplicating area', () => {
    const f = field(8, 8, (x, y) => (x === 3 && y === 3) || (x === 4 && y === 4));
    const rings = marchingRings(f, 8, 8);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    expect(rings.reduce((s, r) => s + Math.abs(signedArea(r)), 0)).toBeGreaterThan(0.5);
  });
  it('an empty field gives no rings', () => {
    expect(marchingRings(new Uint8Array(100), 10, 10)).toEqual([]);
  });
});

describe('traceField', () => {
  it('a filled circle becomes a smooth contour with few nodes and the right area', () => {
    const r = 40;
    const f = field(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < r);
    const cs = traceField(f, 120, 120, identity, { tolerance: 0.5 });
    expect(cs).toHaveLength(1);
    expect(cs[0]!.nodes.length).toBeLessThan(20);
    expect(Math.abs(area(cs))).toBeGreaterThan(Math.PI * r * r * 0.97);
    expect(Math.abs(area(cs))).toBeLessThan(Math.PI * r * r * 1.03);
  });
  it('outer contours are clockwise and holes counter-clockwise (y-up)', () => {
    const f = field(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 40 && d > 20; });
    const cs = traceField(f, 100, 100, identity);
    expect(cs).toHaveLength(2);
    const areas = cs.map((c) => signedArea(flattenContour(c, 0.2)));
    expect(areas.filter((a) => a < 0)).toHaveLength(1);
    expect(areas.filter((a) => a > 0)).toHaveLength(1);
    expect(Math.min(...areas.map(Math.abs))).toBeLessThan(Math.max(...areas.map(Math.abs)));
  });
  it('drops specks and keeps the real shape', () => {
    const f = field(80, 80, (x, y) => (x > 20 && x < 60 && y > 20 && y < 60) || (x === 5 && y === 5));
    expect(traceField(f, 80, 80, identity, { minArea: 30 })).toHaveLength(1);
  });
  it('a rectangle keeps four sharp corners', () => {
    const f = field(100, 60, (x, y) => x >= 20 && x < 80 && y >= 15 && y < 45);
    const cs = traceField(f, 100, 60, identity, { tolerance: 0.4 });
    expect(cs).toHaveLength(1);
    expect(cs[0]!.nodes.filter((n) => n.kind === 'corner').length).toBeGreaterThanOrEqual(4);
  });
  it('blurring suppresses isolated single-pixel noise', () => {
    const f = field(60, 60, (x, y) => (x > 15 && x < 45 && y > 15 && y < 45) || (x === 3 && y === 50));
    expect(traceField(f, 60, 60, identity, { minArea: 0.01 }).length).toBeGreaterThanOrEqual(1);
    expect(blur121(f, 60, 60)[50 * 60 + 3]!).toBeLessThan(100);
  });
});

describe('mappers', () => {
  it('legacy: the whole image spans 0..advance and ascender..descender, exactly like v3 export', () => {
    const m = legacyMapper(384, 384, 600, M);
    expect(m(0, 0)).toEqual([0, 800]);
    expect(m(384, 384)).toEqual([600, -200]);
    expect(m(192, 192)).toEqual([300, 300]);
  });
  it('template cell: baseline at 74% maps to 0 and the cap line at 18% to the cap height', () => {
    const m = templateCellMapper(100, M);
    expect(m(0, 74)[1]).toBeCloseTo(0, 6);
    expect(m(0, 18)[1]).toBeCloseTo(700, 6);
    expect(m(0, 88)[1]).toBeLessThan(0); // descender line is below the baseline
  });
  it('custom cell: height spans ascender to descender', () => {
    const m = customCellMapper(200, M);
    expect(m(0, 0)[1]).toBe(800);
    expect(m(0, 200)[1]).toBe(-200);
  });
  it('contain: the image is centred and keeps its aspect ratio', () => {
    const m = containMapper(200, 100, 500, M); // wide image in a 500 x 1000 box
    const [x0] = m(0, 0), [x1] = m(200, 0);
    expect(x1 - x0).toBeCloseTo(500, 6);
    expect(m(0, 50)[1]).toBeCloseTo(300, 6); // vertical centre of the box
  });
});

describe('placeWithBearings', () => {
  it('moves the ink to the left bearing and derives the advance', () => {
    const f = field(200, 100, (x, y) => x >= 60 && x < 140 && y >= 20 && y < 80);
    const cs = traceField(f, 200, 100, identity);
    const art = placeWithBearings(cs, M);
    // The curve (not just its anchor points) starts at the left bearing.
    const xs = art.contours.flatMap((c) => flattenContour(c, 0.2).map((p) => p[0]));
    expect(Math.min(...xs)).toBeCloseTo(50, 1);
    // ink width 80 plus the two default bearings, give or take the curve-fit tolerance on each side
    expect(Math.abs(art.advance - (80 + 50 + 50))).toBeLessThanOrEqual(3);
    expect(art.lsb).toBe(50);
  });
  it('handles an empty trace', () => {
    expect(placeWithBearings([], M).contours).toEqual([]);
  });
});

describe('thumbOfMask', () => {
  it('keeps aspect ratio, centres, and reports coverage', () => {
    const w = 100, h = 50;
    const t = thumbOfMask(new Uint8Array(w * h).fill(255), w, h, 64);
    expect(t.length).toBe(64 * 64);
    expect(t[32 * 64 + 32]).toBe(255);
    expect(t[2 * 64 + 32]).toBe(0); // letterbox above
  });
});

describe('ring grouping (even-odd nesting)', () => {
  const sq = (x: number, y: number, s: number): Ring => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  it('nests an island inside a hole inside an outer ring', () => {
    const shapes = groupRings([sq(0, 0, 100), sq(20, 20, 60), sq(40, 40, 20)]);
    expect(shapes).toHaveLength(2); // outer + island
    expect(shapes.map((s) => s.holes.length).sort()).toEqual([0, 1]);
  });
  it('normalises winding whatever the input direction', () => {
    const cw = [...sq(0, 0, 100)].reverse();
    const shapes = groupRings([cw, sq(30, 30, 40)]);
    expect(signedArea(shapes[0]!.outer)).toBeLessThan(0);
    expect(signedArea(shapes[0]!.holes[0]!)).toBeGreaterThan(0);
  });
  it('drops rings under the minimum area together with nothing else', () => {
    expect(groupRings([sq(0, 0, 100), sq(5, 5, 2)], 10)[0]!.holes).toHaveLength(0);
  });
  it('reverseContour flips direction and swaps handles', () => {
    const c: Contour = { closed: true, nodes: [{ p: { x: 0, y: 0 }, hOut: { x: 10, y: 0 }, kind: 'smooth' }, { p: { x: 50, y: 0 }, hIn: { x: 40, y: 0 }, kind: 'smooth' }, { p: { x: 25, y: 40 }, kind: 'corner' }] };
    const r = reverseContour(c);
    expect(r.nodes[0]!.p).toEqual({ x: 25, y: 40 });
    expect(r.nodes[2]!.hIn).toEqual({ x: 10, y: 0 });
    expect(Math.sign(signedArea(flattenContour(r, 0.2)))).toBe(-Math.sign(signedArea(flattenContour(c, 0.2))));
  });
});

describe('traced artwork in the union', () => {
  it('imported contours (with a hole) survive the build, and an eraser can cut them', () => {
    const f = field(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 40 && d > 20; });
    const traced = traceField(f, 100, 100, identity);
    expect(traced).toHaveLength(2);
    const built = buildContours([], [], {}, traced);
    expect(built).toHaveLength(2);
    const cut = buildContours([{ pts: [{ x: 10, y: -50, pressure: 0.5 }, { x: 90, y: -50, pressure: 0.5 }], size: 60, erase: true }], [], {}, traced);
    expect(cut.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(area(cut))).toBeLessThan(Math.abs(area(built)));
  });
  it('shapesOfContours accepts contours of any orientation', () => {
    const sqc = (rev: boolean): Contour => { const c: Contour = { closed: true, nodes: [0, 1, 2, 3].map((i) => ({ p: { x: [0, 100, 100, 0][i]!, y: [0, 0, 100, 100][i]! }, kind: 'corner' as const })) }; return rev ? reverseContour(c) : c; };
    for (const rev of [false, true]) expect(signedArea(shapesOfContours([sqc(rev)])[0]!.outer)).toBeLessThan(0);
  });
});
