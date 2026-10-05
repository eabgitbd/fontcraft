// Polygon to cubic Bezier contours: corner detection plus Schneider's curve fitting
// (Graphics Gems I, "An Algorithm for Automatically Fitting Digitized Curves").
import type { Contour, PathNode } from '@/storage/types';
import type { Ring, Shape } from './types';

type V = [number, number];
type Bez = [V, V, V, V];

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: V): V => {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
};

const B0 = (t: number) => (1 - t) ** 3;
const B1 = (t: number) => 3 * t * (1 - t) ** 2;
const B2 = (t: number) => 3 * t * t * (1 - t);
const B3 = (t: number) => t ** 3;

export function bezierAt(c: Bez, t: number): V {
  return [B0(t) * c[0][0] + B1(t) * c[1][0] + B2(t) * c[2][0] + B3(t) * c[3][0], B0(t) * c[0][1] + B1(t) * c[1][1] + B2(t) * c[2][1] + B3(t) * c[3][1]];
}
function d1(c: Bez, t: number): V {
  const a = sub(c[1], c[0]);
  const b = sub(c[2], c[1]);
  const d = sub(c[3], c[2]);
  return [3 * ((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * d[0]), 3 * ((1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * d[1])];
}
function d2(c: Bez, t: number): V {
  const a: V = [c[2][0] - 2 * c[1][0] + c[0][0], c[2][1] - 2 * c[1][1] + c[0][1]];
  const b: V = [c[3][0] - 2 * c[2][0] + c[1][0], c[3][1] - 2 * c[2][1] + c[1][1]];
  return [6 * ((1 - t) * a[0] + t * b[0]), 6 * ((1 - t) * a[1] + t * b[1])];
}

function chordParams(pts: V[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1]! + dist(pts[i]!, pts[i - 1]!));
  const total = u[u.length - 1]! || 1;
  return u.map((x) => x / total);
}

function generateBezier(pts: V[], u: number[], t1: V, t2: V): Bez {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i]!;
    const a0 = mul(t1, B1(t));
    const a1 = mul(t2, B2(t));
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const tmp = sub(pts[i]!, add(mul(first, B0(t) + B1(t)), mul(last, B2(t) + B3(t))));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const seg = dist(first, last);
  if (al < 1e-6 * seg || ar < 1e-6 * seg) al = ar = seg / 3;
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function maxError(pts: V[], c: Bez, u: number[]): { err: number; split: number } {
  let err = 0;
  let split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(bezierAt(c, u[i]!), pts[i]!);
    if (d > err) {
      err = d;
      split = i;
    }
  }
  return { err, split };
}

function reparameterize(pts: V[], u: number[], c: Bez): number[] {
  return u.map((t, i) => {
    const q = bezierAt(c, t);
    const q1 = d1(c, t);
    const q2 = d2(c, t);
    const diff = sub(q, pts[i]!);
    const num = dot(diff, q1);
    const den = dot(q1, q1) + dot(diff, q2);
    return Math.abs(den) < 1e-12 ? t : Math.min(1, Math.max(0, t - num / den));
  });
}

/** Fits `pts` with as few cubics as needed. t1 points into the curve from the first point, t2 into it from the last. */
export function fitCubic(pts: V[], t1: V, t2: V, tolerance: number, out: Bez[] = []): Bez[] {
  if (pts.length < 2) return out;
  if (pts.length === 2) {
    const d = dist(pts[0]!, pts[1]!) / 3;
    out.push([pts[0]!, add(pts[0]!, mul(t1, d)), add(pts[1]!, mul(t2, d)), pts[1]!]);
    return out;
  }
  let u = chordParams(pts);
  let bez = generateBezier(pts, u, t1, t2);
  let { err, split } = maxError(pts, bez, u);
  if (err < tolerance) return (out.push(bez), out);
  if (err < tolerance * 4) {
    for (let i = 0; i < 6; i++) {
      u = reparameterize(pts, u, bez);
      bez = generateBezier(pts, u, t1, t2);
      ({ err, split } = maxError(pts, bez, u));
      if (err < tolerance) return (out.push(bez), out);
    }
  }
  const center = unit(sub(pts[split - 1]!, pts[split + 1]!));
  fitCubic(pts.slice(0, split + 1), t1, center, tolerance, out);
  fitCubic(pts.slice(split), mul(center, -1), t2, tolerance, out);
  return out;
}

