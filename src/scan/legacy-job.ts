// Converts v3 bitmap glyphs (kept as reference layers by the migration) into editable vector art.
import { rebuildVariant } from '@/engine/art';
import { getProject, listGlyphs, saveGlyph } from '@/storage/projects';
import type { Glyph, Variant } from '@/storage/types';
import type { ScanEngine } from './engine';

/** A variant that only exists as a v3 bitmap. */
export const needsTracing = (v: Variant): boolean => !!v.legacyPng && !v.traced?.length && v.strokes.length === 0 && v.contours.length === 0 && !(v.paths?.length ?? 0);

export const bitmapVariants = (g: Glyph): number[] => g.variants.flatMap((v, i) => (needsTracing(v) ? [i] : []));

export async function countBitmaps(projectId: string): Promise<number> {
  const glyphs = await listGlyphs(projectId);
  return glyphs.reduce((n, g) => n + bitmapVariants(g).length, 0);
}

export type TraceReport = { converted: number; failed: number };

/** Traces every bitmap-only variant of a project. Safe to run again: converted variants are skipped. */
export async function traceLegacyProject(projectId: string, engine: Pick<ScanEngine, 'traceLegacy'>, onProgress?: (done: number, total: number) => void): Promise<TraceReport> {
  const project = await getProject(projectId);
  if (!project) return { converted: 0, failed: 0 };
  const m = { ascender: project.settings.ascender, descender: project.settings.descender, capheight: project.settings.capheight, defLsb: project.settings.defLsb, defRsb: project.settings.defRsb };
  const glyphs = await listGlyphs(projectId);
  const total = glyphs.reduce((n, g) => n + bitmapVariants(g).length, 0);
  let done = 0, converted = 0, failed = 0;
  onProgress?.(0, total);
  for (const g of glyphs) {
    const todo = bitmapVariants(g);
    if (!todo.length) continue;
    let next = g;
    for (const vi of todo) {
      try {
        const v = next.variants[vi]!;
        const contours = await engine.traceLegacy(v.legacyPng!, next.advance, m);
        if (contours.length) {
          const variants = next.variants.map((x, i) => (i === vi ? rebuildVariant({ ...x, traced: contours }) : x));
          next = { ...next, variants };
          converted++;
        } else failed++;
      } catch (e) {
        console.warn('FontCraft: could not trace a bitmap glyph', g.char, e);
        failed++;
      }
      onProgress?.(++done, total);
      await new Promise((r) => setTimeout(r, 0)); // let the progress screen paint
    }
    if (next !== g) await saveGlyph(projectId, next);
  }
  return { converted, failed };
}
