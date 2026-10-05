import type { Rasterizer } from './template-pdf';

/** Renders text to a transparent PNG using the bundled Noto Sans Bengali, so the PDF can show Bengali. */
export const bengaliRasterizer: Rasterizer = async (text, px, rgb) => {
  if (typeof document === 'undefined') return null;
  try {
    await document.fonts?.load(`600 ${px}px "Noto Sans Bengali"`, text);
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return null;
    const font = `600 ${px}px "Noto Sans Bengali", sans-serif`;
    probe.font = font;
    const m = probe.measureText(text);
    const w = Math.ceil(m.width) + 8;
    const h = Math.ceil(px * 1.5);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.font = font;
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, 4, px * 1.1);
    return { dataUrl: c.toDataURL('image/png'), aspect: w / h };
  } catch {
    return null;
  }
};
