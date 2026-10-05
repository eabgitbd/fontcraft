// Putting imported vector artwork (a traced scan, an SVG, a traced bitmap) into glyphs.
import type { Contour, Glyph, Variant } from '@/storage/types';
import { MAX_VARIANTS, emptyVariant, isVariantDrawn } from '@/storage/types';
import { buildContours } from './geometry/build';

const TOLERANCE = 1.5;

/** Recomputes a variant's exported contours from all of its raw input. */
export function rebuildVariant(v: Variant, tolerance = TOLERANCE): Variant {
  return { ...v, contours: buildContours(v.strokes, v.paths ?? [], { tolerance }, v.traced ?? []) };
}

/**
 * Sets the imported-artwork layer of variant `vi` and rebuilds its contours. Strokes the user already
 * drew are kept (and still sit on top). `metrics` optionally sets the glyph's widths.
 */
export function withTraced(g: Glyph, vi: number, traced: readonly Contour[], metrics?: { advance: number; lsb: number; rsb: number }): Glyph {
  const variants = g.variants.map((v, i) => {
    if (i !== vi) return v;
    const { traced: _old, ...rest } = v;
    return rebuildVariant({ ...rest, ...(traced.length ? { traced: [...traced] } : {}) });
  });
  return { ...g, ...(metrics ? metrics : {}), variants };
}

export type ImportPolicy = 'variant' | 'replace';

/**
 * Where should a newly imported drawing go? An empty first variant is used first; otherwise, with
 * `variant`, the next empty variant or a new one (up to the limit); with `replace` (or when all four
 * are taken) variant 0 is replaced. Returns the index and the glyph that has room for it.
 */
export function slotForImport(g: Glyph, policy: ImportPolicy): { glyph: Glyph; index: number } {
  if (!isVariantDrawn(g.variants[0])) return { glyph: g, index: 0 };
  if (policy === 'replace') return { glyph: g, index: 0 };
  const empty = g.variants.findIndex((v) => !isVariantDrawn(v));
  if (empty >= 0) return { glyph: g, index: empty };
  if (g.variants.length < MAX_VARIANTS) return { glyph: { ...g, variants: [...g.variants, emptyVariant()] }, index: g.variants.length };
  return { glyph: g, index: MAX_VARIANTS - 1 };
}

/** Imports art into a glyph following `policy`, optionally replacing the artwork wholesale. */
export function importArtInto(g: Glyph, art: { contours: Contour[]; advance: number; lsb: number; rsb: number }, policy: ImportPolicy): { glyph: Glyph; index: number } {
  const slot = slotForImport(g, policy);
  // Only the first variant defines the glyph's widths.
  const setWidths = slot.index === 0 || !isVariantDrawn(g.variants[0]);
  const base = policy === 'replace' && slot.index === 0 ? { ...slot.glyph, variants: slot.glyph.variants.map((v, i) => (i === 0 ? emptyVariantKeepingRef(v) : v)) } : slot.glyph;
  return { glyph: withTraced(base, slot.index, art.contours, setWidths ? { advance: art.advance, lsb: art.lsb, rsb: art.rsb } : undefined), index: slot.index };
}

/** A replaced variant loses its own drawing but keeps the old bitmap as a reference layer, if any. */
function emptyVariantKeepingRef(v: Variant): Variant {
  return { strokes: [], contours: [], ...(v.legacyPng ? { legacyPng: v.legacyPng } : {}) };
}
