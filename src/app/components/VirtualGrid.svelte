<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { gridMetrics, visibleRange } from '../virtual';

  let { items, minCell = 64, gap = 6, cell }: { items: readonly T[]; minCell?: number; gap?: number; cell: Snippet<[T, number]> } = $props();

  let host: HTMLDivElement | undefined = $state();
  let width = $state(600);
  let height = $state(600);
  let scrollTop = $state(0);

  const m = $derived(gridMetrics(width, items.length, minCell, gap));
  const range = $derived(visibleRange(m, items.length, scrollTop, height));
  const mounted = $derived(items.slice(range.start, range.end));

  onMount(() => {
    if (!host) return;
    const measure = () => {
      width = host!.clientWidth || width;
      height = host!.clientHeight || height;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  });
</script>

<div class="vg" bind:this={host} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
  <div class="inner" style:height="{m.totalHeight}px">
    {#each mounted as item, i (range.start + i)}
      {@const idx = range.start + i}
      <div class="slot" style:left="{(idx % m.cols) * (m.cell + gap)}px" style:top="{Math.floor(idx / m.cols) * m.rowHeight}px" style:width="{m.cell}px" style:height="{m.cell}px">
        {@render cell(item, idx)}
      </div>
    {/each}
  </div>
</div>

<style>
  .vg { flex: 1; overflow-y: auto; padding: 14px 18px; min-height: 0; }
  .inner { position: relative; }
  .slot { position: absolute; }
</style>