export type FitOptions = {
  /** Maximum distance between the polygon and the fitted curve, in font units. */
  tolerance?: number;
  /** Turn angle in degrees above which a vertex is kept as a sharp corner. */
  cornerAngle?: number;
};

function cleanRing(ring: Ring): V[] {
  const out: V[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || dist(last, p as V) > 1e-6) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= 1e-6) out.pop();
  return out;
}

/**
 * Inserts points along long edges. The fitter only measures error at the points it is given, so a
 * 400-unit straight edge with no vertices in between could otherwise be replaced by a bulging curve.
 */
function densify(pts: V[], maxSeg: number): V[] {
  const out: V[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a);
    const steps = Math.floor(dist(a, b) / maxSeg);
    for (let k = 1; k <= steps; k++) {
      const f = k / (steps + 1);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

class Arc {
  readonly cum: number[] = [0];
  readonly total: number;
  constructor(readonly pts: V[]) {
    for (let i = 0; i < pts.length; i++) this.cum.push(this.cum[i]! + dist(pts[i]!, pts[(i + 1) % pts.length]!));
    this.total = this.cum[pts.length]!;
  }
  at(d: number): V {
    const n = this.pts.length;
    let x = d % this.total;
    if (x < 0) x += this.total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid]! <= x) lo = mid;
      else hi = mid - 1;
    }
    const a = this.pts[lo]!;
    const b = this.pts[(lo + 1) % n]!;
    const seg = this.cum[lo + 1]! - this.cum[lo]!;
    const f = seg < 1e-12 ? 0 : (x - this.cum[lo]!) / seg;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
}

function findCorners(pts: V[], arc: Arc, w: number, thresholdRad: number): number[] {
  const n = pts.length;
  const turn = pts.map((p, i) => {
    const a = arc.at(arc.cum[i]! - w);
    const b = arc.at(arc.cum[i]! + w);
    const va = sub(p, a);
    const vb = sub(b, p);
    const la = len(va);
    const lb = len(vb);
    if (la < 1e-9 || lb < 1e-9) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot(va, vb) / (la * lb))));
  });
  const circ = (i: number, j: number) => {
    const d = Math.abs(arc.cum[i]! - arc.cum[j]!);
    return Math.min(d, arc.total - d);
  };
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i]! < thresholdRad) continue;
    let best = true;
    for (let j = 0; j < n && best; j++) {
      if (j === i || circ(i, j) > w) continue;
      if (turn[j]! > turn[i]! || (turn[j] === turn[i] && j < i)) best = false;
    }
    if (best) corners.push(i);
  }
  return corners;
}

const handle = (anchor: V, h: V): { x: number; y: number } | undefined => (dist(anchor, h) < 1e-6 ? undefined : { x: h[0], y: h[1] });

function isStraight(b: Bez, eps = 1e-3): boolean {
  const l = dist(b[0], b[3]);
  if (l < 1e-9) return true;
  const off = (p: V) => Math.abs((p[0] - b[0][0]) * (b[3][1] - b[0][1]) - (p[1] - b[0][1]) * (b[3][0] - b[0][0])) / l;
  return off(b[1]) < eps && off(b[2]) < eps;
}

