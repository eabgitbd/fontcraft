// Stroke to polygon, using perfect-freehand for pressure-aware, naturally tapered outlines.
import { getStroke } from 'perfect-freehand';
import type { Stroke } from '@/storage/types';
import type { Ring } from './types';

/** Finger and mouse input report a constant 0.5; only a real pen varies. */
export function hasRealPressure(s: Stroke): boolean {
  return s.pts.some((p) => Math.abs(p.pressure - 0.5) > 1e-3);
}

export function outlineOf(stroke: Pick<Stroke, 'pts' | 'size'>, real = false): Ring {
  if (stroke.pts.length === 0) return [];
  const pts = stroke.pts.map((p) => [p.x, p.y, p.pressure]);
  return getStroke(pts, {
    size: Math.max(1, stroke.size),
    thinning: real ? 0.6 : 0.5,
    smoothing: 0.5,
    streamline: 0.25,
    simulatePressure: !real,
    last: true,
  }) as Ring;
}

const cache = new WeakMap<Stroke, Ring>();

/** Cached by stroke identity: strokes are immutable once committed. */
export function strokeOutline(stroke: Stroke): Ring {
  let r = cache.get(stroke);
  if (!r) {
    r = outlineOf(stroke, hasRealPressure(stroke));
    cache.set(stroke, r);
  }
  return r;
}

/** Constant-width outline along a polyline (pen-tool paths). */
export function constantWidthOutline(points: ReadonlyArray<readonly [number, number]>, size: number): Ring {
  if (points.length === 0) return [];
  return getStroke(
    points.map((p) => [p[0], p[1], 0.5]),
    { size: Math.max(1, size), thinning: 0, smoothing: 0, streamline: 0, simulatePressure: false, last: true },
  ) as Ring;
}

/** SVG path data for a closed ring, smoothed with quadratic midpoints (perfect-freehand's recipe). */
export function ringToPath(ring: Ring): string {
  const n = ring.length;
  if (n < 3) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(ring[0]![0])},${f(ring[0]![1])}Q`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `;
  }
  return d + 'Z';
}
