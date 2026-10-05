<script lang="ts">
  import { onMount } from 'svelte';
  import { platform } from '@/platform';
  import { migrateFromV3 } from '@/storage/migrate-v3';
  import { autosaver } from './stores/autosave.svelte';
  import { store } from './stores/project.svelte';
  import { toast } from './stores/toast.svelte';
  import { ui } from './stores/ui.svelte';
  import { jobs } from './stores/jobs.svelte';
  import { createRouter, type Route } from './router';
  import { t } from './i18n/t.svelte';
  import NavRail from './components/NavRail.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import ToastHost from './components/ToastHost.svelte';
  import AutosaveBadge from './components/AutosaveBadge.svelte';
  import Modal from './components/Modal.svelte';
  import ShortcutsModal from './components/ShortcutsModal.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import Glyphs from './routes/Glyphs.svelte';
  import Editor from './routes/Editor.svelte';
  import Ligatures from './routes/Ligatures.svelte';
  import Kerning from './routes/Kerning.svelte';
  import Preview from './routes/Preview.svelte';
  import Export from './routes/Export.svelte';
  import Settings from './routes/Settings.svelte';
  import Scan from './routes/Scan.svelte';
  import ComingSoon from './routes/ComingSoon.svelte';

  const router = createRouter();
  let route = $state<Route>(router.current());
  let ready = $state(false);
  let migrating = $state<{ done: number; total: number; name: string } | null>(null);
  let migratedNow = false;

  async function openProject(id: string) {
    if (await store.open(id)) router.navigate({ name: 'glyphs' });
    else toast(t('project.none.body'), 'wn');
  }

  onMount(() => {
    const offRoute = router.subscribe((r) => (route = r));
    // Flush pending writes when the tab hides or the native app pauses.
    const offPause = platform().onPause(() => void autosaver.flush());
    // Back button: any screen other than Projects goes back to Projects first.
    const offBack = platform().onBack(() => {
      if (router.current().name === 'dashboard') return false;
      router.navigate({ name: 'dashboard' });
      return true;
    });

    void (async () => {
      try {
        const res = await migrateFromV3(localStorage, (done, total, name) => (migrating = { done, total, name }));
        migrating = null;
        if (res.status === 'migrated') toast(t('migration.done'), 'ok');
        if (res.failed > 0) toast(t('migration.failed', { n: res.failed }), 'wn');
        if (res.status === 'migrated') migratedNow = true;
      } catch (err) {
        migrating = null;
        console.error('FontCraft: migration failed', err);
      }
      try {
        await store.restore();
      } catch (err) {
        console.warn('FontCraft: could not reopen the last project', err);
      }
      ready = true;
      // Migrated v3 drawings are pictures; trace them into editable vectors in the background.
      if (migratedNow) {
        const r = await jobs.convertBitmaps().catch((e) => (console.error('FontCraft: conversion failed', e), null));
        if (r?.converted) toast(t('jobs.legacy.done', { n: r.converted }), 'ok');
        if (r?.failed) toast(t('jobs.legacy.failed', { n: r.failed }), 'wn');
      }
    })();

    return () => {
      offRoute();
      offPause();
      offBack();
      router.destroy();
    };
  });
</script>

<div class="layout">
  <NavRail active={route.name} />
  <main class="main">
    {#if !ready}
      <p class="boot">{t('common.loading')}</p>
    {:else if route.name === 'dashboard'}
      <Dashboard onopen={openProject} />
    {:else if route.name === 'glyphs'}
      <Glyphs {router} />
    {:else if route.name === 'editor'}
      <Editor char={route.param} />
    {:else if route.name === 'ligatures'}
      <Ligatures />
    {:else if route.name === 'kerning'}
      <Kerning />
    {:else if route.name === 'preview'}
      <Preview />
    {:else if route.name === 'export'}
      <Export />
    {:else if route.name === 'settings'}
      <Settings />
    {:else if route.name === 'scan'}
      <Scan />
    {:else}
      <ComingSoon titleKey="nav.scan" />
    {/if}
  </main>
  <BottomNav active={route.name} />
  <AutosaveBadge />
  <ToastHost />
  {#if migrating}
    <Modal title={t('migration.title')} description={t('migration.body')} onclose={() => {}}>
      <progress max={migrating.total || 1} value={migrating.done}></progress>
      <p class="mono mig">{migrating.done}/{migrating.total} {migrating.name}</p>
      {#snippet actions()}<span></span>{/snippet}
    </Modal>
  {/if}
  {#if jobs.legacy}
    <Modal title={t('jobs.legacy.title')} description={t('jobs.legacy.body')} onclose={() => {}}>
      <progress max={jobs.legacy.total || 1} value={jobs.legacy.done}></progress>
      <p class="mono mig">{jobs.legacy.done}/{jobs.legacy.total}</p>
      {#snippet actions()}<span></span>{/snippet}
    </Modal>
  {/if}
  {#if ui.showShortcuts}<ShortcutsModal onclose={() => (ui.showShortcuts = false)} />{/if}
</div>

<style>
  .layout { height: 100%; }
  .main { height: 100%; margin-left: calc(var(--rail) + var(--safe-left)); display: flex; flex-direction: column; overflow: hidden; }
  .boot { margin: auto; color: var(--text3); font-size: 13px; }
  progress { width: 100%; accent-color: var(--accent); }
  .mig { font-size: 12px; color: var(--text3); margin-top: 8px; }
  @media (max-width: 767px) {
    .main { margin-left: 0; padding-bottom: calc(var(--bottomnav) + var(--safe-bottom)); }
    :global(.rail) { display: none !important; }
  }
  @media (min-width: 768px) {
    :global(.bottom) { display: none !important; }
  }
</style>
