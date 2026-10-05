// Canvas 2D drawing for the editor. Pure functions of (context, viewport, data): no state lives here.
// World space is font units, y-up. Ink is drawn with a flipped transform; guides and overlays are
// drawn in screen space so lines stay one crisp pixel wide at every zoom level.
import type { Contour, FontSettings, PathNode, PenPath, Pt, Stroke } from '@/storage/types';
import { contourToPath } from './geometry/fit';
import { outlineOf, ringToPath, strokeOutline } from './geometry/outline';
import type { Viewport } from './viewport';

export type Colors = { text: string; bg2: string; bg3: string; accent: string; accent2: string; aborder: string; border2: string; amber: string; red: string };

export function readColors(el: Element = document.documentElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    text: v('--text', '#f0f0f4'), bg2: v('--bg2', '#111113'), bg3: v('--bg3', '#1a1a1e'), accent: v('--accent', '#6c63ff'), accent2: v('--accent2', '#8b85ff'),
    aborder: v('--aborder', 'rgba(108,99,255,.35)'), border2: v('--border2', '#3d3d4a'), amber: v('--amber', '#f59e0b'), red: v('--red', '#ef4444'),
  };
}

const strokeP2D = new WeakMap<Stroke, Path2D>();
const tracedP2D = new WeakMap<readonly Contour[], Path2D>();
const penP2D = new WeakMap<PenPath, Path2D>();
const strokePath2D = (s: Stroke): Path2D => {
  let p = strokeP2D.get(s);
  if (!p) strokeP2D.set(s, (p = new Path2D(ringToPath(strokeOutline(s)))));
  return p;
};
const penPath2D = (c: PenPath): Path2D => {
  let p = penP2D.get(c);
  if (!p) penP2D.set(c, (p = new Path2D(contourToPath(c))));
  return p;
};

const tracedPath2D = (cs: readonly Contour[]): Path2D => {
  let p = tracedP2D.get(cs);
  if (!p) tracedP2D.set(cs, (p = new Path2D(cs.map(contourToPath).join(''))));
  return p;
};

const world = (ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number) => ctx.setTransform(dpr * vp.k, 0, 0, -dpr * vp.k, dpr * vp.tx, dpr * vp.ty);
const screen = (ctx: CanvasRenderingContext2D, dpr: number) => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

/** Ink buffer: strokes and pen paths in order, eraser strokes cut with destination-out. */
export function drawInk(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  dpr: number,
  size: { w: number; h: number },
  strokes: readonly Stroke[],
  paths: readonly PenPath[],
  color: string,
  liveStroke?: { pts: Stroke['pts']; size: number; erase: boolean; real: boolean } | null,
  traced: readonly Contour[] = [],
): void {
  screen(ctx, dpr);
  ctx.clearRect(0, 0, size.w, size.h);
  world(ctx, vp, dpr);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  // Imported artwork is the bottom layer; its outer contours and holes are wound opposite ways.
  if (traced.length) ctx.fill(tracedPath2D(traced), 'nonzero');
  for (const p of paths) {
    const p2d = penPath2D(p);
    if (p.closed) ctx.fill(p2d);
    ctx.lineWidth = p.size;
    ctx.stroke(p2d);
  }
  for (const s of strokes) {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.fill(strokePath2D(s));
  }
  if (liveStroke && liveStroke.erase && liveStroke.pts.length) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(new Path2D(ringToPath(outlineOf({ pts: liveStroke.pts, size: liveStroke.size }, liveStroke.real))));
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function drawGuides(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, size: { w: number; h: number }, s: FontSettings, adv: number, lsb: number, rsb: number, c: Colors, showLines: boolean): void {
  screen(ctx, dpr);
  // Repaint the whole layer opaquely. This layer sits under the transparent live layer, so it never
  // needs transparency, and a full opaque fill is reliable where a full-canvas clearRect followed by
  // compositing another canvas was observed to leave stale pixels in Chromium.
  ctx.fillStyle = c.bg3;
  ctx.fillRect(0, 0, size.w, size.h);
  const [x0, yTop] = vp.toScreen(0, s.ascender);
  const [x1, yBot] = vp.toScreen(adv, s.descender);
  ctx.fillStyle = c.bg2;
  ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  if (!showLines) return;
  const px = (v: number) => Math.round(v) + 0.5;
  const hline = (y: number, color: string, dash: number[]) => {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const sy = px(vp.toScreen(0, y)[1]);
    ctx.moveTo(0, sy);
    ctx.lineTo(size.w, sy);
    ctx.stroke();
  };
  const vline = (x: number, color: string) => {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const sx = px(vp.toScreen(x, 0)[0]);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, size.h);
    ctx.stroke();
  };
  hline(0, c.accent2, []);
  hline(s.xheight, c.aborder, [6, 4]);
  hline(s.capheight, c.aborder, [6, 4]);
  hline(s.ascender, c.border2, [2, 4]);
  hline(s.descender, c.border2, [2, 4]);
  vline(0, c.border2);
  vline(adv, c.border2);
  vline(lsb, c.aborder);
  vline(adv - rsb, c.aborder);
  ctx.setLineDash([]);
}

