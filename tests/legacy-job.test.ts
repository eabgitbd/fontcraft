import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/storage/db';
import { blankGlyph, createProject, getGlyph, getProject, saveGlyph } from '@/storage/projects';
import { bitmapVariants, countBitmaps, needsTracing, traceLegacyProject } from '@/scan/legacy-job';
import { importV3Project } from '@/storage/migrate-v3';
import type { Contour } from '@/storage/types';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const square: Contour = { closed: true, nodes: [{ p: { x: 100, y: 100 }, kind: 'corner' }, { p: { x: 100, y: 400 }, kind: 'corner' }, { p: { x: 400, y: 400 }, kind: 'corner' }, { p: { x: 400, y: 100 }, kind: 'corner' }] };

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(closeDB);

async function projectWithBitmaps() {
  const p = await importV3Project({
    name: 'Old', set: 'latin', chars: { A: { variants: [PNG, PNG], advance: 640, lsb: 40, rsb: 40 }, B: { variants: [PNG], advance: 500, lsb: 50, rsb: 50 }, C: { variants: [null], advance: 500, lsb: 50, rsb: 50 } },
  });
  return p;
}

describe('bitmap detection', () => {
  it('only variants that exist purely as a bitmap need tracing', () => {
    const png = new Blob(['x']);
    expect(needsTracing({ strokes: [], contours: [], legacyPng: png })).toBe(true);
    expect(needsTracing({ strokes: [], contours: [], legacyPng: png, traced: [square] })).toBe(false);
    expect(needsTracing({ strokes: [{ pts: [], size: 1 }], contours: [], legacyPng: png })).toBe(false);
    expect(needsTracing({ strokes: [], contours: [] })).toBe(false);
    expect(bitmapVariants({ ...blankGlyph('A'), variants: [{ strokes: [], contours: [], legacyPng: png }, { strokes: [], contours: [] }] })).toEqual([0]);
  });
});

describe('traceLegacyProject', () => {
  it('converts every bitmap variant and keeps the bitmap as a reference layer', async () => {
    const p = await projectWithBitmaps();
    expect(await countBitmaps(p.id)).toBe(3);
    const seen: Array<[number, number]> = [];
    const calls: Array<{ advance: number }> = [];
    const report = await traceLegacyProject(p.id, { traceLegacy: async (_b, advance) => (calls.push({ advance }), [square]) }, (d, t) => seen.push([d, t]));
    expect(report).toEqual({ converted: 3, failed: 0 });
    expect(seen[0]).toEqual([0, 3]);
    expect(seen.at(-1)).toEqual([3, 3]);
    const a = (await getGlyph(p.id, 'A'))!;
    expect(a.variants[0]!.traced).toHaveLength(1);
    expect(a.variants[1]!.traced).toHaveLength(1);
    expect(a.variants[0]!.contours.length).toBeGreaterThan(0);
    expect(a.variants[0]!.legacyPng).toBeInstanceOf(Blob);
    expect(a.advance).toBe(640); // the glyph's own width is what the mapping uses
    expect(calls.filter((c) => c.advance === 640)).toHaveLength(2);
    expect(await countBitmaps(p.id)).toBe(0);
  });

  it('does not change the progress counters and is safe to run twice', async () => {
    const p = await projectWithBitmaps();
    const before = (await getProject(p.id))!.stats;
    await traceLegacyProject(p.id, { traceLegacy: async () => [square] });
    expect((await getProject(p.id))!.stats).toEqual(before);
    const again = await traceLegacyProject(p.id, { traceLegacy: async () => { throw new Error('should not be called'); } });
    expect(again).toEqual({ converted: 0, failed: 0 });
  });

  it('an empty trace or an error is counted as failed and leaves that glyph untouched', async () => {
    const p = await projectWithBitmaps();
    let n = 0;
    const report = await traceLegacyProject(p.id, { traceLegacy: async () => { n++; if (n === 1) return []; if (n === 2) throw new Error('decode failed'); return [square]; } });
    expect(report).toEqual({ converted: 1, failed: 2 });
    const remaining = await countBitmaps(p.id);
    expect(remaining).toBe(2);
  });

  it('works on one glyph at a time and ignores glyphs without bitmaps', async () => {
    const p = await createProject({ name: 'Fresh', set: 'latin', cell: 'medium' });
    await saveGlyph(p.id, blankGlyph('A'));
    expect(await traceLegacyProject(p.id, { traceLegacy: async () => [square] })).toEqual({ converted: 0, failed: 0 });
  });

  it('an unknown project is a no-op', async () => {
    expect(await traceLegacyProject('nope', { traceLegacy: async () => [square] })).toEqual({ converted: 0, failed: 0 });
  });
});
