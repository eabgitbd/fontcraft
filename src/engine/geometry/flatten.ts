import type { Contour, Pt } from '@/storage/types';
import type { Ring } from './types';

type P = readonly [number, number];

function distToChord(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** Adaptive de Casteljau flattening of one cubic. Pushes every point after `p0`. */
export function flattenCubic(p0: P, p1: P, p2: P, p3: P, tol: number, out: Ring, depth = 0): void {
  if (depth > 16 || Math.max(distToChord(p1, p0, p3), distToChord(p2, p0, p3)) <= tol) {
    out.push([p3[0], p3[1]]);
    return;
  }
  const m01: P = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: P = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: P = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const a: P = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const b: P = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  flattenCubic(p0, m01, a, mid, tol, out, depth + 1);
  flattenCubic(mid, b, m23, p3, tol, out, depth + 1);
}

const pt = (p: Pt): P => [p.x, p.y];

/** Polyline for a contour. For closed contours the result is a ring without the repeated first point. */
export function flattenContour(c: Contour, tol = 0.4): Ring {
  const n = c.nodes.length;
  if (n === 0) return [];
  const out: Ring = [[c.nodes[0]!.p.x, c.nodes[0]!.p.y]];
  const segs = c.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = c.nodes[i]!;
    const b = c.nodes[(i + 1) % n]!;
    flattenCubic(pt(a.p), pt(a.hOut ?? a.p), pt(b.hIn ?? b.p), pt(b.p), tol, out);
  }
  if (c.closed && out.length > 1) out.pop(); // last point duplicates the first
  return out;
}
