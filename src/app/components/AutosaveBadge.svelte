<script lang="ts">
  import { autosaveState } from '../stores/autosave.svelte';
  import { t } from '../i18n/t.svelte';
</script>

<div class="asv mono" class:show={autosaveState.visible} role="status" aria-live="polite">{autosaveState.visible ? t('autosave.saved') : ''}</div>

<style>
  .asv {
    position: fixed;
    /* Top right, just under the top bar: it never covers a screen's bottom controls. */
    right: calc(12px + var(--safe-right));
    top: calc(var(--topbar) + var(--safe-top) + 8px);
    font-size: 11px;
    color: var(--text3);
    background: var(--bg2);
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid var(--border);
    z-index: 50;
    opacity: 0;
    transition: opacity 0.25s;
    pointer-events: none;
  }
  .asv.show { opacity: 1; }
  @media (max-width: 767px) {
    .asv { right: calc(12px + var(--safe-right)); top: calc(var(--topbar) + var(--safe-top) + 8px); }
  }
</style>
