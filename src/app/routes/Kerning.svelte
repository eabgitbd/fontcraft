<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import { setKerning } from '@/storage/projects';
  import type { KernPair } from '@/storage/types';
  import { store } from '../stores/project.svelte';
  import { toast } from '../stores/toast.svelte';
  import { t } from '../i18n/t.svelte';

  let left = $state('A');
  let right = $state('V');
  let value = $state(0);
  let selected = $state<number | null>(null);

  const pairs = $derived(store.project?.kerning ?? []);
  const gapPx = $derived(Math.max(-40, value * 0.08));
  const sign = (v: number) => (v > 0 ? '+' : '') + v;

  async function persist(next: KernPair[]) {
    const p = store.project;
    if (!p) return false;
    try {
      store.setProject(await setKerning(p.id, next));
      return true;
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'wn');
      return false;
    }
  }

  async function save() {
    const l = left.trim();
    const r = right.trim();
    if (!l || !r) return toast(t('kerning.enterBoth'), 'wn');
    const v = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    const idx = pairs.findIndex((k) => k.left === l && k.right === r);
    const next = idx >= 0 ? pairs.map((k, i) => (i === idx ? { ...k, value: v } : k)) : [...pairs, { left: l, right: r, value: v }];
    if (await persist(next)) toast(idx >= 0 ? t('kerning.updated', { pair: l + r }) : t('kerning.added', { pair: l + r, value: sign(v) }), 'ok');
  }

  async function remove(i: number) {
    if (await persist(pairs.filter((_, j) => j !== i))) selected = null;
  }

  function pick(i: number) {
    const k = pairs[i]!;
    selected = i;
    left = k.left;
    right = k.right;
    value = k.value;
  }
</script>

<TopBar title={t('kerning.title')} subtitle={String(pairs.length)} />
{#if !store.project}
  <NoProject />
{:else}
  <div class="scroll wrap">
    <section class="card">
      <div class="viz" aria-hidden="true">
        <span class="big">{left || 'A'}</span><span class="gap" style:width="{gapPx}px" class:neg={value < 0}></span><span class="big">{right || 'V'}</span>
      </div>
      <p class="ctx mono">{(left || 'A') + (right || 'V')}{(left || 'A') + (right || 'V')}{left || 'A'} · {sign(value)}u</p>
      <div class="pair">
        <div class="field"><label for="kp-l">{t('kerning.left')}</label><input id="kp-l" class="input" bind:value={left} maxlength="4" autocomplete="off" /></div>
        <div class="field"><label for="kp-r">{t('kerning.right')}</label><input id="kp-r" class="input" bind:value={right} maxlength="4" autocomplete="off" /></div>
        <div class="field"><label for="kp-v">{t('kerning.value')}</label><input id="kp-v" class="input mono" type="number" inputmode="numeric" bind:value={value} /></div>
      </div>
      <input class="slider" type="range" min="-300" max="300" step="5" bind:value aria-label={t('kerning.value')} />
      <button class="btn primary" onclick={save}>{t('kerning.save')}</button>
    </section>
    {#if pairs.length === 0}
      <div class="empty"><h2>{t('kerning.empty.title')}</h2><p>{t('kerning.empty.body')}</p></div>
    {:else}
      <ul class="list">
        {#each pairs as k, i (k.left + '\u0000' + k.right)}
          <li class="kr" class:sel={selected === i}>
            <button class="pick" onclick={() => pick(i)}><span class="pr mono">{k.left}{k.right}</span><span class="v mono">{sign(k.value)}u</span></button>
            <button class="btn danger" onclick={() => remove(i)} aria-label="{t('kerning.remove')}: {k.left}{k.right}">×</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .wrap { display: grid; gap: 16px; align-content: start; max-width: 640px; }
  .viz { display: flex; align-items: center; justify-content: center; min-height: 90px; background: var(--bg3); border-radius: var(--r); margin-bottom: 8px; }
  .big { font-size: 48px; line-height: 1; }
  .gap { display: inline-block; height: 4px; background: var(--accent); border-radius: 2px; min-width: 0; }
  .gap.neg { background: var(--amber); }
  .ctx { font-size: 12px; color: var(--text3); margin-bottom: 14px; text-align: center; }
  .pair { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 10px; }
  .slider { width: 100%; accent-color: var(--accent); margin: 4px 0 14px; min-height: 28px; }
  .empty { text-align: center; color: var(--text3); padding: 24px 0; }
  .empty h2 { font-size: 16px; color: var(--text2); margin-bottom: 6px; }
  .empty p { font-size: 13px; }
  .list { list-style: none; display: grid; gap: 6px; }
  .kr { display: flex; gap: 8px; align-items: stretch; }
  .pick { flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 0 14px; min-height: var(--tap); border-radius: var(--r); background: var(--bg3); border: 1px solid var(--border); }
  .kr.sel .pick { border-color: var(--accent); background: var(--abg); }
  .pr { font-size: 22px; }
  .v { font-size: 12px; color: var(--accent2); }
</style>
