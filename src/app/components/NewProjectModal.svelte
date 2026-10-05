<script lang="ts">
  import Modal from './Modal.svelte';
  import { CHAR_SET_IDS, type CharSetId } from '../charsets';
  import { createProject } from '@/storage/projects';
  import type { Project } from '@/storage/types';
  import { t } from '../i18n/t.svelte';

  let { oncreate, oncancel }: { oncreate: (p: Project) => void; oncancel: () => void } = $props();

  let name = $state('');
  let set = $state<CharSetId>('latin');
  let cell = $state('medium');
  let busy = $state(false);
  let error = $state('');
  let nameInput: HTMLInputElement | undefined = $state();

  async function submit() {
    if (!name.trim()) {
      nameInput?.focus();
      return;
    }
    busy = true;
    error = '';
    try {
      oncreate(await createProject({ name, set, cell }));
    } catch (e) {
      error = String((e as Error)?.message ?? e);
      busy = false;
    }
  }
</script>

<Modal title={t('project.new.title')} onclose={oncancel}>
  <div class="field">
    <label for="np-name">{t('project.new.name')}</label>
    <input id="np-name" class="input" bind:this={nameInput} bind:value={name} maxlength="60" autocomplete="off" onkeydown={(e) => e.key === 'Enter' && submit()} />
  </div>
  <div class="field">
    <label for="np-set">{t('project.new.set')}</label>
    <select id="np-set" class="input" bind:value={set}>
      {#each CHAR_SET_IDS as id (id)}<option value={id}>{t(`project.set.${id}`)}</option>{/each}
    </select>
  </div>
  <div class="field">
    <label for="np-cell">{t('project.new.cell')}</label>
    <select id="np-cell" class="input" bind:value={cell}>
      <option value="small">{t('project.cell.small')}</option>
      <option value="medium">{t('project.cell.medium')}</option>
      <option value="large">{t('project.cell.large')}</option>
    </select>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {#snippet actions()}
    <button class="btn ghost" onclick={oncancel}>{t('common.cancel')}</button>
    <button class="btn primary" disabled={busy} onclick={submit}>{t('project.new.create')}</button>
  {/snippet}
</Modal>

<style>
  .err { color: var(--red); font-size: 13px; }
</style>
