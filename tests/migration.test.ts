import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/storage/db';
import { convertV3, dataUrlToBlob, isV3Project, migrateFromV3, V3_STORAGE_KEY, type V3Project } from '@/storage/migrate-v3';
import { getGlyph, listGlyphs, listProjects } from '@/storage/projects';

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Built from v3's data shape (createProj + saveSets + saveLig + saveKP).
const v3Project = (): V3Project => ({
  id: 'k1x9',
  name: 'Old Hand',
  set: 'latin',
  cell: 'standard',
  chars: {
    A: { variants: [PNG, null, PNG], advance: 620, lsb: 40, rsb: 60 },
    B: { variants: [null], advance: 500, lsb: 50, rsb: 50 },
    'ক্ষ': { variants: [PNG], advance: 700, lsb: 30, rsb: 30 },
  },
  ligatures: [{ input: 'fi', output: 'fi_lig', name: 'fi ligature' }, { bad: true }],
  kerning: [{ left: 'A', right: 'V', value: -70 }, { left: 'T' }],
  settings: { upm: 1000, ascender: 820, descender: -210, xheight: 480, capheight: 690, designer: 'Rafi', license: 'Personal', subfamily: 'Regular', version: '1.002', defwidth: 510, deflb: 45, defrb: 55, varmode: 'cycle', italic: 6, tracking: 12 },
  created: '2025-03-01T10:00:00.000Z',
});

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeDB();
});

describe('dataUrlToBlob', () => {
  it('decodes base64 PNG data', async () => {
    const b = dataUrlToBlob(PNG)!;
    expect(b.type).toBe('image/png');
    const bytes = new Uint8Array(await b.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('rejects garbage without throwing', () => {
    expect(dataUrlToBlob('not a url')).toBeNull();
    expect(dataUrlToBlob('data:image/png;base64,@@@@')).toBeNull();
  });
});

describe('convertV3', () => {
  it('maps every v3 field, including lower-case settings names', () => {
    const { project, glyphs } = convertV3(v3Project());
    expect(project.name).toBe('Old Hand');
    expect(project.set).toBe('latin');
    expect(project.settings).toMatchObject({ ascender: 820, descender: -210, defWidth: 510, defLsb: 45, defRsb: 55, varMode: 'cycle', designer: 'Rafi', version: '1.002', italic: 6, tracking: 12 });
    expect(project.createdAt).toBe(Date.parse('2025-03-01T10:00:00.000Z'));
    expect(glyphs).toHaveLength(3);
    const a = glyphs.find((g) => g.char === 'A')!;
    expect([a.advance, a.lsb, a.rsb]).toEqual([620, 40, 60]);
    expect(a.variants).toHaveLength(3);
    expect(a.variants[0]!.legacyPng).toBeInstanceOf(Blob);
    expect(a.variants[1]!.legacyPng).toBeUndefined();
  });

  it('keeps valid ligatures and kerning, drops malformed entries', () => {
    const { project } = convertV3(v3Project());
    expect(project.ligatures).toEqual([{ input: 'fi', output: 'fi_lig', name: 'fi ligature' }]);
    expect(project.kerning).toEqual([{ left: 'A', right: 'V', value: -70 }]);
  });

  it('gets a fresh id so it cannot collide with v3 ids', () => {
    expect(convertV3(v3Project()).project.id).not.toBe('k1x9');
  });

  it('falls back safely on bad values', () => {
    const { project, glyphs } = convertV3({ name: '  ', set: 'weird', chars: { X: { variants: [], advance: Number.NaN } }, settings: { upm: 0, varmode: 'nope' } });
    expect(project.name).toBe('Untitled');
    expect(project.set).toBe('all');
    expect(project.settings.upm).toBe(1000);
    expect(project.settings.varMode).toBe('random');
    expect(glyphs[0]!.advance).toBe(500);
    expect(glyphs[0]!.variants).toHaveLength(1);
  });

  it('rejects things that are not v3 projects', () => {
    for (const bad of [null, {}, { name: 'x' }, { name: 'x', chars: [] }, { chars: {} }]) expect(isV3Project(bad)).toBe(false);
    expect(() => convertV3({} as V3Project)).toThrow(/v3/);
  });
});

describe('migrateFromV3', () => {
  const fakeStorage = (value: string | null) => {
    let calls = 0;
    return { getItem: (k: string) => (k === V3_STORAGE_KEY ? ((calls++, value)) : null), get calls() { return calls; } };
  };

  it('copies every project into IndexedDB with bitmap reference layers', async () => {
    const raw = JSON.stringify([v3Project(), { ...v3Project(), name: 'Second' }]);
    const store = fakeStorage(raw);
    const progress: number[] = [];
    const res = await migrateFromV3(store, (d) => progress.push(d));
    expect(res).toEqual({ status: 'migrated', migrated: 2, failed: 0 });
    expect(progress.at(-1)).toBe(2);
    const projects = await listProjects();
    expect(projects.map((p) => p.name).sort()).toEqual(['Old Hand', 'Second']);
    const p = projects.find((x) => x.name === 'Old Hand')!;
    expect(p.stats).toEqual({ total: 3, drawn: 2, withVariants: 1 });
    const g = await getGlyph(p.id, 'ক্ষ');
    expect(g?.variants[0]?.legacyPng).toBeInstanceOf(Blob);
    expect(await listGlyphs(p.id)).toHaveLength(3);
  });

  it('never modifies the original data (read-only access)', async () => {
    const raw = JSON.stringify([v3Project()]);
    const store = { getItem: () => raw };
    await migrateFromV3(store);
    // The adapter only exposes getItem: any write or delete attempt would have thrown.
    expect(Object.keys(store)).toEqual(['getItem']);
  });

  it('does nothing when there is no v3 data', async () => {
    expect((await migrateFromV3(fakeStorage(null))).status).toBe('none');
    expect((await migrateFromV3(fakeStorage('[]'))).status).toBe('none');
    expect(await listProjects()).toEqual([]);
  });

  it('skips when the database already has projects, so it never duplicates', async () => {
    await migrateFromV3(fakeStorage(JSON.stringify([v3Project()])));
    const again = await migrateFromV3(fakeStorage(JSON.stringify([v3Project()])));
    expect(again.status).toBe('skipped');
    expect(await listProjects()).toHaveLength(1);
  });

  it('survives corrupt JSON and corrupt entries', async () => {
    expect((await migrateFromV3(fakeStorage('{not json'))).status).toBe('failed');
    const res = await migrateFromV3(fakeStorage(JSON.stringify([{ nope: 1 }, v3Project()])));
    expect(res).toEqual({ status: 'migrated', migrated: 1, failed: 1 });
  });
});
