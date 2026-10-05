import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB, getDB, isQuotaError } from '@/storage/db';
import {
  blankGlyph,
  createProject,
  deleteProject,
  getGlyph,
  getProject,
  listGlyphs,
  listProjects,
  saveGlyph,
  setKerning,
  setLigatures,
  updateProject,
} from '@/storage/projects';
import { MAX_VARIANTS, type Glyph, type Stroke } from '@/storage/types';

const stroke: Stroke = { pts: [{ x: 10, y: 10, pressure: 0.5 }, { x: 200, y: 300, pressure: 0.6 }], size: 20 };
const drawn = (char: string, variants = 1): Glyph => ({
  ...blankGlyph(char),
  variants: Array.from({ length: variants }, () => ({ strokes: [stroke], contours: [] })),
});

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeDB();
});

describe('createProject', () => {
  it('creates one empty glyph record per character', async () => {
    const p = await createProject({ name: '  My Hand ', set: 'latin', cell: 'standard' });
    expect(p.name).toBe('My Hand');
    expect(p.schema).toBe(4);
    expect(p.stats).toEqual({ total: 52, drawn: 0, withVariants: 0 });
    const glyphs = await listGlyphs(p.id);
    expect(glyphs).toHaveLength(52);
    expect(glyphs[0]!.variants).toHaveLength(1);
    expect(glyphs.every((g) => g.advance === 500 && g.lsb === 50 && g.rsb === 50)).toBe(true);
  });

  it('applies the default metrics from settings to new glyphs', async () => {
    const p = await createProject({ name: 'Wide', set: 'latin', cell: 'x', settings: { defWidth: 640, defLsb: 30, defRsb: 40 } });
    const a = await getGlyph(p.id, 'A');
    expect([a?.advance, a?.lsb, a?.rsb]).toEqual([640, 30, 40]);
  });

  it('rejects a blank name and writes nothing', async () => {
    await expect(createProject({ name: '   ', set: 'latin', cell: 'x' })).rejects.toThrow(/name/i);
    expect(await listProjects()).toEqual([]);
  });

  it('supports the Bengali set including conjunct glyph keys', async () => {
    const p = await createProject({ name: 'বাংলা', set: 'bengali', cell: 'x' });
    expect(p.stats.total).toBe(76);
    expect(await getGlyph(p.id, 'ক্ষ')).toBeDefined();
  });
});

describe('saveGlyph', () => {
  it('writes only that glyph and updates the counters', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    const after = await saveGlyph(p.id, drawn('A'));
    expect(after.stats).toEqual({ total: 52, drawn: 1, withVariants: 0 });
    expect((await getGlyph(p.id, 'A'))?.variants[0]?.strokes).toHaveLength(1);
    expect((await getGlyph(p.id, 'B'))?.variants[0]?.strokes).toHaveLength(0);
  });

  it('counts variants and never double-counts a re-save', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    await saveGlyph(p.id, drawn('A', 2));
    const again = await saveGlyph(p.id, drawn('A', 3));
    expect(again.stats).toEqual({ total: 52, drawn: 1, withVariants: 1 });
  });

  it('decrements the counters when a glyph is cleared', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    await saveGlyph(p.id, drawn('A', 2));
    const cleared = await saveGlyph(p.id, blankGlyph('A'));
    expect(cleared.stats).toEqual({ total: 52, drawn: 0, withVariants: 0 });
  });

  it('clamps variants to the maximum and never stores zero variants', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    await saveGlyph(p.id, drawn('A', 9));
    expect((await getGlyph(p.id, 'A'))?.variants).toHaveLength(MAX_VARIANTS);
    await saveGlyph(p.id, { ...blankGlyph('B'), variants: [] });
    expect((await getGlyph(p.id, 'B'))?.variants).toHaveLength(1);
  });

  it('adds a glyph that was not in the original set and bumps the total', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    const after = await saveGlyph(p.id, drawn('ফ্র'));
    expect(after.stats.total).toBe(53);
  });

  it('fails clearly for an unknown project', async () => {
    await expect(saveGlyph('nope', drawn('A'))).rejects.toThrow(/not found/);
  });

  it('keeps stats identical to a full recount after many saves', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    for (const [c, v] of [['A', 1], ['B', 2], ['C', 3], ['A', 2], ['D', 1]] as const) await saveGlyph(p.id, drawn(c, v));
    await saveGlyph(p.id, blankGlyph('D'));
    const stored = (await getProject(p.id))!.stats;
    const all = await listGlyphs(p.id);
    const recount = {
      total: all.length,
      drawn: all.filter((g) => g.variants[0]!.strokes.length > 0).length,
      withVariants: all.filter((g) => g.variants.filter((x) => x.strokes.length > 0).length > 1).length,
    };
    expect(stored).toEqual(recount);
  });
});

