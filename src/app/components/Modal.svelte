<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { platform } from '@/platform';
  import { t } from '../i18n/t.svelte';

  let {
    title,
    description,
    onclose,
    children,
    actions,
  }: { title: string; description?: string; onclose: () => void; children?: Snippet; actions?: Snippet } = $props();

  let dialog: HTMLDivElement;
  let previouslyFocused: Element | null = null;
  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  onMount(() => {
    previouslyFocused = document.activeElement;
    const first = dialog.querySelector<HTMLElement>('input,select,textarea') ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();
    // Android back closes the modal first (plan section 9).
    const off = platform().onBack(() => {
      onclose();
      return true;
    });
    return () => {
      off();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Keep the focused input visible when the on-screen keyboard opens.
  function onFocusIn(e: FocusEvent) {
    const el = e.target as HTMLElement;
    if (el.matches('input,textarea,select')) setTimeout(() => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 250);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dlg" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" bind:this={dialog} onkeydown={onKeydown} onfocusin={onFocusIn}>
    <h2 id={titleId}>{title}</h2>
    {#if description}<p class="desc">{description}</p>{/if}
    {@render children?.()}
    <div class="actions">
      {#if actions}{@render actions()}{:else}<button class="btn ghost" onclick={onclose}>{t('common.close')}</button>{/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) calc(12px + var(--safe-bottom)) calc(12px + var(--safe-left));
    z-index: 1000;
  }
  .dlg {
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: var(--r3);
    padding: 24px;
    width: 500px;
    max-width: 100%;
    max-height: 100%;
    overflow-y: auto;
    outline: none;
  }
  h2 { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
  .desc { font-size: 13px; color: var(--text2); margin-bottom: 16px; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; flex-wrap: wrap; }
</style>
