// Text layout for the preview: places glyphs by advance, tracking and kerning.
import type { Glyph, KernPair } from '@/storage/types';
import { isGlyphDrawn } from '@/storage/types';

export type PlacedGlyph = { char: string; x: number; glyph: Glyph };
export type TextLayout = { items: PlacedGlyph[]; width: number; missing: string[] };

export function kernLookup(pairs: readonly KernPair[]): (left: string, right: string) => number {
  const map = new Map<string, number>();
  for (const k of pairs) map.set(`${k.left}\u0000${k.right}`, k.value);
  return (l, r) => map.get(`${l}\u0000${r}`) ?? 0;
}

/**
 * Lays out one line. Characters without a drawn glyph advance by `fallbackAdvance` (spaces and
 * missing glyphs) and, if not whitespace, are reported in `missing`.
 */
export function layoutLine(
  text: string,
  glyphs: ReadonlyMap<string, Glyph>,
  kerning: readonly KernPair[],
  opts: { tracking: number; letterSpacing: number; fallbackAdvance: number },
): TextLayout {
  const kern = kernLookup(kerning);
  const chars = [...text];
  const items: PlacedGlyph[] = [];
  const missing = new Set<string>();
  let x = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const g = glyphs.get(ch);
    const drawn = !!g && isGlyphDrawn(g);
    if (drawn) items.push({ char: ch, x, glyph: g! });
    else if (!/\s/.test(ch)) missing.add(ch);
    x += (g ? g.advance : opts.fallbackAdvance) + opts.tracking + opts.letterSpacing;
    const next = chars[i + 1];
    if (next !== undefined) x += kern(ch, next);
  }
  return { items, width: Math.max(0, x), missing: [...missing] };
}

/** Splits text on newlines and lays out each line. */
export function layoutText(text: string, glyphs: ReadonlyMap<string, Glyph>, kerning: readonly KernPair[], opts: Parameters<typeof layoutLine>[3]): TextLayout[] {
  return text.split('\n').map((line) => layoutLine(line, glyphs, kerning, opts));
}
