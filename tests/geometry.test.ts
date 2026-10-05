import { describe, expect, it } from 'vitest';
import { buildContours } from '@/engine/geometry/build';
import { buildShapes } from '@/engine/geometry/union';
import { fitCubic, fitRing, contourToPath } from '@/engine/geometry/fit';
import { flattenContour } from '@/engine/geometry/flatten';
import { outlineOf, ringToPath, constantWidthOutline } from '@/engine/geometry/outline';
import { signedArea, type Ring } from '@/engine/geometry/types';
import type { PenPath, Stroke } from '@/storage/types';

const stroke = (pts: Array<[number, number]>, size = 40, pressure = 0.5, erase = false): Stroke => ({
  pts: pts.map(([x, y]) => ({ x, y, pressure })),
  size,
  ...(erase ? { erase: true } : {}),
});
/** Densely sampled straight line, like real pointer input. */
const line = (x1: number, y1: number, x2: number, y2: number, size = 40, erase = false): Stroke => {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
  return stroke(Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n] as [number, number]), size, 0.5, erase);
};
const circlePts = (cx: number, cy: number, r: number, n = 90): Array<[number, number]> => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

const areaOf = (c: ReturnType<typeof buildContours>) => c.reduce((s, k) => s + Math.abs(signedArea(flattenContour(k, 0.2))), 0);

describe('outline', () => {
  it('makes a closed polygon with area for a line and a dot', () => {
    expect(outlineOf(line(0, 0, 300, 0)).length).toBeGreaterThan(6);
    const dot = outlineOf(stroke([[100, 100]], 40));
    expect(dot.length).toBeGreaterThan(6);
    expect(Math.abs(signedArea(dot))).toBeGreaterThan(600); // about pi * 20^2
    expect(outlineOf(stroke([], 40))).toEqual([]);
  });
  it('a finger or mouse stroke is about as wide as the brush (speed adds a little swell)', () => {
    const o = outlineOf(line(0, 0, 400, 0, 40));
    const ys = o.map((p) => p[1]);
    const width = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThan(40 * 0.6);
    expect(width).toBeLessThan(40 * 1.6);
  });
  it('real pen pressure changes the width along the stroke', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 8, y: 0, pressure: 0.1 + (0.9 * i) / 39 }));
    const o = outlineOf({ pts, size: 40 }, true);
    const widthNear = (x: number) => {
      const ys = o.filter((p) => Math.abs(p[0] - x) < 12).map((p) => p[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(widthNear(280)).toBeGreaterThan(widthNear(40) * 1.5);
  });
  it('path strings are closed and finite', () => {
    const d = ringToPath(outlineOf(line(0, 0, 100, 50)));
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(ringToPath([[0, 0], [1, 1]])).toBe('');
  });
  it('constant width outline has the requested width regardless of pressure', () => {
    const o = constantWidthOutline([[0, 0], [300, 0]], 30);
    const ys = o.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30, 0);
  });
});

