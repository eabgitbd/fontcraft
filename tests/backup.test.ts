import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { zipSync, strToU8 } from 'fflate';
import { closeDB, getDB } from '@/storage/db';
import {
  BackupTrigger,
  MAX_BACKUPS_PER_PROJECT,
  createBackup,
  exportFcproj,
  importFcproj,
  importProjectFile,
  listBackups,
  migrateProjectJson,
  restoreBackup,
} from '@/storage/backup';
import { blankGlyph, createProject, getGlyph, getProject, listGlyphs, listProjects, saveGlyph, setKerning, setLigatures, updateProject } from '@/storage/projects';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function sampleProject() {
  const p = await createProject({ name: 'Sample ক', set: 'latin', cell: 'x' });
  await updateProject(p.id, { settings: { ...p.settings, designer: 'Rafi', ascender: 830 } });
  await setLigatures(p.id, [{ input: 'fi', output: 'fi_lig', name: 'fi' }]);
  await setKerning(p.id, [{ left: 'A', right: 'V', value: -55 }]);
  await saveGlyph(p.id, {
    ...blankGlyph('A'),
    advance: 640,
    variants: [
      { strokes: [{ pts: [{ x: 1, y: 2, pressure: 0.4 }, { x: 300, y: 400, pressure: 0.9 }], size: 22 }], contours: [] },
      { strokes: [], contours: [{ closed: true, nodes: [{ p: { x: 0, y: 0 }, kind: 'corner' }] }], legacyPng: new Blob([PNG], { type: 'image/png' }) },
    ],
  });
  return p;
}

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeDB();
});

describe('.fcproj round trip', () => {
  it('restores project settings, ligatures, kerning, glyph metrics, strokes, contours and bitmaps', async () => {
    const src = await sampleProject();
    const blob = await exportFcproj(src.id);
    const copy = await importFcproj(blob);

    expect(copy.id).not.toBe(src.id);
    expect(copy.name).toBe('Sample ক');
    expect(copy.settings.designer).toBe('Rafi');
    expect(copy.settings.ascender).toBe(830);
    expect(copy.ligatures).toEqual([{ input: 'fi', output: 'fi_lig', name: 'fi' }]);
    expect(copy.kerning).toEqual([{ left: 'A', right: 'V', value: -55 }]);
    expect(copy.stats).toEqual({ total: 52, drawn: 1, withVariants: 1 });

    const a = (await getGlyph(copy.id, 'A'))!;
    expect(a.advance).toBe(640);
    expect(a.variants).toHaveLength(2);
    expect(a.variants[0]!.strokes[0]!.pts[1]).toEqual({ x: 300, y: 400, pressure: 0.9 });
    expect(a.variants[1]!.contours[0]!.nodes[0]!.kind).toBe('corner');
    expect(new Uint8Array(await a.variants[1]!.legacyPng!.arrayBuffer())).toEqual(PNG);
    expect(await listGlyphs(copy.id)).toHaveLength(52);
    // The original is untouched and both coexist.
    expect(await listProjects()).toHaveLength(2);
  });

  it('keeps Bengali characters as glyph keys', async () => {
    const p = await createProject({ name: 'bn', set: 'bengali', cell: 'x' });
    const copy = await importFcproj(await exportFcproj(p.id));
    expect(await getGlyph(copy.id, 'ক্ষ')).toBeDefined();
    expect(copy.stats.total).toBe(76);
  });
});

