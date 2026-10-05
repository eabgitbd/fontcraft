// SVG artwork to glyph contours, without the DOM (so it runs anywhere and is unit tested).
// Supported: <path> (every command, including arcs), rect, circle, ellipse, polygon, polyline, and
// transform on elements and groups. Not supported: CSS, <use>, clip paths, strokes (only fills matter).
import type { Contour, PathNode } from '@/storage/types';
import { flattenContour } from '@/engine/geometry/flatten';
import { normalizeWinding } from '@/engine/geometry/rings';

type Pt = { x: number; y: number };
type Mat = [number, number, number, number, number, number]; // a b c d e f
const I: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function parseTransform(src: string | undefined): Mat {
  let m: Mat = I;
  if (!src) return m;
  for (const t of src.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = (t[2] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    const n = (i: number, d = 0) => (Number.isFinite(a[i]!) ? a[i]! : d);
    let r: Mat = I;
    switch (t[1]) {
      case 'matrix': r = [n(0, 1), n(1), n(2), n(3, 1), n(4), n(5)]; break;
      case 'translate': r = [1, 0, 0, 1, n(0), n(1)]; break;
      case 'scale': r = [n(0, 1), 0, 0, n(1, n(0, 1)), 0, 0]; break;
      case 'rotate': {
        const ang = (n(0) * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang);
        r = [c, s, -s, c, 0, 0];
        if (a.length >= 3) r = mul(mul([1, 0, 0, 1, n(1), n(2)], r), [1, 0, 0, 1, -n(1), -n(2)]);
        break;
      }
      case 'skewX': r = [1, 0, Math.tan((n(0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': r = [1, Math.tan((n(0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, r);
  }
  return m;
}

const NUM = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/y;

class Reader {
  i = 0;
  constructor(readonly s: string) {}
  private skip() {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i]!)) this.i++;
  }
  peekCmd(): string | null {
    this.skip();
    const ch = this.s[this.i];
    return ch && /[a-zA-Z]/.test(ch) ? ch : null;
  }
  takeCmd(): string | null {
    const c = this.peekCmd();
    if (c) this.i++;
    return c;
  }
  hasNumber(): boolean {
    this.skip();
    NUM.lastIndex = this.i;
    return NUM.test(this.s);
  }
  num(): number {
    this.skip();
    NUM.lastIndex = this.i;
    const m = NUM.exec(this.s);
    if (!m) throw new Error('Bad number in path data');
    this.i = NUM.lastIndex;
    return parseFloat(m[0]);
  }
  /** Arc flags are single 0/1 characters and may run into the next number ("a1 1 0 011 1"). */
  flag(): number {
    this.skip();
    const ch = this.s[this.i];
    if (ch !== '0' && ch !== '1') throw new Error('Bad arc flag in path data');
    this.i++;
    return ch === '1' ? 1 : 0;
  }
}

/** Converts an SVG arc to cubic Bezier segments. Returns [c1, c2, end] triples. */
export function arcToCubics(p0: Pt, rx: number, ry: number, rotDeg: number, large: number, sweep: number, p1: Pt): Array<[Pt, Pt, Pt]> {
  if ((p0.x === p1.x && p0.y === p1.y) || (rx === 0 && ry === 0)) return rx === 0 || ry === 0 ? [[p0, p1, p1]] : [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (p0.x + p1.x) / 2, cy = sp * cxp + cp * cyp + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const out: Array<[Pt, Pt, Pt]> = [];
  const point = (a: number): Pt => ({ x: cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, y: cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp });
  const deriv = (a: number): Pt => ({ x: -rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, y: -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp });
  for (let k = 0; k < n; k++) {
    const a0 = th1 + k * step, a1 = a0 + step;
    const s = point(a0), e = point(a1), d0 = deriv(a0), d1 = deriv(a1);
    out.push([{ x: s.x + t * d0.x, y: s.y + t * d0.y }, { x: e.x - t * d1.x, y: e.y - t * d1.y }, k === n - 1 ? p1 : e]);
  }
  return out;
}

const close = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

/** Path data to contours in the path's own coordinates. Every subpath is treated as closed (as a fill is). */
export function parsePathData(d: string): Contour[] {
  const r = new Reader(d);
  const contours: Contour[] = [];
  let nodes: PathNode[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = cur;
  let lastCtl = null as Pt | null;
  let lastQ = null as Pt | null;
  let cmd = '';
  const flush = () => {
    if (nodes.length >= 2) {
      if (nodes.length > 2 && close(nodes[0]!.p, nodes[nodes.length - 1]!.p)) {
        const last = nodes.pop()!;
        if (last.hIn) nodes[0]!.hIn = last.hIn;
      }
      for (const n of nodes) n.kind = n.hIn && n.hOut ? 'smooth' : 'corner';
      if (nodes.length >= 3) contours.push({ nodes, closed: true });
    }
    nodes = [];
  };
  const lineTo = (p: Pt) => { nodes.push({ p, kind: 'corner' }); cur = p; };
  const cubicTo = (c1: Pt, c2: Pt, p: Pt) => {
    const prev = nodes[nodes.length - 1]!;
    prev.hOut = c1;
    nodes.push({ p, hIn: c2, kind: 'corner' });
    cur = p; lastCtl = c2;
  };
  while (true) {
    const c = r.takeCmd();
    if (c) cmd = c;
    else if (!cmd || !r.hasNumber()) break;
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const X = (v: number) => (rel ? cur.x + v : v);
    const Y = (v: number) => (rel ? cur.y + v : v);
    const up = cmd.toUpperCase();
    if (!c && up === 'Z') break;
    const prevCtl: Pt | null = lastCtl, prevQ: Pt | null = lastQ;
    lastCtl = null; lastQ = null;
    switch (up) {
      case 'M': { flush(); const p = { x: X(r.num()), y: Y(r.num()) }; start = p; cur = p; nodes = [{ p, kind: 'corner' }]; break; }
      case 'L': lineTo({ x: X(r.num()), y: Y(r.num()) }); break;
      case 'H': lineTo({ x: rel ? cur.x + r.num() : r.num(), y: cur.y }); break;
      case 'V': lineTo({ x: cur.x, y: rel ? cur.y + r.num() : r.num() }); break;
      case 'C': { const c1 = { x: X(r.num()), y: Y(r.num()) }, c2 = { x: X(r.num()), y: Y(r.num()) }, p = { x: X(r.num()), y: Y(r.num()) }; cubicTo(c1, c2, p); break; }
      case 'S': {
        const c1 = prevCtl ? { x: 2 * cur.x - prevCtl.x, y: 2 * cur.y - prevCtl.y } : cur;
        const c2 = { x: X(r.num()), y: Y(r.num()) }, p = { x: X(r.num()), y: Y(r.num()) };
        cubicTo(c1, c2, p);
        break;
      }
      case 'Q': case 'T': {
        const q = up === 'T' ? (prevQ ? { x: 2 * cur.x - prevQ.x, y: 2 * cur.y - prevQ.y } : cur) : { x: X(r.num()), y: Y(r.num()) };
        const p = { x: X(r.num()), y: Y(r.num()) };
        const p0 = cur;
        cubicTo({ x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
        lastCtl = null; lastQ = q;
        break;
      }
      case 'A': {
        const rx = r.num(), ry = r.num(), rot = r.num(), large = r.flag(), sweep = r.flag();
        const p = { x: X(r.num()), y: Y(r.num()) };
        const segs = arcToCubics(cur, rx, ry, rot, large, sweep, p);
        if (!segs.length) break;
        for (const [c1, c2, e] of segs) cubicTo(c1, c2, e);
        lastCtl = null;
        break;
      }
      case 'Z': {
        if (nodes.length) { const first = nodes[0]!.p; if (!close(cur, first)) lineTo({ ...first }); }
        flush();
        cur = start;
        break;
      }
      default: throw new Error(`Unsupported path command "${cmd}"`);
    }
  }
  flush();
  return contours;
}

const KAPPA = 0.5522847498;
const ellipse = (cx: number, cy: number, rx: number, ry: number): Contour => {
  const k = KAPPA;
  const n = (x: number, y: number, hi: Pt, ho: Pt): PathNode => ({ p: { x, y }, hIn: hi, hOut: ho, kind: 'smooth' });
  return {
    closed: true,
    nodes: [
      n(cx + rx, cy, { x: cx + rx, y: cy - k * ry }, { x: cx + rx, y: cy + k * ry }),
      n(cx, cy + ry, { x: cx + k * rx, y: cy + ry }, { x: cx - k * rx, y: cy + ry }),
      n(cx - rx, cy, { x: cx - rx, y: cy + k * ry }, { x: cx - rx, y: cy - k * ry }),
      n(cx, cy - ry, { x: cx - k * rx, y: cy - ry }, { x: cx + k * rx, y: cy - ry }),
    ],
  };
};
const polygon = (pts: Pt[]): Contour => ({ closed: true, nodes: pts.map((p) => ({ p, kind: 'corner' as const })) });
const attr = (tag: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)?.[1] ?? new RegExp(`(?:^|\\s)${name}\\s*=\\s*'([^']*)'`).exec(tag)?.[1];
const numAttr = (tag: string, name: string, d = 0) => {
  const v = parseFloat(attr(tag, name) ?? '');
  return Number.isFinite(v) ? v : d;
};

function transformContour(c: Contour, m: Mat): Contour {
  return {
    ...c,
    nodes: c.nodes.map((n) => ({ ...n, p: apply(m, n.p), ...(n.hIn ? { hIn: apply(m, n.hIn) } : {}), ...(n.hOut ? { hOut: apply(m, n.hOut) } : {}) })),
  };
}

export type SvgShapes = { contours: Contour[] };

/** Reads every fillable shape of an SVG document, with group transforms applied. Throws if there are none. */
export function parseSvg(text: string): SvgShapes {
  const stack: Mat[] = [I];
  const contours: Contour[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let sawSvg = false;
  for (let m = tagRe.exec(text); m; m = tagRe.exec(text)) {
    const [, closing, nameRaw, body = '', selfClose] = m;
    const name = nameRaw!.toLowerCase();
    if (closing) {
      if ((name === 'g' || name === 'svg') && stack.length > 1) stack.pop();
      continue;
    }
    if (name === 'svg') sawSvg = true;
    const own = parseTransform(attr(body, 'transform'));
    const cur = mul(stack[stack.length - 1]!, own);
    if (name === 'g' || name === 'svg') {
      if (!selfClose) stack.push(cur);
      continue;
    }
    // an unfilled outline is not artwork for a font
    if (/fill\s*[=:]\s*["']?none/.test(body)) continue;
    let found: Contour[] = [];
    if (name === 'path') found = parsePathData(attr(body, 'd') ?? '');
    else if (name === 'rect') {
      const x = numAttr(body, 'x'), y = numAttr(body, 'y'), w = numAttr(body, 'width'), h = numAttr(body, 'height');
      if (w > 0 && h > 0) found = [polygon([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }])];
    } else if (name === 'circle') {
      const r = numAttr(body, 'r');
      if (r > 0) found = [ellipse(numAttr(body, 'cx'), numAttr(body, 'cy'), r, r)];
    } else if (name === 'ellipse') {
      const rx = numAttr(body, 'rx'), ry = numAttr(body, 'ry');
      if (rx > 0 && ry > 0) found = [ellipse(numAttr(body, 'cx'), numAttr(body, 'cy'), rx, ry)];
    } else if (name === 'polygon' || name === 'polyline') {
      const v = (attr(body, 'points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i]!, y: v[i + 1]! });
      if (pts.length >= 3) found = [polygon(pts)];
    }
    for (const c of found) contours.push(transformContour(c, cur));
  }
  if (!sawSvg) throw new Error('This file is not an SVG image.');
  if (!contours.length) throw new Error('No filled shapes were found in this SVG.');
  return { contours };
}

export type Box = { advance: number; ascender: number; descender: number };

/**
 * Fits SVG artwork (y down) into the glyph box, centred, keeping its proportions, and re-winds it for fonts
 * (y up, outer clockwise, holes counter-clockwise). `fill` is the share of the box the artwork may use.
 */
export function placeSvgArtwork(contours: readonly Contour[], box: Box, fill = 0.8): Contour[] {
  const pts = contours.flatMap((c) => flattenContour(c, 0.3));
  if (!pts.length) return [];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
  const range = box.ascender - box.descender;
  const s = Math.min((box.advance * fill) / w, (range * fill) / h);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const tx = box.advance / 2, ty = (box.ascender + box.descender) / 2;
  const map = (p: Pt): Pt => ({ x: tx + (p.x - cx) * s, y: ty - (p.y - cy) * s });
  const placed = contours.map((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, p: map(n.p), ...(n.hIn ? { hIn: map(n.hIn) } : {}), ...(n.hOut ? { hOut: map(n.hOut) } : {}) })) }));
  return normalizeWinding(placed, 1);
}
