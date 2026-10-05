<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { setLigatures } from '@/storage/projects';
  import type { Ligature } from '@/storage/types';
  import { store } from '../stores/project.svelte';
  import { toast } from '../stores/toast.svelte';
  import { t } from '../i18n/t.svelte';

  let showAdd = $state(false);
  let input = $state('');
  let output = $state('');
  let desc = $state('');
  let inputEl: HTMLInputElement | undefined = $state();

  const ligs = $derived(store.project?.ligatures ?? []);

  async function persist(next: Ligature[]) {
    const p = store.project;
    if (!p) return;
    try {
      store.setProject(await setLigatures(p.id, next));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'wn');
    }
  }

  async function add() {
    const inp = input.trim();
    if ([...inp].length < 2) {
      toast(t('ligatures.tooShort'), 'wn');
      inputEl?.focus();
      return;
    }
    await persist([...ligs, { input: inp, output: output.trim() || `${inp}_lig`, name: desc.trim() || `${inp} ligature` }]);
    toast(t('ligatures.added', { input: inp }), 'ok');
    showAdd = false;
    input = output = desc = '';
  }
</script>

<TopBar title={t('ligatures.title')}>
  {#snippet actions()}
    {#if store.project}<button class="btn primary" onclick={() => (showAdd = true)}><Icon name="plus" size={16} />{t('ligatures.add')}</button>{/if}
  {/snippet}
</TopBar>
{#if !store.project}
  <NoProject />
{:else if ligs.length === 0}
  <div class="empty"><h2>{t('ligatures.empty.title')}</h2><p>{t('ligatures.empty.body')}</p></div>
{:else}
  <ul class="scroll list">
    {#each ligs as lg, i (i)}
      <li class="card row">
        <span class="parts mono">{[...lg.input].join(' + ')}</span>
        <span class="arrow" aria-hidden="true">→</span>
        <span class="result">{lg.input}</span>
        <span class="name mono">{lg.name || lg.output}</span>
        <button class="btn danger" onclick={() => persist(ligs.filter((_, j) => j !== i))} aria-label="{t('ligatures.remove')}: {lg.input}">{t('ligatures.remove')}</button>
      </li>
    {/each}
  </ul>
{/if}

{#if showAdd}
  <Modal title={t('ligatures.add')} onclose={() => (showAdd = false)}>
    <div class="field"><label for="l-in">{t('ligatures.input')}</label><input id="l-in" class="input" bind:this={inputEl} bind:value={input} autocomplete="off" /></div>
    <div class="field"><label for="l-out">{t('ligatures.output')}</label><input id="l-out" class="input" bind:value={output} placeholder="fi_lig" autocomplete="off" /></div>
    <div class="field"><label for="l-desc">{t('ligatures.desc')}</label><input id="l-desc" class="input" bind:value={desc} autocomplete="off" /></div>
    {#snippet actions()}
      <button class="btn ghost" onclick={() => (showAdd = false)}>{t('common.cancel')}</button>
      <button class="btn primary" onclick={add}>{t('common.save')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 32px; text-align: center; color: var(--text3); }
  .empty h2 { font-size: 16px; color: var(--text2); }
  .empty p { font-size: 13px; max-width: 320px; line-height: 1.5; }
  .list { list-style: none; display: grid; gap: 8px; align-content: start; }
  .row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 16px; }
  .parts { font-size: 22px; }
  .arrow { color: var(--text3); font-size: 18px; }
  .result { font-size: 26px; color: var(--accent2); }
  .name { font-size: 12px; color: var(--text3); flex: 1; min-width: 80px; }
</style>
