import type { PenPath, Pt, Stroke } from '@/storage/types';
import { strokeHit, distToSegment } from './basic';
import { flattenContour } from './geometry/flatten';

export type Hit = { kind: 'stroke' | 'path'; index: number };

function insideRing(p: Pt, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pathHit(path: PenPath, p: Pt, radius: number): boolean {
  const flat = flattenContour(path, 0.5);
  if (flat.length === 0) return false;
  if (path.closed && insideRing(p, flat)) return true;
  const reach = radius + path.size / 2;
  const n = path.closed ? flat.length : flat.length - 1;
  for (let i = 0; i < n; i++) {
    const a = flat[i]!;
    const b = flat[(i + 1) % flat.length]!;
    if (distToSegment(p.x, p.y, a[0], a[1], b[0], b[1]) <= reach) return true;
  }
  return false;
}

/** Topmost object under `p`. Strokes sit above pen paths; eraser strokes are not selectable. */
export function hitTest(strokes: readonly Stroke[], paths: readonly PenPath[], p: Pt, radius: number): Hit | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    if (!s.erase && strokeHit(s, p.x, p.y, radius)) return { kind: 'stroke', index: i };
  }
  for (let i = paths.length - 1; i >= 0; i--) if (pathHit(paths[i]!, p, radius)) return { kind: 'path', index: i };
  return null;
}
