// Conversion of FontCraft v3 data (localStorage 'fc3' and *_fontcraft.json backups) to schema 4.
// Glyph bitmaps are kept as `legacyPng` reference layers. Tracing them to vector contours needs
// the tracer from milestone M4, so migrated glyphs stay bitmap-backed until then.
import { CHAR_SET_IDS, type CharSetId } from '@/app/charsets';
import { importProject, listProjects, newId } from './projects';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  emptyVariant,
  type FontSettings,
  type Glyph,
  type KernPair,
  type Ligature,
  type Project,
  type Variant,
} from './types';

export const V3_STORAGE_KEY = 'fc3';

type V3Glyph = { variants?: Array<string | null>; advance?: number; lsb?: number; rsb?: number };
export type V3Project = {
  id?: string;
  name?: unknown;
  set?: unknown;
  cell?: unknown;
  chars?: Record<string, V3Glyph>;
  ligatures?: unknown;
  kerning?: unknown;
  settings?: Record<string, unknown>;
  created?: unknown;
};

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(url);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isB64 = /;base64/i.test(m[2] ?? '');
  try {
    if (isB64) {
      const bin = atob(m[3]!);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(m[3]!)], { type: mime });
  } catch {
    return null;
  }
}

export function isV3Project(x: unknown): x is V3Project {
  const p = x as V3Project;
  return !!p && typeof p === 'object' && typeof p.name === 'string' && !!p.chars && typeof p.chars === 'object' && !Array.isArray(p.chars);
}

function convertSettings(s: Record<string, unknown> | undefined): FontSettings {
  const d = DEFAULT_SETTINGS;
  const o = s ?? {};
  const vm = o.varmode;
  return {
    upm: num(o.upm, d.upm) || d.upm,
    ascender: num(o.ascender, d.ascender),
    descender: num(o.descender, d.descender),
    xheight: num(o.xheight, d.xheight),
    capheight: num(o.capheight, d.capheight),
    designer: str(o.designer, d.designer),
    license: str(o.license, d.license),
    subfamily: str(o.subfamily, d.subfamily),
    version: str(o.version, d.version),
    italic: num(o.italic, d.italic),
    tracking: num(o.tracking, d.tracking),
    defWidth: num(o.defwidth, d.defWidth),
    defLsb: num(o.deflb, d.defLsb),
    defRsb: num(o.defrb, d.defRsb),
    varMode: vm === 'cycle' || vm === 'first' || vm === 'random' ? vm : d.varMode,
  };
}

export function convertLigatures(raw: unknown): Ligature[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && typeof (l as Ligature).input === 'string' && (l as Ligature).input.length > 0)
    .map((l) => {
      const input = l.input as string;
      return { input, output: str(l.output, `${input}_lig`), name: str(l.name, `${input} ligature`) };
    });
}

export function convertKerning(raw: unknown): KernPair[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object' && typeof k.left === 'string' && typeof k.right === 'string' && !!k.left && !!k.right)
    .map((k) => ({ left: k.left as string, right: k.right as string, value: num(k.value, 0) }));
}

/** Pure conversion. Never touches storage. */
export function convertV3(p: V3Project): { project: Project; glyphs: Glyph[] } {
  if (!isV3Project(p)) throw new Error('Not a FontCraft v3 project');
  const name = (p.name as string).trim() || 'Untitled';
  const settings = convertSettings(p.settings);
  const set: CharSetId = (CHAR_SET_IDS as readonly string[]).includes(p.set as string) ? (p.set as CharSetId) : 'all';
  const created = typeof p.created === 'string' && !Number.isNaN(Date.parse(p.created)) ? Date.parse(p.created) : Date.now();

  const glyphs: Glyph[] = Object.entries(p.chars ?? {}).map(([char, g]) => {
    const rawVariants = Array.isArray(g?.variants) && g.variants.length ? g.variants : [null];
    const variants: Variant[] = rawVariants.slice(0, 4).map((url) => {
      const blob = typeof url === 'string' ? dataUrlToBlob(url) : null;
      return blob ? { strokes: [], contours: [], legacyPng: blob } : emptyVariant();
    });
    return {
      char,
      advance: num(g?.advance, settings.defWidth),
      lsb: num(g?.lsb, settings.defLsb),
      rsb: num(g?.rsb, settings.defRsb),
      variants,
    };
  });

  const project: Project = {
    id: newId(),
    schema: SCHEMA_VERSION,
    name,
    set,
    cell: str(p.cell, 'standard'),
    settings,
    ligatures: convertLigatures(p.ligatures),
    kerning: convertKerning(p.kerning),
    createdAt: created,
    updatedAt: Date.now(),
    stats: { total: glyphs.length, drawn: 0, withVariants: 0 },
  };
  return { project, glyphs };
}

export async function importV3Project(p: V3Project): Promise<Project> {
  const { project, glyphs } = convertV3(p);
  return importProject(project, glyphs);
}

export type MigrationResult = { status: 'none' | 'skipped' | 'migrated' | 'failed'; migrated: number; failed: number };

/**
 * First-launch migration: copies `localStorage['fc3']` into IndexedDB when the database has no
 * projects yet. The original key is NEVER modified or deleted.
 */
export async function migrateFromV3(
  storage: Pick<Storage, 'getItem'> = localStorage,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<MigrationResult> {
  let raw: string | null;
  try {
    raw = storage.getItem(V3_STORAGE_KEY);
  } catch {
    return { status: 'none', migrated: 0, failed: 0 };
  }
  if (!raw) return { status: 'none', migrated: 0, failed: 0 };
  if ((await listProjects()).length > 0) return { status: 'skipped', migrated: 0, failed: 0 };

  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return { status: 'failed', migrated: 0, failed: 1 };
  }
  if (!Array.isArray(list) || list.length === 0) return { status: 'none', migrated: 0, failed: 0 };

  let migrated = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    onProgress?.(i, list.length, isV3Project(item) ? String(item.name) : '');
    try {
      await importV3Project(item as V3Project);
      migrated++;
    } catch (err) {
      console.warn('FontCraft: could not migrate a v3 project', err);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 0)); // let the progress screen paint
  }
  onProgress?.(list.length, list.length, '');
  return { status: migrated > 0 ? 'migrated' : 'failed', migrated, failed };
}
