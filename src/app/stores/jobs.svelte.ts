import { createScanEngine } from '@/scan/engine';
import { listProjects } from '@/storage/projects';
import { countBitmaps, traceLegacyProject, type TraceReport } from '@/scan/legacy-job';
import { store } from './project.svelte';

class Jobs {
  /** Set while bitmaps are being converted to vectors; the app shows a progress dialog. */
  legacy = $state<{ done: number; total: number } | null>(null);
  private busy = false;

  /** Converts the bitmap glyphs of the given projects (or of all projects) to vectors. */
  async convertBitmaps(projectIds?: string[]): Promise<TraceReport> {
    const report: TraceReport = { converted: 0, failed: 0 };
    if (this.busy) return report;
    this.busy = true;
    const engine = createScanEngine();
    try {
      const ids = projectIds ?? (await listProjects()).map((p) => p.id);
      const counts = await Promise.all(ids.map((id) => countBitmaps(id)));
      const total = counts.reduce((a, b) => a + b, 0);
      if (total === 0) return report;
      this.legacy = { done: 0, total };
      let offset = 0;
      for (const [k, id] of ids.entries()) {
        if (counts[k]) {
          const r = await traceLegacyProject(id, engine, (done) => (this.legacy = { done: offset + done, total }));
          report.converted += r.converted;
          report.failed += r.failed;
          if (store.id === id && r.converted) await store.open(id); // show the vectors in the open project
        }
        offset += counts[k]!;
      }
    } finally {
      engine.dispose();
      this.legacy = null;
      this.busy = false;
    }
    return report;
  }
}

export const jobs = new Jobs();
