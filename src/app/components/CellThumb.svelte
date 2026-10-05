<script lang="ts">
  /** Draws a 64 x 64 ink-coverage map (white page, dark ink) into a small canvas. */
  let { alpha, size = 56 }: { alpha: Uint8Array | undefined; size?: number } = $props();
  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const c = canvas;
    const a = alpha;
    if (!c || !a || a.length !== 64 * 64) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(64, 64);
    for (let i = 0; i < 4096; i++) {
      const v = 255 - a[i]!;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
</script>

<canvas bind:this={canvas} width="64" height="64" style:width="{size}px" style:height="{size}px" aria-hidden="true"></canvas>

<style>
  canvas { border-radius: 4px; background: #fff; image-rendering: auto; display: block; }
</style>
