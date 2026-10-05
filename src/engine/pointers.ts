// Turns raw pointer events into drawing and gesture actions. Pure and deterministic so every
// rule (palm rejection, multi-touch, taps) is unit tested without a browser.

export type PointerKind = 'mouse' | 'touch' | 'pen';
export type PtrEvent = { type: 'down' | 'move' | 'up' | 'cancel'; id: number; kind: PointerKind; x: number; y: number; t: number; pressure?: number };

export type Action =
  | { type: 'draw-start'; id: number; kind: PointerKind; x: number; y: number; t: number; pressure: number }
  | { type: 'draw-move'; id: number; x: number; y: number; t: number; pressure: number }
  | { type: 'draw-end'; id: number; x: number; y: number; t: number; pressure: number }
  | { type: 'draw-cancel' }
  | { type: 'pan-zoom'; scale: number; dx: number; dy: number; cx: number; cy: number }
  | { type: 'undo' }
  | { type: 'redo' };

const pr = (e: PtrEvent): number => (typeof e.pressure === 'number' && e.pressure > 0 ? e.pressure : 0.5);

export const PALM_MS = 500;
export const TAP_MAX_MS = 300;
export const TAP_MOVE_PX = 10;

type Touch = { x: number; y: number; sx: number; sy: number };

export class PointerRouter {
  private touches = new Map<number, Touch>();
  private ignored = new Set<number>();
  private drawingId: number | null = null;
  private penActive = false;
  private penUpAt = -Infinity;
  private gestureIds: [number, number] | null = null;
  private lastDist = 0;
  private lastCx = 0;
  private lastCy = 0;
  /** After a multi-touch gesture no remaining finger may start drawing until all are lifted. */
  private suppressDraw = false;
  private tap = { startT: 0, maxCount: 0, moved: false };

  /** True while a drawing pointer is down (the editor uses it to decide what to render live). */
  get drawing(): boolean {
    return this.drawingId !== null;
  }

  handle(e: PtrEvent): Action[] {
    switch (e.type) {
      case 'down':
        return this.down(e);
      case 'move':
        return this.move(e);
      default:
        return this.up(e);
    }
  }

  private cancelDraw(out: Action[]): void {
    if (this.drawingId !== null) {
      this.drawingId = null;
      out.push({ type: 'draw-cancel' });
    }
  }

  private down(e: PtrEvent): Action[] {
    const out: Action[] = [];
    if (e.kind === 'pen') {
      // A pen always wins: drop any touch drawing or gesture in progress.
      this.penActive = true;
      this.cancelDraw(out);
      this.gestureIds = null;
      this.drawingId = e.id;
      out.push({ type: 'draw-start', id: e.id, kind: 'pen', x: e.x, y: e.y, t: e.t, pressure: pr(e) });
      return out;
    }
    if (e.kind === 'mouse') {
      if (this.drawingId === null) {
        this.drawingId = e.id;
        out.push({ type: 'draw-start', id: e.id, kind: 'mouse', x: e.x, y: e.y, t: e.t, pressure: pr(e) });
      }
      return out;
    }
    // Touch. Palm rejection: ignore touches while a pen is down or was just lifted.
    if (this.penActive || e.t - this.penUpAt < PALM_MS) {
      this.ignored.add(e.id);
      return out;
    }
    if (this.touches.size === 0) this.tap = { startT: e.t, maxCount: 0, moved: false };
    this.touches.set(e.id, { x: e.x, y: e.y, sx: e.x, sy: e.y });
    this.tap.maxCount = Math.max(this.tap.maxCount, this.touches.size);

    if (this.touches.size === 1) {
      if (!this.suppressDraw && this.drawingId === null) {
        this.drawingId = e.id;
        out.push({ type: 'draw-start', id: e.id, kind: 'touch', x: e.x, y: e.y, t: e.t, pressure: pr(e) });
      }
    } else {
      // Second (or third) finger: never leave a stray dot from the first one.
      this.cancelDraw(out);
      this.suppressDraw = true;
      if (this.touches.size === 2) this.beginGesture();
      else this.gestureIds = null; // three or more fingers are a tap gesture only
    }
    return out;
  }

  private beginGesture(): void {
    const ids = [...this.touches.keys()];
    this.gestureIds = [ids[0]!, ids[1]!];
    const a = this.touches.get(ids[0]!)!;
    const b = this.touches.get(ids[1]!)!;
    this.lastDist = Math.hypot(b.x - a.x, b.y - a.y);
    this.lastCx = (a.x + b.x) / 2;
    this.lastCy = (a.y + b.y) / 2;
  }

  private move(e: PtrEvent): Action[] {
    const out: Action[] = [];
    if (this.ignored.has(e.id)) return out;
    if (e.kind !== 'touch') {
      if (this.drawingId === e.id) out.push({ type: 'draw-move', id: e.id, x: e.x, y: e.y, t: e.t, pressure: pr(e) });
      return out;
    }
    const tc = this.touches.get(e.id);
    if (!tc) return out;
    tc.x = e.x;
    tc.y = e.y;
    if (Math.hypot(e.x - tc.sx, e.y - tc.sy) > TAP_MOVE_PX) this.tap.moved = true;

    if (this.drawingId === e.id) {
      out.push({ type: 'draw-move', id: e.id, x: e.x, y: e.y, t: e.t, pressure: pr(e) });
      return out;
    }
    if (this.gestureIds && this.gestureIds.includes(e.id)) {
      const a = this.touches.get(this.gestureIds[0])!;
      const b = this.touches.get(this.gestureIds[1])!;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (this.lastDist > 0 && dist > 0 && this.tap.moved) {
        out.push({ type: 'pan-zoom', scale: dist / this.lastDist, dx: cx - this.lastCx, dy: cy - this.lastCy, cx, cy });
      }
      this.lastDist = dist;
      this.lastCx = cx;
      this.lastCy = cy;
    }
    return out;
  }

  private up(e: PtrEvent): Action[] {
    const out: Action[] = [];
    if (this.ignored.delete(e.id)) return out;
    const cancelled = e.type === 'cancel';

    if (e.kind === 'pen') {
      this.penActive = false;
      this.penUpAt = e.t;
    }
    if (this.drawingId === e.id) {
      this.drawingId = null;
      out.push(cancelled ? { type: 'draw-cancel' } : { type: 'draw-end', id: e.id, x: e.x, y: e.y, t: e.t, pressure: pr(e) });
    }
    if (e.kind !== 'touch') return out;

    this.touches.delete(e.id);
    if (this.gestureIds && this.gestureIds.includes(e.id)) this.gestureIds = null;
    if (this.touches.size === 0) {
      const quick = e.t - this.tap.startT < TAP_MAX_MS;
      if (!cancelled && quick && !this.tap.moved) {
        if (this.tap.maxCount === 2) out.push({ type: 'undo' });
        else if (this.tap.maxCount === 3) out.push({ type: 'redo' });
      }
      this.suppressDraw = false;
      this.gestureIds = null;
      this.tap = { startT: 0, maxCount: 0, moved: false };
    }
    return out;
  }
}