describe('importProjectFile', () => {
  it('detects a zip by its signature', async () => {
    const src = await sampleProject();
    const copy = await importProjectFile(await exportFcproj(src.id), 'x.fcproj');
    expect(copy.name).toBe('Sample ক');
  });

  it('imports a v3 *_fontcraft.json backup', async () => {
    const v3 = { name: 'Legacy', set: 'latin', chars: { A: { variants: [null], advance: 600, lsb: 50, rsb: 50 } }, ligatures: [], kerning: [{ left: 'A', right: 'V', value: -30 }] };
    const copy = await importProjectFile(new Blob([JSON.stringify(v3)]), 'Legacy_fontcraft.json');
    expect(copy.name).toBe('Legacy');
    expect(copy.kerning).toHaveLength(1);
    expect((await getGlyph(copy.id, 'A'))?.advance).toBe(600);
  });

  it('gives clear errors for unusable files and stores nothing', async () => {
    await expect(importProjectFile(new Blob(['hello']), 'a.txt')).rejects.toThrow(/not a FontCraft project/);
    await expect(importProjectFile(new Blob([JSON.stringify({ hello: 1 })]), 'a.json')).rejects.toThrow(/v3/);
    await expect(importProjectFile(new Blob([new Uint8Array([0x50, 0x4b, 1, 2, 3])]), 'a.fcproj')).rejects.toThrow(/not a FontCraft project/);
    const noMeta = zipSync({ 'readme.txt': strToU8('hi') });
    await expect(importFcproj(noMeta)).rejects.toThrow(/project\.json/);
    const wrongFormat = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'other' })) });
    await expect(importFcproj(wrongFormat)).rejects.toThrow(/not a FontCraft project/);
    const broken = zipSync({ 'project.json': strToU8('{oops') });
    await expect(importFcproj(broken)).rejects.toThrow(/damaged/);
    expect(await listProjects()).toEqual([]);
  });

  it('refuses a project from a newer app version', async () => {
    const future = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'fontcraft-project', schema: 99, project: { name: 'x' } })) });
    await expect(importFcproj(future)).rejects.toThrow(/newer version/);
  });
});

describe('migrateProjectJson', () => {
  it('runs each step in order until the target schema', () => {
    const order: number[] = [];
    const migrations = {
      2: (j: Record<string, unknown>) => (order.push(2), { ...j, schema: 3 }),
      3: (j: Record<string, unknown>) => (order.push(3), { ...j, schema: 4, added: true }),
    };
    const out = migrateProjectJson({ schema: 2 }, migrations, 4);
    expect(order).toEqual([2, 3]);
    expect(out).toMatchObject({ schema: 4, added: true });
  });
  it('rejects newer schemas and missing steps', () => {
    expect(() => migrateProjectJson({ schema: 5 }, {}, 4)).toThrow(/newer/);
    expect(() => migrateProjectJson({ schema: 2 }, {}, 4)).toThrow(/Unsupported/);
    expect(migrateProjectJson({ schema: 4 }, {}, 4)).toEqual({ schema: 4 });
  });
});

describe('auto-backup', () => {
  it('stores a restorable snapshot', async () => {
    const src = await sampleProject();
    await createBackup(src.id);
    const [b] = await listBackups(src.id);
    expect(b!.projectName).toBe('Sample ক');
    expect(b!.bytes).toBeGreaterThan(100);
    const restored = await restoreBackup(b!.id);
    expect(restored.id).not.toBe(src.id);
    expect((await getGlyph(restored.id, 'A'))?.advance).toBe(640);
    expect(await getProject(src.id)).toBeDefined(); // original never overwritten
  });

  it('keeps only the newest 5 per project', async () => {
    const a = await createProject({ name: 'A', set: 'latin', cell: 'x' });
    const b = await createProject({ name: 'B', set: 'latin', cell: 'x' });
    await createBackup(b.id);
    for (let i = 0; i < 8; i++) {
      await createBackup(a.id);
      await new Promise((r) => setTimeout(r, 2));
    }
    const mine = await listBackups(a.id);
    expect(mine).toHaveLength(MAX_BACKUPS_PER_PROJECT);
    const all = (await listBackups(a.id)).map((x) => x.createdAt);
    expect(all).toEqual([...all].sort((x, y) => y - x));
    expect(await listBackups(b.id)).toHaveLength(1); // other project untouched
  });

  it('does nothing for an unknown project', async () => {
    await createBackup('nope');
    expect((await (await getDB()).getAll('backups')).length).toBe(0);
  });

  it('BackupTrigger fires every Nth save per project', () => {
    const t = new BackupTrigger(3);
    expect([t.note('a'), t.note('a'), t.note('a'), t.note('a')]).toEqual([false, false, true, false]);
    expect(t.note('b')).toBe(false);
  });
});
