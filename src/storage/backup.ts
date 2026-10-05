// .fcproj = zip: project.json, glyphs/NNNN.json, refs/NNNN_V.png. Plus rolling auto-backups.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { CHAR_SET_IDS } from '@/app/charsets';
import { getDB } from './db';
import { convertKerning, convertLigatures, convertV3, isV3Project } from './migrate-v3';
import { getProject, importProject, listGlyphs, newId } from './projects';
import { DEFAULT_SETTINGS, SCHEMA_VERSION, emptyVariant, type Glyph, type Project, type Variant } from './types';

export const FCPROJ_FORMAT = 'fontcraft-project';
export const MAX_BACKUPS_PER_PROJECT = 5;
export const BACKUP_EVERY_N_SAVES = 20;

type JsonObj = Record<string, unknown>;
type StoredVariant = Omit<Variant, 'legacyPng'> & { legacyRef?: string };
type StoredGlyph = Omit<Glyph, 'variants'> & { variants: StoredVariant[] };

/** schemaN -> schemaN+1. Empty until schema 5 exists; the framework is exercised by tests. */
export type Migration = (json: JsonObj) => JsonObj;
export const MIGRATIONS: Record<number, Migration> = {};

export function migrateProjectJson(json: JsonObj, migrations: Record<number, Migration> = MIGRATIONS, target: number = SCHEMA_VERSION): JsonObj {
  let cur = json;
  let schema = typeof cur.schema === 'number' ? cur.schema : 0;
  if (schema > target) throw new Error('This project was made by a newer version of FontCraft. Update the app and try again.');
  while (schema < target) {
    const step = migrations[schema];
    if (!step) throw new Error(`Unsupported project version (${schema}).`);
    cur = step(cur);
    schema = typeof cur.schema === 'number' ? cur.schema : schema + 1;
  }
  return cur;
}

const pad = (n: number) => String(n).padStart(4, '0');

export async function exportFcproj(projectId: string): Promise<Blob> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  const glyphs = await listGlyphs(projectId);
  const files: Zippable = {};
  files['project.json'] = strToU8(JSON.stringify({ format: FCPROJ_FORMAT, schema: SCHEMA_VERSION, exportedAt: Date.now(), project, glyphCount: glyphs.length }));
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    const variants: StoredVariant[] = [];
    for (let vi = 0; vi < g.variants.length; vi++) {
      const { legacyPng, ...rest } = g.variants[vi]!;
      const out: StoredVariant = { ...rest };
      if (legacyPng) {
        const ref = `refs/${pad(i)}_${vi}.png`;
        files[ref] = [new Uint8Array(await legacyPng.arrayBuffer()), { level: 0 }]; // PNG is already compressed
        out.legacyRef = ref;
      }
      variants.push(out);
    }
    files[`glyphs/${pad(i)}.json`] = strToU8(JSON.stringify({ ...g, variants } satisfies StoredGlyph));
  }
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' });
}

function sanitizeProject(raw: JsonObj): Project {
  const s = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Partial<Project['settings']>;
  const set = (CHAR_SET_IDS as readonly string[]).includes(raw.set as string) ? (raw.set as Project['set']) : 'all';
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled';
  return {
    id: newId(),
    schema: SCHEMA_VERSION,
    name,
    set,
    cell: typeof raw.cell === 'string' ? raw.cell : 'standard',
    settings: { ...DEFAULT_SETTINGS, ...s },
    ligatures: convertLigatures(raw.ligatures),
    kerning: convertKerning(raw.kerning),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: Date.now(),
    stats: { total: 0, drawn: 0, withVariants: 0 },
  };
}