describe('updateProject, ligatures and kerning', () => {
  it('updates settings and keeps identity fields fixed', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    const next = await updateProject(p.id, { name: 'Renamed', settings: { ...p.settings, designer: 'Rafi' } });
    expect(next.id).toBe(p.id);
    expect(next.schema).toBe(4);
    expect(next.name).toBe('Renamed');
    expect(next.settings.designer).toBe('Rafi');
    expect(next.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it('keeps the old name if the new one is blank', async () => {
    const p = await createProject({ name: 'Keep', set: 'latin', cell: 'x' });
    expect((await updateProject(p.id, { name: '  ' })).name).toBe('Keep');
  });

  it('persists ligatures and kerning with the v3 field names', async () => {
    const p = await createProject({ name: 'T', set: 'latin', cell: 'x' });
    await setLigatures(p.id, [{ input: 'fi', output: 'fi_lig', name: 'fi ligature' }]);
    await setKerning(p.id, [{ left: 'A', right: 'V', value: -60 }]);
    const back = (await getProject(p.id))!;
    expect(back.ligatures).toEqual([{ input: 'fi', output: 'fi_lig', name: 'fi ligature' }]);
    expect(back.kerning).toEqual([{ left: 'A', right: 'V', value: -60 }]);
  });

  it('throws for an unknown project', async () => {
    await expect(updateProject('nope', { name: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('listProjects and deleteProject', () => {
  it('lists newest-updated first', async () => {
    const a = await createProject({ name: 'A', set: 'latin', cell: 'x' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createProject({ name: 'B', set: 'latin', cell: 'x' });
    expect((await listProjects()).map((p) => p.id)).toEqual([b.id, a.id]);
    await new Promise((r) => setTimeout(r, 5));
    await updateProject(a.id, { name: 'A2' });
    expect((await listProjects())[0]!.id).toBe(a.id);
  });

  it('removes the project, its glyphs, blobs and backups, and nothing else', async () => {
    const keep = await createProject({ name: 'Keep', set: 'latin', cell: 'x' });
    const gone = await createProject({ name: 'Gone', set: 'latin', cell: 'x' });
    const db = await getDB();
    await db.put('blobs', { id: `${gone.id}/ref`, projectId: gone.id, name: 'ref', blob: new Blob(['x']), createdAt: 1 });
    await db.put('blobs', { id: `${keep.id}/ref`, projectId: keep.id, name: 'ref', blob: new Blob(['y']), createdAt: 1 });
    await db.put('backups', { id: 'b1', projectId: gone.id, projectName: 'Gone', createdAt: 1, data: new Blob(['z']), bytes: 1 });

    await deleteProject(gone.id);

    expect(await getProject(gone.id)).toBeUndefined();
    expect(await listGlyphs(gone.id)).toHaveLength(0);
    expect(await db.getAllFromIndex('blobs', 'byProject', gone.id)).toHaveLength(0);
    expect(await db.getAllFromIndex('backups', 'byProject', gone.id)).toHaveLength(0);
    expect(await listGlyphs(keep.id)).toHaveLength(52);
    expect(await db.getAllFromIndex('blobs', 'byProject', keep.id)).toHaveLength(1);
  });
});

describe('isQuotaError', () => {
  it('recognises the browser quota errors and nothing else', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
  });
});

describe('putGlyphAndProject (the autosave path)', () => {
  it('writes the glyph and the counters together, matching a full recount', async () => {
    const { putGlyphAndProject, statsOf } = await import('@/storage/projects');
    const p = await createProject({ name: 'Fast', set: 'latin', cell: 'x' });
    const g = drawn('A', 2);
    const all = (await listGlyphs(p.id)).map((x) => (x.char === 'A' ? g : x));
    const next = await putGlyphAndProject(p, g, statsOf(all));
    expect(next.stats).toEqual({ total: 52, drawn: 1, withVariants: 1 });
    expect((await getGlyph(p.id, 'A'))!.variants).toHaveLength(2);
    expect((await getProject(p.id))!.stats).toEqual(next.stats);
  });

  it('never reads before writing (reads cannot complete while a page is unloading)', async () => {
    const { putGlyphAndProject } = await import('@/storage/projects');
    const p = await createProject({ name: 'NoReads', set: 'latin', cell: 'x' });
    const calls: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = IDBObjectStore.prototype as any;
    for (const m of ['get', 'getAll', 'getKey', 'openCursor', 'count']) {
      const orig = proto[m];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(proto, m).mockImplementation(function (this: any, ...a: any[]) {
        calls.push(m);
        return orig.apply(this, a);
      });
    }
    await putGlyphAndProject(p, drawn('B'), { total: 52, drawn: 1, withVariants: 0 });
    expect(calls).toEqual([]);
  });
});
