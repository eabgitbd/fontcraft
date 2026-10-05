<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import VirtualGrid from '../components/VirtualGrid.svelte';
  import GlyphThumb from '../components/GlyphThumb.svelte';
  import { BENGALI_NAMES, charsForTab, type ScriptTab } from '../charsets';
  import { glyphHasVariants, isGlyphDrawn } from '@/storage/types';
  import { store } from '../stores/project.svelte';
  import { platform } from '@/platform';
  import { buildTemplatePdf, templateFileName } from '@/scan/template-pdf';
  import { bengaliRasterizer } from '@/scan/raster';
  import { toast } from '../stores/toast.svelte';
  import { hrefFor, type Router } from '../router';
  import { t } from '../i18n/t.svelte';

  let { router }: { router: Router } = $props();

  const TABS: ScriptTab[] = ['latin', 'bengali', 'digits', 'punct'];
  let tab = $state<ScriptTab>('latin');
  let onlyEmpty = $state(false);

  /** Characters of the active script that exist in this project. */
  const inTab = $derived(charsForTab(tab).filter((c) => store.glyphs.has(c)));
  const tabsShown = $derived(TABS.filter((k) => charsForTab(k).some((c) => store.glyphs.has(c))));
  const shown = $derived(onlyEmpty ? inTab.filter((c) => !isGlyphDrawn(store.glyphs.get(c)!)) : inTab);

  // If the active tab has no glyphs in this project (e.g. a Bengali-only set), switch to one that does.
  $effect(() => {
    if (tabsShown.length && !tabsShown.includes(tab)) tab = tabsShown[0]!;
  });

  const stats = $derived.by(() => {
    let filled = 0;
    let variants = 0;
    for (const c of inTab) {
      const g = store.glyphs.get(c)!;
      if (isGlyphDrawn(g)) filled++;
      if (glyphHasVariants(g)) variants++;
    }
    return { filled, variants, pct: inTab.length ? Math.round((filled / inTab.length) * 100) : 0 };
  });

  function stateOf(c: string): 'empty' | 'drawn' | 'variants' {
    const g = store.glyphs.get(c)!;
    return glyphHasVariants(g) ? 'variants' : isGlyphDrawn(g) ? 'drawn' : 'empty';
  }

  let making = $state(false);
  async function downloadTemplate() {
    const p = store.project;
    if (!p || making) return;
    making = true;
    try {
      const { blob } = await buildTemplatePdf({ name: p.name, set: p.set, cell: p.cell }, p.set.includes('bengali') ? bengaliRasterizer : undefined);
      const res = await platform().saveFile(templateFileName(p), blob, 'application/pdf');
      if (res !== 'cancelled') toast(t('template.done', { n: p.stats.total }), 'ok');
    } catch (e) {
      toast(t('template.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    } finally {
      making = false;
    }
  }

  function nextEmpty() {
    const idx = inTab.findIndex((c) => !isGlyphDrawn(store.glyphs.get(c)!));
    if (idx < 0) return toast(t('glyphs.allDone'), 'ok');
    router.navigate({ name: 'editor', param: inTab[idx]! });
  }

  const label = (c: string) => `${c} — ${t(`glyphs.state.${stateOf(c)}`)}${BENGALI_NAMES[c] ? `, ${BENGALI_NAMES[c]}` : ''}`;
  const code = (c: string) => 'U+' + (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
</script>

{#if !store.project}
  <TopBar title={t('nav.glyphs')} />
  <NoProject />
{:else}
  <TopBar title={store.project.name} subtitle="{stats.pct}%">
    {#snippet actions()}
      <button class="btn ghost" onclick={downloadTemplate} disabled={making}>{making ? t('template.busy') : t('template.download')}</button>
      <button class="btn ghost" onclick={nextEmpty}>{t('glyphs.nextEmpty')}</button>
    {/snippet}
  </TopBar>
  <div class="bar">
    <div class="tabs" role="tablist">
      {#each tabsShown as k (k)}
        <button role="tab" aria-selected={tab === k} class="tab" class:on={tab === k} lang={k === 'bengali' ? 'bn' : undefined} onclick={() => (tab = k)}>{t(`glyphs.tab.${k}`)}</button>
      {/each}
    </div>
    <span class="pill">{t('glyphs.filled', { n: stats.filled, total: inTab.length })}</span>
    <span class="pill">{t('glyphs.variants', { n: stats.variants })}</span>
    <span class="pill">{stats.pct}%</span>
    <label class="chk"><input type="checkbox" bind:checked={onlyEmpty} />{t('glyphs.onlyEmpty')}</label>
  </div>
  {#if shown.length === 0}
    <p class="none">{onlyEmpty ? t('glyphs.allDone') : t('glyphs.none')}</p>
  {:else}
    <VirtualGrid items={shown} minCell={62}>
      {#snippet cell(c: string)}
        {@const st = stateOf(c)}
        <a class="gc {st}" href={hrefFor({ name: 'editor', param: c })} aria-label={label(c)}>
          <span class="thumb">
            {#if st === 'empty'}<span class="ch" lang={/[\u0980-\u09FF]/.test(c) ? 'bn' : undefined}>{c}</span>
            {:else}<GlyphThumb glyph={store.glyphs.get(c)!} ascender={store.project!.settings.ascender} descender={store.project!.settings.descender} />{/if}
          </span>
          <span class="code mono">{code(c)}</span>
        </a>
      {/snippet}
    </VirtualGrid>
  {/if}
{/if}

<style>
  .bar { padding: 10px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0; }
  .tabs { display: flex; gap: 4px; }
  .tab { min-height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border2); background: transparent; color: var(--text3); font-size: 13px; font-weight: 500; }
  @media (pointer: coarse) { .tab { min-height: var(--tap); } }
  .tab.on { background: var(--abg); color: var(--accent2); border-color: var(--aborder); }
  .chk { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text2); min-height: 36px; margin-left: auto; }
  .chk input { accent-color: var(--accent); width: 18px; height: 18px; }
  .none { padding: 40px; text-align: center; color: var(--text3); font-size: 13px; }
  .gc { width: 100%; height: 100%; border-radius: var(--r); border: 1px solid var(--border); background: var(--bg2); display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 4px 2px 3px; color: var(--text); text-decoration: none; position: relative; overflow: hidden; transition: var(--tr); }
  .gc:hover { border-color: var(--aborder); background: var(--abg); }
  .gc.drawn, .gc.variants { border-color: var(--aborder); }
  .gc.drawn::after, .gc.variants::after { content: ''; position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .gc.variants::after { background: var(--amber); }
  .thumb { flex: 1; min-height: 0; width: 100%; display: grid; place-items: center; padding: 2px 6px; }
  .ch { font-size: 22px; line-height: 1; color: var(--text3); }
  .code { font-size: 9px; color: var(--text3); }
</style>
