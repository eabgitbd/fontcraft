// Boolean shape building with polygon-clipping (the plan's named fallback to paper.js).
import polygonClipping from 'polygon-clipping';
import type { Contour, PenPath, Stroke } from '@/storage/types';
import { shapesOfContours } from './rings';
import { constantWidthOutline, strokeOutline } from './outline';
import { flattenContour } from './flatten';
import { signedArea, type Ring, type Shape } from './types';

type Poly = Array<Array<[number, number]>>;
type Multi = Poly[];

export const MIN_AREA = 25; // font units squared; smaller islands are noise

const closeRing = (r: Ring): Array<[number, number]> => (r.length ? [...r, r[0]!] : []);
const toPoly = (r: Ring): Poly => [closeRing(r)];
const usable = (r: Ring) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6;
const round = (r: Ring, d = 2): Ring => r.map(([x, y]) => [Math.round(x * 10 ** d) / 10 ** d, Math.round(y * 10 ** d) / 10 ** d] as [number, number]);

/** polygon-clipping can throw on rare degenerate input. Retry once with rounded coordinates. */
function attempt<T>(fn: (round: boolean) => T): T | null {
  for (const rounded of [false, true]) {
    try {
      return fn(rounded);
    } catch (err) {
      if (rounded) console.warn('FontCraft: boolean operation failed, skipping one shape', err);
    }
  }
  return null;
}

function unionAll(acc: Multi, rings: Ring[]): Multi {
  const polys = rings.filter(usable);
  if (!polys.length) return acc;
  const res = attempt((r) => {
    const geoms = polys.map((p) => toPoly(r ? round(p) : p) as unknown as Parameters<typeof polygonClipping.union>[0]);
    return (acc.length ? polygonClipping.union(acc as never, ...geoms) : polygonClipping.union(geoms[0]!, ...geoms.slice(1))) as Multi;
  });
  return res ?? acc;
}

/** Unites shapes that already carry their holes (imported artwork). */
function unionShapes(shapes: Shape[]): Multi {
  const polys = shapes.map((sh) => [closeRing(sh.outer), ...sh.holes.map(closeRing)] as Poly).filter((p) => p[0]!.length >= 4);
  if (!polys.length) return [];
  return (
    attempt((r) => {
      const geoms = polys.map((p) => (r ? p.map((ring) => round(ring.slice(0, -1)).concat([round([ring[0]!])[0]!])) : p));
      return polygonClipping.union(geoms[0] as never, ...(geoms.slice(1) as never[])) as Multi;
    }) ?? []
  );
}

function subtract(acc: Multi, ring: Ring): Multi {
  if (!acc.length || !usable(ring)) return acc;
  const res = attempt((r) => polygonClipping.difference(acc as never, toPoly(r ? round(ring) : ring) as never) as Multi);
  return res ?? acc;
}

/** Filled polygon(s) for a pen path: the shape itself when closed, plus an outline band of `size`. */
export function penPathRings(path: PenPath): Ring[] {
  const flat = flattenContour(path, 0.4);
  if (flat.length < 2) return [];
  if (!path.closed) return [constantWidthOutline(flat, path.size)];
  return [flat, constantWidthOutline([...flat, flat[0]!], path.size)];
}

/**
 * Builds the filled area of a glyph variant. Pen paths go first (underneath), then strokes in
 * drawing order: ink strokes are united, eraser strokes subtract from everything drawn before them.
 */
export function buildMulti(strokes: readonly Stroke[], paths: readonly PenPath[] = [], traced: readonly Contour[] = []): Multi {
  // Imported artwork first (its holes are kept), then pen paths, both underneath the strokes.
  let acc: Multi = unionShapes(shapesOfContours(traced, 0));
  acc = unionAll(acc, paths.flatMap(penPathRings));
  let batch: Ring[] = [];
  const flush = () => {
    if (batch.length) acc = unionAll(acc, batch);
    batch = [];
  };
  for (const s of strokes) {
    const outline = strokeOutline(s);
    if (outline.length < 3) continue;
    if (s.erase) {
      flush();
      acc = subtract(acc, outline);
    } else batch.push(outline);
  }
  flush();
  return acc;
}

/** Normalised shapes: islands below `minArea` dropped, outer rings clockwise, holes counter-clockwise (y-up). */
export function buildShapes(strokes: readonly Stroke[], paths: readonly PenPath[] = [], minArea = MIN_AREA, traced: readonly Contour[] = []): Shape[] {
  const shapes: Shape[] = [];
  for (const poly of buildMulti(strokes, paths, traced)) {
    const [outerClosed, ...holesClosed] = poly;
    if (!outerClosed) continue;
    const open = (r: Array<[number, number]>): Ring => r.slice(0, -1);
    let outer = open(outerClosed);
    if (Math.abs(signedArea(outer)) < minArea) continue;
    if (signedArea(outer) > 0) outer = outer.reverse(); // clockwise
    const holes = holesClosed
      .map(open)
      .filter((h) => Math.abs(signedArea(h)) >= minArea)
      .map((h) => (signedArea(h) < 0 ? [...h].reverse() : h));
    shapes.push({ outer, holes });
  }
  return shapes;
}