/** Reads a .fcproj and stores it as a NEW project (never overwrites an existing one). */
export async function importFcproj(data: Blob | Uint8Array): Promise<Project> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This file is not a FontCraft project.');
  }
  const pj = files['project.json'];
  if (!pj) throw new Error('This file is not a FontCraft project (project.json is missing).');
  let meta: JsonObj;
  try {
    meta = JSON.parse(strFromU8(pj)) as JsonObj;
  } catch {
    throw new Error('The project file is damaged (project.json is unreadable).');
  }
  if (meta.format !== FCPROJ_FORMAT) throw new Error('This file is not a FontCraft project.');
  const migrated = migrateProjectJson(meta);
  const project = sanitizeProject((migrated.project ?? {}) as JsonObj);

  const glyphs: Glyph[] = [];
  for (const path of Object.keys(files).filter((p) => p.startsWith('glyphs/') && p.endsWith('.json')).sort()) {
    let g: StoredGlyph;
    try {
      g = JSON.parse(strFromU8(files[path]!)) as StoredGlyph;
    } catch {
      throw new Error(`The project file is damaged (${path}).`);
    }
    if (typeof g.char !== 'string' || !g.char) continue;
    const storedVariants: StoredVariant[] = Array.isArray(g.variants) && g.variants.length ? g.variants : [{ strokes: [], contours: [] }];
    const variants: Variant[] = storedVariants.map((v) => {
      const out: Variant = { strokes: Array.isArray(v.strokes) ? v.strokes : [], contours: Array.isArray(v.contours) ? v.contours : [] };
      if (Array.isArray(v.paths) && v.paths.length) out.paths = v.paths;
      if (Array.isArray(v.traced) && v.traced.length) out.traced = v.traced;
      const ref = v.legacyRef ? files[v.legacyRef] : undefined;
      if (ref) out.legacyPng = new Blob([ref as BlobPart], { type: 'image/png' });
      return out;
    });
    glyphs.push({ char: g.char, advance: Number.isFinite(g.advance) ? g.advance : project.settings.defWidth, lsb: Number.isFinite(g.lsb) ? g.lsb : project.settings.defLsb, rsb: Number.isFinite(g.rsb) ? g.rsb : project.settings.defRsb, variants });
  }
  return importProject(project, glyphs);
}

/** Accepts either a .fcproj (zip) or a v3 `*_fontcraft.json` backup. */
export async function importProjectFile(file: Blob, fileName = ''): Promise<Project> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) return importFcproj(file);
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error(`"${fileName || 'This file'}" is not a FontCraft project.`);
  }
  if (!isV3Project(json)) throw new Error('This JSON file is not a FontCraft v3 project.');
  const { project, glyphs } = convertV3(json);
  return importProject(project, glyphs);
}

// ---- auto-backup ---------------------------------------------------------------------------------

export async function createBackup(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return;
  const data = await exportFcproj(projectId);
  const db = await getDB();
  await db.put('backups', { id: newId(), projectId, projectName: project.name, createdAt: Date.now(), data, bytes: data.size });
  const all = (await db.getAllFromIndex('backups', 'byProject', projectId)).sort((a, b) => b.createdAt - a.createdAt);
  for (const old of all.slice(MAX_BACKUPS_PER_PROJECT)) await db.delete('backups', old.id);
}

export async function listBackups(projectId?: string) {
  const db = await getDB();
  const rows = projectId ? await db.getAllFromIndex('backups', 'byProject', projectId) : await db.getAll('backups');
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** Restores a backup as a new project, so the current work is never overwritten. */
export async function restoreBackup(backupId: string): Promise<Project> {
  const row = await (await getDB()).get('backups', backupId);
  if (!row) throw new Error('Backup not found');
  return importFcproj(row.data);
}

/** Counts glyph saves and says when a backup is due (every N saves, per project). */
export class BackupTrigger {
  private counts = new Map<string, number>();
  constructor(private readonly every = BACKUP_EVERY_N_SAVES) {}
  note(projectId: string): boolean {
    const n = (this.counts.get(projectId) ?? 0) + 1;
    if (n >= this.every) {
      this.counts.set(projectId, 0);
      return true;
    }
    this.counts.set(projectId, n);
    return false;
  }
}
