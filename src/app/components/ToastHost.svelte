<script lang="ts">
  import { toasts } from '../stores/toast.svelte';
  import { t } from '../i18n/t.svelte';
</script>

<div class="wrap" role="status" aria-live="polite">
  {#each toasts.items as item (item.id)}
    <div class="toast {item.kind}">
      <span class="msg">{item.message}</span>
      {#if item.action}
        <button class="act" onclick={() => { item.action?.run(); toasts.dismiss(item.id); }}>{item.action.label}</button>
      {/if}
      <button class="x" aria-label={t('toast.close')} onclick={() => toasts.dismiss(item.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .wrap {
    position: fixed;
    right: calc(16px + var(--safe-right));
    bottom: calc(16px + var(--safe-bottom) + var(--toast-lift, 0px));
    left: auto;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 32px));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    background: var(--bg3);
    border: 1px solid var(--border2);
    border-radius: var(--r2);
    padding: 10px 8px 10px 14px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: in 0.22s ease;
  }
  .toast.ok { border-color: rgba(34, 197, 94, 0.45); }
  .toast.wn { border-color: rgba(245, 158, 11, 0.5); }
  .msg { flex: 1; line-height: 1.4; }
  .act { background: none; border: none; color: var(--accent2); font-weight: 600; min-height: 36px; padding: 0 8px; }
  .x { background: none; border: none; color: var(--text3); font-size: 20px; width: 36px; height: 36px; line-height: 1; }
  @keyframes in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @media (max-width: 767px) {
    .wrap { --toast-lift: var(--bottomnav); left: calc(16px + var(--safe-left)); max-width: none; }
  }
</style>