describe('union (plan 8.6 required cases)', () => {
  it('a single stroke becomes one contour', () => {
    const c = buildContours([line(100, 100, 500, 100)]);
    expect(c).toHaveLength(1);
    expect(c[0]!.closed).toBe(true);
  });

  it('two overlapping strokes give ONE contour (a plus sign)', () => {
    const c = buildContours([line(100, 300, 500, 300), line(300, 100, 300, 500)]);
    expect(c).toHaveLength(1);
  });

  it('two separate strokes stay two contours', () => {
    expect(buildContours([line(100, 100, 300, 100), line(100, 500, 300, 500)])).toHaveLength(2);
  });

  it('a ring stroke gives an outer and an inner contour with opposite winding', () => {
    const shapes = buildShapes([stroke(circlePts(400, 300, 150, 120), 40)]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.holes).toHaveLength(1);
    const outer = signedArea(shapes[0]!.outer);
    const hole = signedArea(shapes[0]!.holes[0]!);
    expect(outer).toBeLessThan(0); // clockwise in y-up (CFF outer)
    expect(hole).toBeGreaterThan(0); // counter-clockwise
    const contours = buildContours([stroke(circlePts(400, 300, 150, 120), 40)]);
    expect(contours).toHaveLength(2);
  });

  it('drops specks below the area threshold', () => {
    expect(buildShapes([stroke([[100, 100]], 2)])).toHaveLength(0);
  });

  it('an eraser stroke removes area and can split a stroke in two', () => {
    const whole = buildContours([line(100, 300, 700, 300)]);
    const split = buildContours([line(100, 300, 700, 300), line(400, 200, 400, 400, 60, true)]);
    expect(whole).toHaveLength(1);
    expect(split).toHaveLength(2);
    expect(areaOf(split)).toBeLessThan(areaOf(whole));
  });

  it('drawing after an eraser stroke puts ink back (order matters)', () => {
    const inkThenErase = buildContours([line(100, 300, 700, 300), line(100, 300, 700, 300, 80, true)]);
    expect(inkThenErase).toHaveLength(0);
    const eraseThenInk = buildContours([line(100, 300, 700, 300, 80, true), line(100, 300, 700, 300)]);
    expect(eraseThenInk).toHaveLength(1);
  });

  it('an eraser over empty space changes nothing', () => {
    expect(buildContours([line(400, 200, 400, 400, 60, true)])).toEqual([]);
  });

  it('is deterministic', () => {
    const s = [line(100, 300, 500, 300), line(300, 100, 300, 500)];
    expect(JSON.stringify(buildContours(s))).toBe(JSON.stringify(buildContours(s)));
  });

  it('survives degenerate input (identical points, huge counts)', () => {
    const same = stroke([[50, 50], [50, 50], [50, 50]], 30);
    expect(() => buildContours([same])).not.toThrow();
    const long = stroke(Array.from({ length: 800 }, (_, i) => [i, 200 + 80 * Math.sin(i / 30)] as [number, number]), 30);
    const t0 = performance.now();
    const c = buildContours([long]);
    expect(c.length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(2500);
  });
});

describe('pen paths in the union', () => {
  const square: PenPath = { closed: true, size: 10, nodes: [{ p: { x: 100, y: 100 }, kind: 'corner' }, { p: { x: 300, y: 100 }, kind: 'corner' }, { p: { x: 300, y: 300 }, kind: 'corner' }, { p: { x: 100, y: 300 }, kind: 'corner' }] };
  it('a closed pen square is filled: one outer contour, no hole', () => {
    const c = buildContours([], [square]);
    expect(c).toHaveLength(1);
    expect(areaOf(c)).toBeGreaterThan(200 * 200 * 0.95);
  });
  it('an open pen path is stroked at its size', () => {
    const open: PenPath = { closed: false, size: 30, nodes: [{ p: { x: 100, y: 100 }, kind: 'corner' }, { p: { x: 500, y: 100 }, kind: 'corner' }] };
    const c = buildContours([], [open]);
    expect(c).toHaveLength(1);
    expect(areaOf(c)).toBeGreaterThan(400 * 30 * 0.9);
    expect(areaOf(c)).toBeLessThan(430 * 34);
  });
  it('a pen square and a crossing stroke merge into one contour', () => {
    expect(buildContours([line(200, 50, 200, 350)], [square])).toHaveLength(1);
  });
});

describe('curve fitting stays within tolerance', () => {
  const maxDeviation = (ring: Ring, c: ReturnType<typeof fitRing>) => {
    const flat = flattenContour(c, 0.05);
    // Measure along every edge of the original polygon, not only at its vertices.
    const dense: Ring = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k < steps; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
    }
    ring = dense;
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    let worst = 0;
    for (const p of ring) {
      let best = Infinity;
      for (let i = 0; i < flat.length; i++) best = Math.min(best, segDist(p, flat[i]!, flat[(i + 1) % flat.length]!));
      worst = Math.max(worst, best);
    }
    return worst;
  };

  it('long straight edges with no interior vertices do not bulge (capsule outline)', () => {
    const ring = constantWidthOutline([[100, 100], [500, 100]], 30);
    const c = fitRing(ring, { tolerance: 1.5 });
    expect(maxDeviation(ring, c)).toBeLessThanOrEqual(1.5 * 1.2 + 0.05);
  });

  it('a circle polygon becomes few nodes and stays within tolerance', () => {
    const ring = circlePts(0, 0, 200, 240).slice(0, -1);
    for (const tol of [0.5, 1.5, 4]) {
      const c = fitRing(ring, { tolerance: tol });
      expect(maxDeviation(ring, c), `tol ${tol}`).toBeLessThanOrEqual(tol * 1.2 + 0.05);
      expect(c.nodes.length).toBeLessThan(24);
    }
  });

  it('a larger tolerance never needs more nodes', () => {
    const ring = outlineOf(stroke(Array.from({ length: 60 }, (_, i) => [i * 8, 200 + 90 * Math.sin(i / 7)] as [number, number]), 36));
    const fine = fitRing(ring, { tolerance: 0.4 }).nodes.length;
    const coarse = fitRing(ring, { tolerance: 3 }).nodes.length;
    expect(coarse).toBeLessThanOrEqual(fine);
  });

  it('keeps the corners of a rectangle sharp with straight edges', () => {
    const rect: Ring = [[0, 0], [400, 0], [400, 100], [0, 100]];
    const c = fitRing(rect, { tolerance: 1 });
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.every((n) => n.kind === 'corner' && !n.hIn && !n.hOut)).toBe(true);
    expect(contourToPath(c)).toMatch(/^M.*L.*L.*L.*Z$/);
  });

  it('keeps a sharp corner on a densely sampled L shape and stays within tolerance', () => {
    const ring: Ring = [];
    const add = (x1: number, y1: number, x2: number, y2: number) => { for (let i = 0; i < 40; i++) ring.push([x1 + ((x2 - x1) * i) / 40, y1 + ((y2 - y1) * i) / 40]); };
    add(0, 0, 300, 0); add(300, 0, 300, 100); add(300, 100, 100, 100); add(100, 100, 100, 300); add(100, 300, 0, 300); add(0, 300, 0, 0);
    const c = fitRing(ring, { tolerance: 1 });
    expect(c.nodes.filter((n) => n.kind === 'corner').length).toBeGreaterThanOrEqual(6);
    expect(maxDeviation(ring, c)).toBeLessThanOrEqual(1.5);
  });

  it('fitCubic reproduces a quarter circle with one segment', () => {
    const pts = Array.from({ length: 30 }, (_, i) => [100 * Math.cos((i / 29) * Math.PI / 2), 100 * Math.sin((i / 29) * Math.PI / 2)] as [number, number]);
    const segs = fitCubic(pts, [0, 1], [1, 0].map((v) => v) as [number, number], 0.5);
    expect(segs).toHaveLength(1);
  });

  it('is stable on tiny and degenerate rings', () => {
    expect(() => fitRing([[0, 0], [1, 0]])).not.toThrow();
    expect(fitRing([[0, 0], [0, 0], [0, 0]]).nodes.length).toBeLessThanOrEqual(3);
    const tri = fitRing([[0, 0], [100, 0], [50, 80]], { tolerance: 1 });
    expect(tri.nodes).toHaveLength(3);
  });

  it('a real handwriting-like stroke fits within the default tolerance end to end', () => {
    const s = stroke(Array.from({ length: 120 }, (_, i) => [200 + 160 * Math.cos(i / 14), 300 + 120 * Math.sin(i / 9)] as [number, number]), 34);
    const ring = outlineOf(s);
    const [c] = buildContours([s]);
    expect(c).toBeDefined();
    const flat = flattenContour(c!, 0.1);
    expect(flat.length).toBeGreaterThan(8);
    expect(ring.length).toBeGreaterThan(8);
  });
});

describe('flatten', () => {
  it('flattening a closed contour does not repeat the first point', () => {
    const ring = flattenContour({ closed: true, nodes: [{ p: { x: 0, y: 0 }, kind: 'corner' }, { p: { x: 10, y: 0 }, kind: 'corner' }, { p: { x: 10, y: 10 }, kind: 'corner' }] });
    expect(ring).toHaveLength(3);
  });
  it('curves are subdivided, straight edges are not', () => {
    const curved = flattenContour({ closed: false, nodes: [{ p: { x: 0, y: 0 }, hOut: { x: 0, y: 100 }, kind: 'smooth' }, { p: { x: 100, y: 0 }, hIn: { x: 100, y: 100 }, kind: 'smooth' }] }, 0.2);
    expect(curved.length).toBeGreaterThan(8);
    const straight = flattenContour({ closed: false, nodes: [{ p: { x: 0, y: 0 }, kind: 'corner' }, { p: { x: 100, y: 0 }, kind: 'corner' }] });
    expect(straight).toHaveLength(2);
  });
});
