<script lang="ts">
  import Modal from './Modal.svelte';
  import { t } from '../i18n/t.svelte';
  let { onclose }: { onclose: () => void } = $props();
  const rows: [string, string[]][] = [
    ['shortcuts.draw', ['D']],
    ['shortcuts.pen', ['B']],
    ['shortcuts.erase', ['E']],
    ['shortcuts.select', ['V']],
    ['shortcuts.guides', ['G']],
    ['shortcuts.zoom', ['+', '−', '0']],
    ['shortcuts.penDone', ['Enter']],
    ['shortcuts.penClose', ['C']],
    ['shortcuts.penCancel', ['Esc']],
    ['shortcuts.delete', ['Del']],
    ['shortcuts.save', ['Ctrl', 'S']],
    ['shortcuts.undo', ['Ctrl', 'Z']],
    ['shortcuts.redo', ['Ctrl', 'Y']],
    ['shortcuts.close', ['Esc']],
  ];
</script>

<Modal title={t('shortcuts.title')} description={t('shortcuts.note')} {onclose}>
  <ul>
    {#each rows as [label, keys] (label)}
      <li><span>{t(label)}</span><span class="keys">{#each keys as k (k)}<kbd>{k}</kbd>{/each}</span></li>
    {/each}
  </ul>
  <p class="g">{t('shortcuts.gestures')}</p>
</Modal>

<style>
  ul { list-style: none; display: grid; gap: 6px; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; font-size: 13px; color: var(--text2); }
  .keys { display: flex; gap: 4px; }
  .g { font-size: 12px; color: var(--text3); margin-top: 12px; line-height: 1.5; }
  kbd { background: var(--bg4); padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border2); font: 11px var(--font-mono); color: var(--text); }
</style>
