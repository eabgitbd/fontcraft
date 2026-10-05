// Bezier pen state machine (touch, pen and mouse use the same path).
// Click or tap adds a corner node; dragging while adding pulls symmetric handles;
// tapping an existing node toggles smooth and corner; handles can be dragged afterwards.
import type { PathNode, PenPath, Pt } from '@/storage/types';

type Drag =
  | { kind: 'new'; index: number; moved: boolean }
  | { kind: 'node'; index: number; moved: boolean; last: Pt }
  | { kind: 'in' | 'out'; index: number };

export type PenHit = { kind: 'node' | 'in' | 'out'; index: number } | null;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const addp = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mirror = (p: Pt, h: Pt): Pt => ({ x: 2 * p.x - h.x, y: 2 * p.y - h.y });

export class PenTool {
  nodes: PathNode[] = [];
  closed = false;
  private drag: Drag | null = null;
  /** Called when a point was snapped (the UI plays a haptic tick). */
  onSnap?: () => void;
  /** Optional snapping applied to node positions. */
  snap?: (p: Pt) => { p: Pt; snapped: boolean };

  get active(): boolean {
    return this.nodes.length > 0;
  }
  get canClose(): boolean {
    return !this.closed && this.nodes.length >= 3;
  }
  get canCommit(): boolean {
    return this.nodes.length >= 2;
  }
  get dragging(): boolean {
    return this.drag !== null;
  }

  private applySnap(p: Pt): Pt {
    if (!this.snap) return p;
    const r = this.snap(p);
    if (r.snapped) this.onSnap?.();
    return r.p;
  }

  /** What is under `p`? Handles win over nodes so they stay reachable when stacked. */
  hit(p: Pt, radius: number): PenHit {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i]!;
      if (n.hOut && dist(p, n.hOut) <= radius) return { kind: 'out', index: i };
      if (n.hIn && dist(p, n.hIn) <= radius) return { kind: 'in', index: i };
    }
    for (let i = this.nodes.length - 1; i >= 0; i--) if (dist(p, this.nodes[i]!.p) <= radius) return { kind: 'node', index: i };
    return null;
  }

  down(p: Pt, radius: number): void {
    const h = this.hit(p, radius);
    if (h) {
      this.drag = h.kind === 'node' ? { kind: 'node', index: h.index, moved: false, last: p } : { kind: h.kind, index: h.index };
      return;
    }
    if (this.closed) return; // a closed path takes no more nodes
    const q = this.applySnap(p);
    this.nodes.push({ p: q, kind: 'corner' });
    this.drag = { kind: 'new', index: this.nodes.length - 1, moved: false };
  }

  move(p: Pt, dragThreshold: number): void {
    const d = this.drag;
    if (!d) return;
    const n = this.nodes[d.index];
    if (!n) return;
    if (d.kind === 'new') {
      if (!d.moved && dist(p, n.p) < dragThreshold) return;
      d.moved = true;
      n.hOut = { ...p };
      n.hIn = mirror(n.p, p);
      n.kind = 'smooth';
    } else if (d.kind === 'node') {
      const q = this.applySnap(p);
      const delta = sub(q, n.p);
      if (!d.moved && dist(p, d.last) < dragThreshold) return;
      d.moved = true;
      n.p = q;
      if (n.hIn) n.hIn = addp(n.hIn, delta);
      if (n.hOut) n.hOut = addp(n.hOut, delta);
    } else {
      const key = d.kind === 'out' ? 'hOut' : 'hIn';
      const other = d.kind === 'out' ? 'hIn' : 'hOut';
      n[key] = { ...p };
      if (n.kind === 'smooth') n[other] = mirror(n.p, p);
    }
  }

  /** An interrupted gesture (second finger landed): drop a node that was only just placed. */
  abortDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.kind === 'new' && !d.moved && d.index === this.nodes.length - 1) this.nodes.pop();
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.kind === 'node' && !d.moved) this.toggleKind(d.index);
  }

  /** Smooth to corner removes the handles; corner to smooth derives them from the neighbours. */
  toggleKind(i: number): void {
    const n = this.nodes[i];
    if (!n) return;
    if (n.kind === 'smooth') {
      n.kind = 'corner';
      delete n.hIn;
      delete n.hOut;
      return;
    }
    const prev = this.nodes[i - 1] ?? (this.closed ? this.nodes[this.nodes.length - 1] : undefined);
    const next = this.nodes[i + 1] ?? (this.closed ? this.nodes[0] : undefined);
    const a = prev?.p ?? n.p;
    const b = next?.p ?? n.p;
    const dir = sub(b, a);
    const l = Math.hypot(dir.x, dir.y);
    if (l < 1e-9) return;
    const reach = ((prev ? dist(n.p, prev.p) : 0) + (next ? dist(n.p, next.p) : 0)) / (prev && next ? 2 : 1) / 3;
    const t = { x: (dir.x / l) * reach, y: (dir.y / l) * reach };
    n.kind = 'smooth';
    n.hOut = addp(n.p, t);
    n.hIn = sub(n.p, t);
  }

  close(): boolean {
    if (!this.canClose) return false;
    this.closed = true;
    return true;
  }

  /** Finishes the path. Returns null (and keeps the work) if there are fewer than two nodes. */
  commit(size: number): PenPath | null {
    if (!this.canCommit) return null;
    const path: PenPath = { closed: this.closed, size, nodes: this.nodes.map((n) => ({ ...n, p: { ...n.p }, ...(n.hIn ? { hIn: { ...n.hIn } } : {}), ...(n.hOut ? { hOut: { ...n.hOut } } : {}) })) };
    this.reset();
    return path;
  }

  cancel(): void {
    this.reset();
  }

  private reset(): void {
    this.nodes = [];
    this.closed = false;
    this.drag = null;
  }
}
