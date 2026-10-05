<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import { exportFcproj, listBackups, restoreBackup } from '@/storage/backup';
  import type { BackupRecord } from '@/storage/types';
  import { platform } from '@/platform';
  import { store } from '../stores/project.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { countBitmaps } from '@/scan/legacy-job';
  import { toast } from '../stores/toast.svelte';
  import { t } from '../i18n/t.svelte';

  let backups = $state<BackupRecord[]>([]);
  let busy = $state(false);
  let bitmaps = $state(0);

  const p = $derived(store.project);
  const pct = $derived(p && p.stats.total ? Math.round((p.stats.drawn / p.stats.total) * 100) : 0);
  const readiness = $derived(pct >= 80 ? 'export.ready' : pct >= 50 ? 'export.partial' : 'export.fill');

  async function loadBackups() {
    backups = p ? await listBackups(p.id) : [];
  }
  async function countPics() {
    bitmaps = p ? await countBitmaps(p.id) : 0;
  }
  onMount(() => {
    void loadBackups().catch(() => {});
    void countPics().catch(() => {});
  });

  async function convert() {
    if (!p) return;
    const r = await jobs.convertBitmaps([p.id]);
    if (r.converted) toast(t('jobs.legacy.done', { n: r.converted }), 'ok');
    if (r.failed) toast(t('jobs.legacy.failed', { n: r.failed }), 'wn');
    await countPics();
  }

  const fileName = (name: string) => name.trim().replace(/\s+/g, '_') || 'FontCraft';

  async function saveBackup() {
    if (!p) return;
    busy = true;
    try {
      await store.flush();
      const blob = await exportFcproj(p.id);
      const res = await platform().saveFile(`${fileName(p.name)}.fcproj`, blob, 'application/zip');
      if (res !== 'cancelled') toast(t('export.backup.done'), 'ok');
    } catch (e) {
      toast(t('export.backup.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    } finally {
      busy = false;
    }
  }

  async function restore(id: string) {
    try {
      const np = await restoreBackup(id);
      toast(t('export.restore.done', { name: np.name }), 'ok');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'wn');
    }
  }

  const when = (ts: number) => new Date(ts).toLocaleString();
  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
</script>

<TopBar title={t('export.title')} subtitle={p?.name ?? ''} />
{#if !p}
  <NoProject />
{:else}
  <div class="scroll wrap">
    <section class="card">
      <p class="stats mono">{t('export.stats', { drawn: p.stats.drawn, total: p.stats.total, variants: p.stats.withVariants, kern: p.kerning.length, lig: p.ligatures.length })}</p>
      <p class="ready">{t(readiness)} · {pct}%</p>
    </section>
    {#if bitmaps > 0}
      <section class="card">
        <h3>{t('export.bitmaps.title')}</h3>
        <p>{t('export.bitmaps.body', { n: bitmaps })}</p>
        <button class="btn primary" onclick={convert}>{t('export.bitmaps.action')}</button>
      </section>
    {/if}
    <section class="card">
      <h3>{t('export.backup.title')}</h3>
      <p>{t('export.backup.body')}</p>
      <button class="btn primary" disabled={busy} onclick={saveBackup}>{t('export.backup.save')}</button>
    </section>
    <section class="card">
      <h3>{t('export.font.title')}</h3>
      <div class="fmts">
        {#each ['OTF', 'TTF', 'WOFF', 'WOFF2'] as f (f)}<button class="btn ghost" disabled aria-disabled="true">{f}</button>{/each}
      </div>
      <p class="why">{t('export.font.disabled')}</p>
    </section>
    <section class="card">
      <h3>{t('export.restore.title')}</h3>
      {#if backups.length === 0}
        <p>{t('export.restore.none')}</p>
      {:else}
        <ul>
          {#each backups as b (b.id)}
            <li><span class="mono">{when(b.createdAt)} · {kb(b.bytes)}</span><button class="btn ghost" onclick={() => restore(b.id)}>{t('export.restore.action')}</button></li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
{/if}

<style>
  .wrap { display: grid; gap: 14px; align-content: start; max-width: 640px; }
  h3 { font-size: 14px; margin-bottom: 6px; }
  p { font-size: 13px; color: var(--text2); line-height: 1.5; margin-bottom: 12px; }
  .stats { font-size: 12px; color: var(--text); margin-bottom: 6px; }
  .ready { color: var(--accent2); font-weight: 600; margin: 0; }
  .fmts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .why { color: var(--text3); font-size: 12px; margin: 0; }
  ul { list-style: none; display: grid; gap: 8px; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 12px; }
</style>
