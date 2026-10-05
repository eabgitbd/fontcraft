// Temporary drawing helpers for the M2 editor. The M3 engine replaces the drawing path but these
// pure functions (bounds, hit testing, bearings) stay useful.
import type { Stroke } from '@/storage/types';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function strokeBounds(strokes: readonly Stroke[]): Bounds | null {
  let b: Bounds | null = null;
  for (const s of strokes) {
    if (s.erase) continue;
    const r = s.size / 2;
    for (const p of s.pts) {
      if (!b) b = { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
      else {
        b.minX = Math.min(b.minX, p.x - r);
        b.minY = Math.min(b.minY, p.y - r);
        b.maxX = Math.max(b.maxX, p.x + r);
        b.maxY = Math.max(b.maxY, p.y + r);
      }
    }
  }
  return b;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True when a circle of `radius` at (x, y) touches the painted area of the stroke. */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.size / 2;
  const pts = stroke.pts;
  if (pts.length === 0) return false;
  if (pts.length === 1) return Math.hypot(x - pts[0]!.x, y - pts[0]!.y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= reach) return true;
  }
  return false;
}

/** Side bearings measured from the ink: lsb = distance from 0 to the ink, rsb = from the ink to the advance. */
export function autoBearings(strokes: readonly Stroke[], advance: number): { lsb: number; rsb: number } | null {
  const b = strokeBounds(strokes);
  if (!b) return null;
  return { lsb: Math.max(0, Math.round(b.minX)), rsb: Math.max(0, Math.round(advance - b.maxX)) };
}

/** Drops points that are closer than `minDist` to the previous kept point (keeps the last point). */
export function thinPoints<T extends { x: number; y: number }>(pts: readonly T[], minDist: number): T[] {
  if (pts.length <= 2) return [...pts];
  const out: T[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1]!;
    if (Math.hypot(pts[i]!.x - last.x, pts[i]!.y - last.y) >= minDist) out.push(pts[i]!);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
