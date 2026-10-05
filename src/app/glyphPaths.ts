// SVG path data (font units, y-up) for drawing a glyph variant in thumbnails and the preview.
import { contourToPath } from '@/engine/geometry/fit';
import { ringToPath, strokeOutline } from '@/engine/geometry/outline';
import type { Variant } from '@/storage/types';

const cache = new WeakMap<Variant, string[]>();

/**
 * Prefers the exported contours (they include erasing and pen paths). A variant that has strokes
 * but no contours yet falls back to the raw stroke outlines.
 */
export function variantPaths(v: Variant): string[] {
  let out = cache.get(v);
  if (out) return out;
  if (v.contours.length) out = v.contours.map(contourToPath);
  else out = v.strokes.filter((s) => !s.erase).map((s) => ringToPath(strokeOutline(s)));
  out = out.filter(Boolean);
  cache.set(v, out);
  return out;
}

export const hasVectorInk = (v: Variant | undefined): boolean => !!v && (v.contours.length > 0 || v.strokes.some((s) => !s.erase));