/** Draws `img` contained inside the glyph box (ascender to descender, 0 to advance). */
export function drawReference(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, img: CanvasImageSource & { width: number; height: number }, s: FontSettings, adv: number, alpha: number): void {
  screen(ctx, dpr);
  const [x0, y0] = vp.toScreen(0, s.ascender);
  const [x1, y1] = vp.toScreen(adv, s.descender);
  const bw = x1 - x0;
  const bh = y1 - y0;
  const r = Math.min(bw / img.width, bh / img.height);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x0 + (bw - img.width * r) / 2, y0 + (bh - img.height * r) / 2, img.width * r, img.height * r);
  ctx.globalAlpha = 1;
}

function nodeScreen(vp: Viewport, p: Pt): [number, number] {
  return vp.toScreen(p.x, p.y);
}

/** Pen path in progress or a selected pen path: curve, handles and numbered anchors. */
export function drawNodes(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, nodes: readonly PathNode[], closed: boolean, c: Colors, nodeRadius: number): void {
  if (!nodes.length) return;
  screen(ctx, dpr);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.strokeStyle = c.accent2;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  const first = nodeScreen(vp, nodes[0]!.p);
  ctx.moveTo(first[0], first[1]);
  const segs = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i]!;
    const b = nodes[(i + 1) % nodes.length]!;
    const c1 = nodeScreen(vp, a.hOut ?? a.p);
    const c2 = nodeScreen(vp, b.hIn ?? b.p);
    const e = nodeScreen(vp, b.p);
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  nodes.forEach((n, i) => {
    const [x, y] = nodeScreen(vp, n.p);
    for (const h of [n.hIn, n.hOut]) {
      if (!h) continue;
      const [hx, hy] = nodeScreen(vp, h);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(245,158,11,.6)';
      ctx.lineWidth = 1;
      ctx.moveTo(x, y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = c.amber;
      ctx.arc(hx, hy, nodeRadius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.fillStyle = n.kind === 'smooth' ? c.accent : c.bg3;
    ctx.strokeStyle = c.accent2;
    ctx.lineWidth = 2;
    if (n.kind === 'smooth') ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
    else ctx.rect(x - nodeRadius * 0.85, y - nodeRadius * 0.85, nodeRadius * 1.7, nodeRadius * 1.7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.font = '10px monospace';
    ctx.fillText(String(i + 1), x + nodeRadius + 3, y - nodeRadius);
  });
}

export function drawLiveStroke(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, pts: Stroke['pts'], size: number, real: boolean, color: string, alpha: number): void {
  if (!pts.length) return;
  world(ctx, vp, dpr);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(new Path2D(ringToPath(outlineOf({ pts, size }, real))));
  ctx.globalAlpha = 1;
}

/** Translucent outline of an eraser stroke while dragging (the cut itself shows in the ink buffer). */
export function drawEraserCursor(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, at: Pt, size: number, c: Colors): void {
  screen(ctx, dpr);
  const [x, y] = vp.toScreen(at.x, at.y);
  ctx.beginPath();
  ctx.strokeStyle = c.red;
  ctx.lineWidth = 1.5;
  ctx.arc(x, y, Math.max(2, (size * vp.k) / 2), 0, Math.PI * 2);
  ctx.stroke();
}

/** The exported contours over the raw ink, so the user sees exactly what the font will contain. */
export function drawContourPreview(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, contours: readonly Contour[], c: Colors): void {
  if (!contours.length) return;
  screen(ctx, dpr);
  ctx.strokeStyle = c.amber;
  ctx.fillStyle = c.amber;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);
  for (const k of contours) {
    const n = k.nodes.length;
    ctx.beginPath();
    const f = vp.toScreen(k.nodes[0]!.p.x, k.nodes[0]!.p.y);
    ctx.moveTo(f[0], f[1]);
    const segs = k.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = k.nodes[i]!;
      const b = k.nodes[(i + 1) % n]!;
      const e = vp.toScreen(b.p.x, b.p.y);
      if (!a.hOut && !b.hIn) ctx.lineTo(e[0], e[1]);
      else {
        const c1 = vp.toScreen((a.hOut ?? a.p).x, (a.hOut ?? a.p).y);
        const c2 = vp.toScreen((b.hIn ?? b.p).x, (b.hIn ?? b.p).y);
        ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
      }
    }
    ctx.stroke();
    for (const nd of k.nodes) {
      const [x, y] = vp.toScreen(nd.p.x, nd.p.y);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
}

/** Dashed bounding box around a selected stroke. */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, stroke: Stroke, c: Colors): void {
  if (!stroke.pts.length) return;
  screen(ctx, dpr);
  const r = stroke.size / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke.pts) {
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
  }
  const [x0, y0] = vp.toScreen(minX, maxY);
  const [x1, y1] = vp.toScreen(maxX, minY);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = c.accent2;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
}