/** Turns one polygon ring into a closed Bezier contour. */
export function fitRing(ring: Ring, opts: FitOptions = {}): Contour {
  const tol = Math.max(0.05, opts.tolerance ?? 1.5);
  const thr = ((opts.cornerAngle ?? 55) * Math.PI) / 180;
  const cleaned = cleanRing(ring);
  const pts = cleaned.length < 3 ? cleaned : densify(cleaned, 4);
  const n = pts.length;
  if (n < 3) return { nodes: pts.map((p) => ({ p: { x: p[0], y: p[1] }, kind: 'corner' as const })), closed: true };

  const arc = new Arc(pts);
  const w = Math.min(12, Math.max(3, arc.total * 0.015));
  let corners = findCorners(pts, arc, w, thr);

  // runs[k] is a polyline between two split vertices, with its end tangents.
  const runs: Array<{ pts: V[]; t1: V; t2: V; startsAt: number }> = [];
  const smoothSplit = corners.length === 0;
  if (smoothSplit) {
    let half = 0;
    for (let i = 1; i < n; i++) if (Math.abs(arc.cum[i]! - arc.total / 2) < Math.abs(arc.cum[half]! - arc.total / 2) || half === 0) half = i;
    corners = [0, Math.max(1, Math.min(n - 1, half))];
  }
  const tangentAt = (i: number): V => unit(sub(arc.at(arc.cum[i]! + w), arc.at(arc.cum[i]! - w)));

  for (let k = 0; k < corners.length; k++) {
    const a = corners[k]!;
    const b = corners[(k + 1) % corners.length]!;
    const run: V[] = [];
    let i = a;
    do {
      run.push(pts[i]!);
      i = (i + 1) % n;
    } while (i !== b);
    run.push(pts[b]!);
    if (run.length < 2) continue;
    let t1: V;
    let t2: V;
    if (smoothSplit) {
      t1 = tangentAt(a);
      t2 = mul(tangentAt(b), -1);
    } else {
      let runLen = 0;
      for (let q = 1; q < run.length; q++) runLen += dist(run[q - 1]!, run[q]!);
      const reach = Math.max(1e-6, Math.min(w, runLen / 2));
      // Direction of the run as it leaves its first point and arrives at its last.
      const startDir = pointAlong(run, reach);
      const endDir = pointAlong([...run].reverse(), reach);
      t1 = unit(sub(startDir, run[0]!));
      t2 = unit(sub(endDir, run[run.length - 1]!));
    }
    runs.push({ pts: run, t1, t2, startsAt: a });
  }

  // Fit each run, then stitch the segments into nodes.
  const segsPerRun = runs.map((r) => fitCubic(r.pts, r.t1, r.t2, tol));
  const nodes: PathNode[] = [];
  for (let r = 0; r < runs.length; r++) {
    const segs = segsPerRun[r]!;
    const prevSegs = segsPerRun[(r + runs.length - 1) % runs.length]!;
    const first = segs[0]!;
    const prevLast = prevSegs[prevSegs.length - 1]!;
    const startNode: PathNode = {
      p: { x: first[0][0], y: first[0][1] },
      hOut: isStraight(first) ? undefined : handle(first[0], first[1]),
      hIn: isStraight(prevLast) ? undefined : handle(first[0], prevLast[2]),
      kind: smoothSplit ? 'smooth' : 'corner',
    };
    nodes.push(startNode);
    for (let s = 1; s < segs.length; s++) {
      const inc = segs[s - 1]!;
      const out = segs[s]!;
      nodes.push({
        p: { x: out[0][0], y: out[0][1] },
        hIn: isStraight(inc) ? undefined : handle(out[0], inc[2]),
        hOut: isStraight(out) ? undefined : handle(out[0], out[1]),
        kind: 'smooth',
      });
    }
  }
  for (const nd of nodes) {
    if (!nd.hIn) delete nd.hIn;
    if (!nd.hOut) delete nd.hOut;
  }
  return { nodes, closed: true };
}

/** Point at arc distance `d` along an open polyline (clamped to its end). */
function pointAlong(poly: V[], d: number): V {
  let left = d;
  for (let i = 1; i < poly.length; i++) {
    const seg = dist(poly[i - 1]!, poly[i]!);
    if (left <= seg && seg > 0) {
      const f = left / seg;
      return [poly[i - 1]![0] + (poly[i]![0] - poly[i - 1]![0]) * f, poly[i - 1]![1] + (poly[i]![1] - poly[i - 1]![1]) * f];
    }
    left -= seg;
  }
  return poly[poly.length - 1]!;
}

export function fitShapes(shapes: readonly Shape[], opts: FitOptions = {}): Contour[] {
  const out: Contour[] = [];
  for (const s of shapes) {
    out.push(fitRing(s.outer, opts));
    for (const h of s.holes) out.push(fitRing(h, opts));
  }
  return out;
}

/** Svg path data for a contour in font units (y-up; the caller flips). */
export function contourToPath(c: Contour): string {
  const n = c.nodes.length;
  if (n === 0) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  const P = (p: { x: number; y: number }) => `${f(p.x)} ${f(p.y)}`;
  let d = `M${P(c.nodes[0]!.p)}`;
  const segs = c.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = c.nodes[i]!;
    const b = c.nodes[(i + 1) % n]!;
    if (!a.hOut && !b.hIn) d += `L${P(b.p)}`;
    else d += `C${P(a.hOut ?? a.p)} ${P(b.hIn ?? b.p)} ${P(b.p)}`;
  }
  return c.closed ? d + 'Z' : d;
}
