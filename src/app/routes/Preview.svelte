<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import { layoutText } from '@/engine/layout';
  import { PREVIEW_SAMPLES } from '../charsets';
  import { blobUrl } from '../blobUrl';
  import { hasVectorInk, variantPaths } from '../glyphPaths';
  import { platform } from '@/platform';
  import { store } from '../stores/project.svelte';
  import { toast } from '../stores/toast.svelte';
  import { t } from '../i18n/t.svelte';

  const BGS = ['var(--bg)', '#ffffff', '#f5f3ef', '#1a1a2e', '#2d1b0e'];
  const FG_FOR_BG = ['#f0f0f4', '#15151a', '#15151a', '#f0f0f4', '#f5e6d3'];

  let text = $state(PREVIEW_SAMPLES[0]!);
  let size = $state(56);
  let spacing = $state(0);
  let bgIdx = $state(0);
  let color = $state('#f0f0f4');
  let colorTouched = $state(false);

  const s = $derived(store.project?.settings);
  const k = $derived(s ? size / s.upm : 1);
  const lines = $derived(
    store.project && s ? layoutText(text, store.glyphs, store.project.kerning, { tracking: s.tracking, letterSpacing: spacing / k, fallbackAdvance: s.defWidth }) : [],
  );
  const missing = $derived([...new Set(lines.flatMap((l) => l.missing))]);
  const lineH = $derived(s ? (s.ascender - s.descender) * 1.15 : 1000);
  const maxW = $derived(Math.max(1, ...lines.map((l) => l.width)));
  const effColor = $derived(colorTouched ? color : (FG_FOR_BG[bgIdx] ?? color));

  async function copy() {
    if (!text) return;
    try {
      await platform().copyText(text);
      toast(t('preview.copied'), 'ok');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'wn');
    }
  }
</script>

<TopBar title={t('preview.title')}>
  {#snippet actions()}
    {#if store.project}<button class="btn ghost" onclick={copy}>{t('preview.copy')}</button>{/if}
  {/snippet}
</TopBar>
{#if !store.project || !s}
  <NoProject />
{:else}
  <div class="ctl">
    <label class="cg"><span>{t('preview.size')}</span><input type="range" min="16" max="160" bind:value={size} /><span class="mono">{size}px</span></label>
    <label class="cg"><span>{t('preview.spacing')}</span><input type="range" min="-20" max="40" bind:value={spacing} /><span class="mono">{spacing}px</span></label>
    <label class="cg"><span>{t('preview.color')}</span><input type="color" value={effColor} oninput={(e) => ((color = e.currentTarget.value), (colorTouched = true))} /></label>
    <button class="btn ghost" onclick={() => ((bgIdx = (bgIdx + 1) % BGS.length), (colorTouched = false))}>{t('preview.background')}</button>
  </div>
  <div class="area" style:background={BGS[bgIdx]}>
    <div class="stage" style:color={effColor}>
      {#each lines as line, li (li)}
        <svg class="line" viewBox="0 {-s.ascender} {Math.max(line.width, 1)} {s.ascender - s.descender}" style:width="{Math.min(line.width * k, 4000)}px" style:height="{(s.ascender - s.descender) * k}px" role="img" aria-label={text.split('\n')[li]}>
          <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            {#each line.items as it, ii (ii)}
              {@const v = it.glyph.variants[0]!}
              <g transform="translate({it.x} 0)">
                {#if hasVectorInk(v)}
                  <g transform="scale(1,-1)" fill="currentColor" stroke="none" fill-rule="nonzero">
                    {#each variantPaths(v) as d, si (si)}<path {d} />{/each}
                  </g>
                {:else if v.legacyPng}
                  <image href={blobUrl(v.legacyPng)} x="0" y={-s.ascender} width={it.glyph.advance} height={s.ascender - s.descender} preserveAspectRatio="xMidYMid meet" />
                {/if}
              </g>
            {/each}
          </g>
        </svg>
      {/each}
    </div>
    {#if missing.length}<p class="miss" role="status">{t('preview.missing', { chars: missing.join(' ') })}</p>{/if}
  </div>
  <div class="edit">
    <label class="label" for="pv-text">{t('preview.text')}</label>
    <textarea id="pv-text" class="input" rows="2" bind:value={text} lang="und"></textarea>
    <div class="samples" aria-label={t('preview.samples')}>
      {#each PREVIEW_SAMPLES as sample, i (i)}<button class="pill" lang={/[\u0980-\u09FF]/.test(sample) ? 'bn' : 'en'} onclick={() => (text = sample)}>{[...sample].slice(0, 16).join('')}…</button>{/each}
    </div>
    <p class="note">{t('preview.note')}</p>
  </div>
{/if}

<style>
  .ctl { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--bg2); flex-shrink: 0; }
  .cg { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text3); }
  .cg input[type='range'] { width: 110px; accent-color: var(--accent); }
  .cg input[type='color'] { width: 36px; height: 36px; border: none; background: transparent; padding: 0; }
  .cg .mono { color: var(--accent2); min-width: 38px; }
  .area { flex: 1; min-height: 120px; overflow: auto; padding: 24px; }
  .stage { display: inline-flex; flex-direction: column; gap: 6px; min-width: 100%; }
  .line { display: block; overflow: visible; max-width: none; }
  .miss { margin-top: 16px; font-size: 12px; color: var(--amber); }
  .edit { padding: 12px 18px calc(12px + var(--safe-bottom)); border-top: 1px solid var(--border); background: var(--bg2); display: grid; gap: 8px; flex-shrink: 0; }
  textarea.input { padding: 10px 12px; resize: vertical; min-height: 64px; }
  .samples { display: flex; gap: 6px; flex-wrap: wrap; }
  .samples .pill { min-height: 32px; cursor: pointer; }
  .note { font-size: 11px; color: var(--text3); }
</style>
