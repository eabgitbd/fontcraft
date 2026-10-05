import { BackupTrigger, createBackup } from '@/storage/backup';
import { getProject, listGlyphs, putGlyphAndProject, statsOf } from '@/storage/projects';
import type { Glyph, Project } from '@/storage/types';
import { autosaver } from './autosave.svelte';

const KEY = 'fc4.current';
const readSaved = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** The open project and its glyphs, held in memory so screens render instantly. */
class ProjectStore {
  project = $state.raw<Project | null>(null);
  glyphs = $state.raw<Map<string, Glyph>>(new Map());
  loading = $state(false);
  private trigger = new BackupTrigger();

  get id(): string | null {
    return this.project?.id ?? null;
  }

  /** Opens a project. Returns false if it no longer exists. */
  async open(id: string): Promise<boolean> {
    this.loading = true;
    try {
      const p = await getProject(id);
      if (!p) {
        this.clear();
        return false;
      }
      const list = await listGlyphs(id);
      this.glyphs = new Map(list.map((g) => [g.char, g]));
      this.project = p;
      try {
        localStorage.setItem(KEY, id);
      } catch {
        /* best effort */
      }
      return true;
    } finally {
      this.loading = false;
    }
  }

  /** Re-opens the project that was open last time, if any. */
  async restore(): Promise<void> {
    const id = readSaved();
    if (id && !this.project) await this.open(id);
  }

  clear(): void {
    this.project = null;
    this.glyphs = new Map();
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* best effort */
    }
  }

  /** Replaces the in-memory project after settings, ligature or kerning edits were persisted. */
  setProject(p: Project): void {
    if (this.project && p.id === this.project.id) this.project = p;
  }

  /**
   * Updates memory now. The IndexedDB write waits for a short quiet period (typing in a field), or
   * happens on the next tick when `immediate` is set (a finished stroke). A page that is being torn
   * down cannot be relied on to finish a write, so committed drawing is saved straight away.
   */
  saveGlyph(glyph: Glyph, immediate = false): void {
    const p = this.project;
    if (!p) return;
    const next = new Map(this.glyphs);
    next.set(glyph.char, glyph);
    this.glyphs = next;
    const pid = p.id;
    autosaver.schedule(`glyph:${pid}:${glyph.char}`, async () => {
      // The project may have been closed or deleted while the save was waiting.
      const cur = this.project;
      if (!cur || cur.id !== pid) return;
      const latest = this.glyphs.get(glyph.char) ?? glyph;
      const updated = await putGlyphAndProject(cur, latest, statsOf([...this.glyphs.values()]));
      this.setProject(updated);
      if (this.trigger.note(pid)) void createBackup(pid).catch((e) => console.warn('FontCraft: auto-backup failed', e));
    }, immediate ? 0 : undefined);
  }

  /** Writes everything pending right now (explicit Save, leaving a screen). */
  flush(): Promise<void> {
    return autosaver.flush();
  }
}

export const store = new ProjectStore();
