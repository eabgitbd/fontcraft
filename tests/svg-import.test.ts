import { describe, expect, it } from 'vitest';
import { arcToCubics, parsePathData, parseSvg, parseTransform, placeSvgArtwork } from '@/scan/svg-import';
import { flattenContour } from '@/engine/geometry/flatten';
import { signedArea } from '@/engine/geometry/types';
import { buildContours } from '@/engine/geometry/build';
import type { Contour } from '@/storage/types';

const area = (c: Contour) => signedArea(flattenContour(c, 0.1));
const box = { advance: 500, ascender: 800, descender: -200 };
const ext = (cs: Contour[]) => {
  const pts = cs.flatMap((c) => flattenContour(c, 0.1));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe('path data', () => {
  it('absolute and relative lines make the same square', () => {
    const a = parsePathData('M10 10 L110 10 L110 110 L10 110 Z');
    const b = parsePathData('m10 10 l100 0 l0 100 l-100 0 z');
    expect(a).toHaveLength(1);
    expect(Math.abs(area(a[0]!))).toBeCloseTo(10000, 0);
    expect(Math.abs(area(b[0]!))).toBeCloseTo(10000, 0);
  });
  it('H and V commands, with implicit repeated coordinates after M', () => {
    const c = parsePathData('M0 0 H100 V100 H0 z');
    expect(Math.abs(area(c[0]!))).toBeCloseTo(10000, 0);
    expect(Math.abs(area(parsePathData('M0 0 100 0 100 100 0 100z')[0]!))).toBeCloseTo(10000, 0);
  });
  it('cubic curves keep their handles', () => {
    const [c] = parsePathData('M0 0 C0 50 100 50 100 0 L100 -50 L0 -50 Z');
    expect(c!.nodes[0]!.hOut).toEqual({ x: 0, y: 50 });
    expect(c!.nodes[1]!.hIn).toEqual({ x: 100, y: 50 });
  });
  it('smooth (S) and quadratic (Q, T) curves are converted to cubics', () => {
    expect(parsePathData('M0 0 C10 20 30 20 40 0 S70 -20 80 0 L80 40 L0 40Z')[0]!.nodes.length).toBeGreaterThanOrEqual(4);
    const q = parsePathData('M0 0 Q50 100 100 0 T200 0 L200 -50 L0 -50 Z')[0]!;
    expect(q.nodes.some((n) => n.hOut)).toBe(true);
    expect(Math.abs(area(q))).toBeGreaterThan(1000);
  });
  it('a full circle drawn with two arcs has the right area', () => {
    const [c] = parsePathData('M100 50 A50 50 0 1 1 0 50 A50 50 0 1 1 100 50 Z');
    // within half a percent: the flattened polygon is slightly inside the true circle
    expect(Math.abs(Math.abs(area(c!)) / (Math.PI * 2500) - 1)).toBeLessThan(0.005);
  });
  it('arc flags may be written without separators', () => {
    const [c] = parsePathData('M0 0 a50 50 0 0150 50 L0 50 Z');
    expect(c).toBeDefined();
  });
  it('arcToCubics ends exactly at the end point', () => {
    const segs = arcToCubics({ x: 0, y: 0 }, 50, 30, 20, 0, 1, { x: 80, y: 20 });
    expect(segs.at(-1)![2]).toEqual({ x: 80, y: 20 });
    expect(arcToCubics({ x: 5, y: 5 }, 10, 10, 0, 0, 0, { x: 5, y: 5 })).toEqual([]);
  });
  it('several subpaths become several contours', () => {
    expect(parsePathData('M0 0 H10 V10 H0z M20 20 H30 V30 H20z')).toHaveLength(2);
  });
  it('unsupported or broken data fails loudly, not silently', () => {
    expect(() => parsePathData('M0 0 X10 10')).toThrow(/Unsupported/);
    expect(() => parsePathData('M0 0 L10')).toThrow();
  });
  it('empty data gives nothing', () => {
    expect(parsePathData('')).toEqual([]);
  });
});

describe('transforms', () => {
  it('translate, scale, rotate and matrix compose in order', () => {
    expect(parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseTransform('translate(5,0) scale(2)')).toEqual([2, 0, 0, 2, 5, 0]);
    const r = parseTransform('rotate(90)');
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(1, 9);
    expect(parseTransform('matrix(1 0 0 1 7 8)')).toEqual([1, 0, 0, 1, 7, 8]);
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('whole documents', () => {
  it('reads paths and basic shapes together', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="0" y="0" width="10" height="10"/><circle cx="50" cy="50" r="10"/>
      <ellipse cx="20" cy="70" rx="10" ry="5"/><polygon points="0,90 10,90 5,100"/>
      <path d="M60 0 h10 v10 h-10z"/></svg>`;
    expect(parseSvg(svg).contours).toHaveLength(5);
  });
  it('group transforms apply to everything inside, and end at </g>', () => {
    const svg = `<svg><g transform="translate(100 0)"><rect width="10" height="10"/></g><rect width="10" height="10"/></svg>`;
    const cs = parseSvg(svg).contours;
    expect(ext([cs[0]!]).minX).toBeCloseTo(100, 6);
    expect(ext([cs[1]!]).minX).toBeCloseTo(0, 6);
  });
  it('unfilled outlines are ignored', () => {
    const svg = `<svg><rect width="10" height="10" fill="none" stroke="black"/><rect width="20" height="20"/></svg>`;
    expect(parseSvg(svg).contours).toHaveLength(1);
  });
  it('rejects non-SVG text and SVGs without shapes', () => {
    expect(() => parseSvg('hello')).toThrow(/not an SVG/);
    expect(() => parseSvg('<svg><text>hi</text></svg>')).toThrow(/No filled shapes/);
  });
  it('handles single-quoted attributes', () => {
    expect(parseSvg("<svg><path d='M0 0 h10 v10 h-10z'/></svg>").contours).toHaveLength(1);
  });
});

describe('placing artwork in the glyph box', () => {
  const squareSvg = `<svg><path d="M0 0 H200 V100 H0 Z"/></svg>`;
  it('fits inside the box at the requested share, centred, y flipped to point up', () => {
    const placed = placeSvgArtwork(parseSvg(squareSvg).contours, box, 0.8);
    const e = ext(placed);
    expect(e.maxX - e.minX).toBeCloseTo(400, 0); // limited by width: 500 * 0.8
    expect((e.minX + e.maxX) / 2).toBeCloseTo(250, 0);
    expect((e.minY + e.maxY) / 2).toBeCloseTo(300, 0); // middle of ascender and descender
  });
  it('a tall shape is limited by height', () => {
    const e = ext(placeSvgArtwork(parseSvg('<svg><path d="M0 0 H10 V100 H0z"/></svg>').contours, box, 0.8));
    expect(e.maxY - e.minY).toBeCloseTo(800, 0);
  });
  it('the top of the picture ends up at the top of the glyph (not upside down)', () => {
    // a triangle pointing up in SVG coordinates (apex at y = 0)
    const placed = placeSvgArtwork(parseSvg('<svg><path d="M50 0 L100 100 L0 100z"/></svg>').contours, box, 0.8);
    const apex = placed[0]!.nodes.reduce((a, n) => (n.p.y > a.p.y ? n : a));
    expect(Math.abs(apex.p.x - 250)).toBeLessThan(2);
  });
  it('a compound path becomes an outer contour clockwise and a hole counter-clockwise', () => {
    // both squares drawn the same direction: nesting, not winding, decides what is a hole
    const svg = `<svg><path d="M0 0 H100 V100 H0z M30 30 H70 V70 H30z"/></svg>`;
    const placed = placeSvgArtwork(parseSvg(svg).contours, box);
    expect(placed).toHaveLength(2);
    const areas = placed.map(area);
    expect(areas.filter((a) => a < 0)).toHaveLength(1);
    expect(areas.filter((a) => a > 0)).toHaveLength(1);
    // and it builds into a ring with a hole
    expect(buildContours([], [], {}, placed)).toHaveLength(2);
  });
  it('empty input gives nothing', () => {
    expect(placeSvgArtwork([], box)).toEqual([]);
  });
});
