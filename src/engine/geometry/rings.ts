// Grouping loose rings into shapes (outer ring plus holes) and normalising their winding.
import type { Contour } from '@/storage/types';
import { flattenContour } from './flatten';
import { signedArea, type Ring, type Shape } from './types';

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A point that is certainly on the ring's boundary side we can test containment with. */
const probe = (r: Ring): [number, number] => {
  // The midpoint of the first edge is on the boundary; nudge toward the centroid so it is strictly inside the ring's own area.
  const [x0, y0] = r[0]!;
  const [x1, y1] = r[1 % r.length]!;
  let cx = 0, cy = 0;
  for (const [x, y] of r) { cx += x; cy += y; }
  cx /= r.length; cy /= r.length;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [mx + (cx - mx) * 1e-3, my + (cy - my) * 1e-3];
};

/**
 * Even-odd nesting: a ring contained in an even number of other rings is an outer boundary, in an odd
 * number a hole of its smallest container. Outer rings are returned clockwise and holes
 * counter-clockwise (y-up). Rings smaller than `minArea` are dropped (their holes with them).
 */
export function groupRings(rings: readonly Ring[], minArea = 0): Shape[] {
  const items = rings
    .filter((r) => r.length >= 3)
    .map((r) => ({ ring: r, area: Math.abs(signedArea(r)) }))
    .filter((x) => x.area > Math.max(1e-9, minArea));
  const info = items.map((it, i) => {
    const [px, py] = probe(it.ring);
    const containers: number[] = [];
    items.forEach((o, j) => {
      if (j !== i && o.area > it.area && pointInRing(px, py, o.ring)) containers.push(j);
    });
    return { i, depth: containers.length, containers };
  });
  const wind = (r: Ring, clockwise: boolean): Ring => ((signedArea(r) < 0) === clockwise ? r : [...r].reverse());
  const shapes = new Map<number, Shape>();
  for (const f of info) if (f.depth % 2 === 0) shapes.set(f.i, { outer: wind(items[f.i]!.ring, true), holes: [] });
  for (const f of info) {
    if (f.depth % 2 === 0) continue;
    const owner = f.containers.filter((c) => info[c]!.depth % 2 === 0).sort((a, b) => items[a]!.area - items[b]!.area)[0];
    if (owner !== undefined) shapes.get(owner)?.holes.push(wind(items[f.i]!.ring, false));
  }
  return [...shapes.values()];
}

/** Flattened shapes of imported contours of any orientation. */
export function shapesOfContours(contours: readonly Contour[], minArea = 0): Shape[] {
  return groupRings(
    contours.map((c) => flattenContour(c, 0.4)),
    minArea,
  );
}

/** Reverses a contour's direction (swapping each node's handles). */
export function reverseContour(c: Contour): Contour {
  const nodes = [...c.nodes].reverse().map((n) => ({ ...n, ...(n.hOut ? { hIn: n.hOut } : { hIn: undefined }), ...(n.hIn ? { hOut: n.hIn } : { hOut: undefined }) }));
  for (const n of nodes) {
    if (!n.hIn) delete n.hIn;
    if (!n.hOut) delete n.hOut;
  }
  return { ...c, nodes };
}

/** Re-winds imported contours so outer contours are clockwise and holes counter-clockwise (y-up). */
export function normalizeWinding(contours: readonly Contour[], minArea = 0): Contour[] {
  const rings = contours.map((c) => flattenContour(c, 0.4));
  const items = rings.map((ring, i) => ({ ring, i, area: Math.abs(signedArea(ring)) }));
  const out: Contour[] = [];
  for (const it of items) {
    if (it.ring.length < 3 || it.area <= Math.max(1e-9, minArea)) continue;
    const [px, py] = probe(it.ring);
    let depth = 0;
    for (const o of items) if (o.i !== it.i && o.area > it.area && o.ring.length >= 3 && pointInRing(px, py, o.ring)) depth++;
    const wantClockwise = depth % 2 === 0;
    const isClockwise = signedArea(it.ring) < 0;
    const c = contours[it.i]!;
    out.push(isClockwise === wantClockwise ? c : reverseContour(c));
  }
  return out;
}
