<script lang="ts">
  import { blobUrl } from '../blobUrl';
  import { hasVectorInk, variantPaths } from '../glyphPaths';
  import type { Glyph } from '@/storage/types';

  let { glyph, ascender = 800, descender = -200 }: { glyph: Glyph; ascender?: number; descender?: number } = $props();

  const v = $derived(glyph.variants[0]);
  const vbH = $derived(ascender - descender);
  const paths = $derived(v && hasVectorInk(v) ? variantPaths(v) : []);
</script>

{#if paths.length}
  <svg viewBox="0 {-ascender} {Math.max(glyph.advance, 1)} {vbH}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g transform="scale(1,-1)" fill="currentColor" fill-rule="nonzero">
      {#each paths as d, i (i)}<path {d} />{/each}
    </g>
  </svg>
{:else if v?.legacyPng}
  <img src={blobUrl(v.legacyPng)} alt="" loading="lazy" />
{/if}

<style>
  svg, img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
