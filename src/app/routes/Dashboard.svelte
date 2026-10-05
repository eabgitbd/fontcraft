<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import NewProjectModal from '../components/NewProjectModal.svelte';
  import ConfirmModal from '../components/ConfirmModal.svelte';
  import Icon from '../components/Icon.svelte';
  import { importProjectFile } from '@/storage/backup';
  import { deleteProject, listProjects } from '@/storage/projects';
  import type { Project } from '@/storage/types';
  import { platform } from '@/platform';
  import { store } from '../stores/project.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { toast } from '../stores/toast.svelte';
  import { t, tn } from '../i18n/t.svelte';
  import { hrefFor } from '../router';

  let { onopen }: { onopen: (id: string) => void } = $props();

  let projects = $state<Project[] | null>(null);
  let showNew = $state(false);
  let pendingDelete = $state<Project | null>(null);

  async function reload() {
    try {
      projects = await listProjects();
    } catch (err) {
      projects = [];
      toast(String((err as Error)?.message ?? err), 'wn');
    }
  }
  onMount(() => void reload());

  const pct = (p: Project) => (p.stats.total ? Math.round((p.stats.drawn / p.stats.total) * 100) : 0);
  const isBn = (p: Project) => p.set.includes('bengali');
  const initials = (p: Project) => (isBn(p) ? 'অ আ' : [...p.name.trim()].slice(0, 2).join('').toUpperCase());

  async function created(p: Project) {
    showNew = false;
    toast(t('project.created'), 'ok');
    await reload();
    onopen(p.id);
  }

  async function confirmDelete() {
    const p = pendingDelete;
    pendingDelete = null;
    if (!p) return;
    try {
      await store.flush();
      await deleteProject(p.id);
      if (store.id === p.id) store.clear();
      toast(t('project.deleted'), 'if');
      await reload();
    } catch (err) {
      toast(String((err as Error)?.message ?? err), 'wn');
    }
  }

  async function doImport() {
    try {
      const file = await platform().openFile(['.fcproj', '.json', 'application/zip', 'application/json']);
      if (!file) return;
      const p = await importProjectFile(file, file.name);
      toast(t('project.imported', { name: p.name }), 'ok');
      await reload();
      const r = await jobs.convertBitmaps([p.id]);
      if (r.converted) toast(t('jobs.legacy.done', { n: r.converted }), 'ok');
    } catch (err) {
      toast(t('project.import.failed', { reason: String((err as Error)?.message ?? err) }), 'wn');
    }
  }
</script>

<TopBar title={t('dashboard.title')} subtitle={projects ? tn('dashboard.count', projects.length) : ''}>
  {#snippet actions()}
    <button class="btn ghost" onclick={doImport}>{t('project.import')}</button>
    <button class="btn primary" onclick={() => (showNew = true)}><Icon name="plus" size={16} />{t('dashboard.new')}</button>
  {/snippet}
</TopBar>

<div class="scroll">
  {#if projects === null}
    <p class="hint">{t('common.loading')}</p>
  {:else}
    {#if projects.length === 0}
      <div class="welcome">
        <div class="logo" aria-hidden="true">Fc</div>
        <h2>{t('dashboard.empty.title')}</h2>
        <p>{t('dashboard.empty.body')}</p>
        <p class="ver mono">{t('app.version', { version: __APP_VERSION__ })}</p>
      </div>
    {/if}
    <div class="grid">
      <button class="new" onclick={() => (showNew = true)}><span class="plus">+</span>{t('dashboard.new')}</button>
      {#each projects as p (p.id)}
        <article class="pc">
          <a class="open" href={hrefFor({ name: 'glyphs' })} onclick={(e) => { e.preventDefault(); onopen(p.id); }} aria-label="{t('project.open')}: {p.name}">
            <div class="prev" class:bn={isBn(p)} lang={isBn(p) ? 'bn' : undefined}>{initials(p)}</div>
            <h3>{p.name}</h3>
            <div class="meta mono">{t('project.glyphs', { drawn: p.stats.drawn, total: p.stats.total })} · {p.set}</div>
            <div class="bar" role="progressbar" aria-valuenow={pct(p)} aria-valuemin="0" aria-valuemax="100"><div style:width="{pct(p)}%"></div></div>
          </a>
          <button class="del" aria-label="{t('common.delete')}: {p.name}" onclick={() => (pendingDelete = p)}><Icon name="close" size={16} /></button>
        </article>
      {/each}
    </div>
  {/if}
</div>

{#if showNew}<NewProjectModal oncreate={created} oncancel={() => (showNew = false)} />{/if}
{#if pendingDelete}
  <ConfirmModal title={t('project.delete.title')} body={t('project.delete.body', { name: pendingDelete.name })} confirmLabel={t('common.delete')} danger onconfirm={confirmDelete} oncancel={() => (pendingDelete = null)} />
{/if}

<style>
  .hint { color: var(--text3); font-size: 13px; }
  .welcome { max-width: 360px; margin: 8px auto 28px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .logo { width: 64px; height: 64px; border-radius: 16px; background: var(--accent); color: #fff; display: grid; place-items: center; font: 700 28px/1 var(--font-mono); letter-spacing: -1px; }
  h2 { font-size: 18px; }
  .welcome p { color: var(--text2); font-size: 13px; line-height: 1.5; }
  .ver { color: var(--text3) !important; font-size: 11px !important; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
  .new { min-height: 158px; background: transparent; border: 2px dashed var(--border2); border-radius: var(--r2); color: var(--text3); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 500; transition: var(--tr); }
  .new:hover { border-color: var(--accent); color: var(--accent2); background: var(--abg); }
  .plus { font-size: 30px; font-weight: 300; line-height: 1; }
  .pc { position: relative; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--r2); transition: var(--tr); }
  .pc:hover { border-color: var(--aborder); background: var(--bg3); }
  .open { display: block; padding: 18px; color: inherit; text-decoration: none; }
  .prev { height: 60px; display: grid; place-items: center; font-size: 30px; font-weight: 700; color: var(--accent2); margin-bottom: 12px; background: var(--bg3); border-radius: var(--r); letter-spacing: -2px; overflow: hidden; }
  .prev.bn { font-size: 22px; letter-spacing: 0; }
  h3 { font-size: 14px; font-weight: 600; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 11px; color: var(--text3); margin-bottom: 10px; }
  .bar { height: 3px; background: var(--bg4); border-radius: 2px; overflow: hidden; }
  .bar div { height: 100%; background: var(--accent); }
  .del { position: absolute; top: 6px; right: 6px; width: 36px; height: 36px; border-radius: 8px; border: none; background: transparent; color: var(--text3); display: grid; place-items: center; }
  .del:hover { background: var(--rbg); color: var(--red); }
</style>
