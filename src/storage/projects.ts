import { charsForSet, type CharSetId } from '@/app/charsets';
import { getDB } from './db';
import {
  DEFAULT_SETTINGS,
  MAX_VARIANTS,
  SCHEMA_VERSION,
  emptyVariant,
  glyphHasVariants,
  isGlyphDrawn,
  type FontSettings,
  type Glyph,
  type GlyphRecord,
  type KernPair,
  type Ligature,
  type Project,
  type ProjectStats,
} from './types';

export type NewProjectInput = { name: string; set: CharSetId; cell: string; settings?: Partial<FontSettings> };

export function newId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}

export function blankGlyph(char: string, s: Pick<FontSettings, 'defWidth' | 'defLsb' | 'defRsb'> = DEFAULT_SETTINGS): Glyph {
  return { char, advance: s.defWidth, lsb: s.defLsb, rsb: s.defRsb, variants: [emptyVariant()] };
}

export function statsOf(glyphs: readonly Glyph[]): ProjectStats {
  let drawn = 0;
  let withVariants = 0;
  for (const g of glyphs) {
    if (isGlyphDrawn(g)) drawn++;
    if (glyphHasVariants(g)) withVariants++;
  }
  return { total: glyphs.length, drawn, withVariants };
}

/** Creates a project and one empty glyph record per character in a single transaction. */
export async function createProject(input: NewProjectInput): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new Error('Project name is required');
  const settings: FontSettings = { ...DEFAULT_SETTINGS, ...input.settings };
  const chars = charsForSet(input.set);
  const now = Date.now();
  const project: Project = {
    id: newId(),
    schema: SCHEMA_VERSION,
    name,
    set: input.set,
    cell: input.cell,
    settings,
    ligatures: [],
    kerning: [],
    createdAt: now,
    updatedAt: now,
    stats: { total: chars.length, drawn: 0, withVariants: 0 },
  };
  const db = await getDB();
  const tx = db.transaction(['projects', 'glyphs'], 'readwrite');
  await tx.objectStore('projects').put(project);
  const glyphStore = tx.objectStore('glyphs');
  for (const ch of chars) await glyphStore.put({ ...blankGlyph(ch, settings), projectId: project.id });
  await tx.done;
  return project;
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await getDB()).get('projects', id);
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'cell' | 'settings' | 'ligatures' | 'kerning'>>;

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const db = await getDB();
  const tx = db.transaction('projects', 'readwrite');
  const cur = await tx.store.get(id);
  // Throwing without abort(): an empty transaction commits harmlessly, whereas abort() would
  // reject `tx.done` with nobody listening (an unhandled rejection).
  if (!cur) throw new Error(`Project ${id} not found`);
  const next: Project = { ...cur, ...patch, id: cur.id, schema: cur.schema, updatedAt: Date.now() };
  if (!next.name.trim()) next.name = cur.name;
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'glyphs', 'blobs', 'backups'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  for (const name of ['glyphs', 'blobs', 'backups'] as const) {
    const store = tx.objectStore(name);
    const keys = await store.index('byProject').getAllKeys(id);
    for (const k of keys) await store.delete(k as never);
  }
  await tx.done;
}

export async function listGlyphs(projectId: string): Promise<Glyph[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('glyphs', 'byProject', projectId);
  return rows.map(stripProjectId);
}

export async function getGlyph(projectId: string, char: string): Promise<Glyph | undefined> {
  const row = await (await getDB()).get('glyphs', [projectId, char]);
  return row ? stripProjectId(row) : undefined;
}

/**
 * Saves one glyph (only that record is written) and refreshes the project's counters.
 * Variants are clamped to 1..MAX_VARIANTS.
 */
export async function saveGlyph(projectId: string, glyph: Glyph): Promise<Project> {
  const variants = glyph.variants.slice(0, MAX_VARIANTS);
  const clean: GlyphRecord = { ...glyph, variants: variants.length ? variants : [emptyVariant()], projectId };
  const db = await getDB();
  const tx = db.transaction(['projects', 'glyphs'], 'readwrite');
  const project = await tx.objectStore('projects').get(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const glyphs = tx.objectStore('glyphs');
  const before = await glyphs.get([projectId, glyph.char]);
  await glyphs.put(clean);

  // Update counters incrementally instead of rescanning every glyph.
  const stats = { ...project.stats };
  if (!before) stats.total++;
  const wasDrawn = before ? isGlyphDrawn(before) : false;
  const wasVar = before ? glyphHasVariants(before) : false;
  const nowDrawn = isGlyphDrawn(clean);
  const nowVar = glyphHasVariants(clean);
  stats.drawn += Number(nowDrawn) - Number(wasDrawn);
  stats.withVariants += Number(nowVar) - Number(wasVar);
  const next: Project = { ...project, stats, updatedAt: Date.now() };
  await tx.objectStore('projects').put(next);
  await tx.done;
  return next;
}

export async function setLigatures(id: string, ligatures: Ligature[]): Promise<Project> {
  return updateProject(id, { ligatures });
}

export async function setKerning(id: string, kerning: KernPair[]): Promise<Project> {
  return updateProject(id, { kerning });
}

function stripProjectId(row: GlyphRecord): Glyph {
  const { projectId: _projectId, ...glyph } = row;
  return glyph;
}

/** Writes an already-built project and all its glyphs in one transaction (import and migration). */
export async function importProject(project: Project, glyphs: readonly Glyph[]): Promise<Project> {
  const stored: Project = { ...project, schema: SCHEMA_VERSION, stats: statsOf(glyphs) };
  const db = await getDB();
  const tx = db.transaction(['projects', 'glyphs'], 'readwrite');
  await tx.objectStore('projects').put(stored);
  const store = tx.objectStore('glyphs');
  for (const g of glyphs) {
    const variants = g.variants.slice(0, MAX_VARIANTS);
    await store.put({ ...g, variants: variants.length ? variants : [emptyVariant()], projectId: stored.id });
  }
  await tx.done;
  return stored;
}

/**
 * Writes one glyph and the project's counters in a single transaction using only `put`s (no reads).
 * This is the autosave path: during page unload the browser lets the first IndexedDB requests run
 * but not a chain of read-then-write requests, so a save that reads first can be lost.
 * `stats` must come from the caller's in-memory view of the project.
 */
export async function putGlyphAndProject(project: Project, glyph: Glyph, stats: ProjectStats): Promise<Project> {
  const variants = glyph.variants.slice(0, MAX_VARIANTS);
  const record: GlyphRecord = { ...glyph, variants: variants.length ? variants : [emptyVariant()], projectId: project.id };
  const next: Project = { ...project, stats, updatedAt: Date.now() };
  const db = await getDB();
  const tx = db.transaction(['projects', 'glyphs'], 'readwrite');
  tx.objectStore('glyphs').put(record);
  tx.objectStore('projects').put(next);
  await tx.done;
  return next;
}
