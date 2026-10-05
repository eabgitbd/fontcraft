import type { RGBA } from './scan-core';

/** Longest side kept when decoding. A 300 dpi A4 scan is about 3500 px; phone photos are larger. */
export const MAX_SIDE = 5000;

type Canvas2D = { getContext(t: '2d', o?: object): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null };

function makeCanvas(w: number, h: number): Canvas2D & { width: number; height: number } {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as never;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c as never;
}

/** Decodes an image (PNG, JPEG, WebP...) to RGBA, honouring EXIF orientation and capping the size. */
export async function decodeToRGBA(blob: Blob, maxSide = MAX_SIDE): Promise<RGBA> {
  const bmp = await createImageBitmap(blob);
  try {
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available');
    (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
    (ctx as CanvasRenderingContext2D).drawImage(bmp, 0, 0, w, h);
    const d = (ctx as CanvasRenderingContext2D).getImageData(0, 0, w, h);
    return { data: d.data, width: w, height: h };
  } finally {
    bmp.close?.();
  }
}
