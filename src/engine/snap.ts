import type { Pt } from '@/storage/types';

export type SnapGuides = { xs: readonly number[]; ys: readonly number[] };

/** Snaps `p` to the nearest guide line within `threshold` font units on each axis. */
export function snapToGuides(p: Pt, guides: SnapGuides, threshold: number): { p: Pt; snapped: boolean } {
  let x = p.x;
  let y = p.y;
  let bx = threshold;
  let by = threshold;
  let snapped = false;
  for (const gx of guides.xs) {
    const d = Math.abs(p.x - gx);
    if (d <= bx) {
      bx = d;
      x = gx;
      snapped = true;
    }
  }
  for (const gy of guides.ys) {
    const d = Math.abs(p.y - gy);
    if (d <= by) {
      by = d;
      y = gy;
      snapped = true;
    }
  }
  return { p: { x, y }, snapped };
}
