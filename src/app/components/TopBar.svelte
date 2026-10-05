<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, subtitle, actions }: { title: string; subtitle?: string; actions?: Snippet } = $props();
</script>

<header class="top">
  <h1>{title}</h1>
  {#if subtitle}<span class="sub mono">{subtitle}</span>{/if}
  <span class="grow"></span>
  {#if actions}{@render actions()}{/if}
</header>

<style>
  .top {
    min-height: calc(var(--topbar) + var(--safe-top));
    padding: var(--safe-top) calc(16px + var(--safe-right)) 0 16px;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  h1 { font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12px; color: var(--text3); white-space: nowrap; }
  .grow { flex: 1; }
</style>
