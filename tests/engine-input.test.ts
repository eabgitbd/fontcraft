import { describe, expect, it } from 'vitest';
import { PointerRouter, PALM_MS, type Action, type PtrEvent } from '@/engine/pointers';
import { Viewport } from '@/engine/viewport';
import { AddPath, AddStroke, ClearAll, DeleteObject, EMPTY_STATE, EraseStroke, History, MoveNode, type EditState } from '@/engine/history';
import { OneEuro, Stabilizer } from '@/engine/stabilizer';
import { PenTool } from '@/engine/pen';
import { snapToGuides } from '@/engine/snap';
import type { PenPath, Stroke } from '@/storage/types';

const ev = (type: PtrEvent['type'], id: number, kind: PtrEvent['kind'], x: number, y: number, t: number): PtrEvent => ({ type, id, kind, x, y, t });
const run = (r: PointerRouter, events: PtrEvent[]): Action[] => events.flatMap((e) => r.handle(e));
const types = (a: Action[]) => a.map((x) => x.type);

describe('PointerRouter: mouse and pen', () => {
  it('a mouse drag is draw-start, draw-move, draw-end', () => {
    const r = new PointerRouter();
    const a = run(r, [ev('down', 1, 'mouse', 5, 5, 0), ev('move', 1, 'mouse', 9, 9, 10), ev('up', 1, 'mouse', 9, 9, 20)]);
    expect(types(a)).toEqual(['draw-start', 'draw-move', 'draw-end']);
  });
  it('moves of a pointer that is not drawing are ignored', () => {
    const r = new PointerRouter();
    expect(run(r, [ev('move', 1, 'mouse', 1, 1, 0)])).toEqual([]);
  });
  it('a cancelled pointer discards the stroke instead of committing it', () => {
    const r = new PointerRouter();
    expect(types(run(r, [ev('down', 1, 'pen', 0, 0, 0), ev('cancel', 1, 'pen', 0, 0, 5)]))).toEqual(['draw-start', 'draw-cancel']);
  });
});

describe('PointerRouter: touch and gestures', () => {
  it('one finger draws', () => {
    const r = new PointerRouter();
    expect(types(run(r, [ev('down', 1, 'touch', 10, 10, 0), ev('move', 1, 'touch', 30, 30, 20), ev('up', 1, 'touch', 30, 30, 40)]))).toEqual(['draw-start', 'draw-move', 'draw-end']);
  });

  it('a second finger cancels the first finger\'s stroke (no stray dot) and starts a gesture', () => {
    const r = new PointerRouter();
    const a = run(r, [ev('down', 1, 'touch', 100, 100, 0), ev('down', 2, 'touch', 200, 100, 30)]);
    expect(types(a)).toEqual(['draw-start', 'draw-cancel']);
    expect(r.drawing).toBe(false);
  });

  it('pinching outward zooms in about the midpoint; spreading emits scale above 1', () => {
    const r = new PointerRouter();
    run(r, [ev('down', 1, 'touch', 100, 100, 0), ev('down', 2, 'touch', 200, 100, 10)]);
    const a = run(r, [ev('move', 2, 'touch', 260, 100, 40), ev('move', 2, 'touch', 320, 100, 60)]);
    const pz = a.filter((x): x is Extract<Action, { type: 'pan-zoom' }> => x.type === 'pan-zoom');
    expect(pz.length).toBeGreaterThan(0);
    const total = pz.reduce((s, x) => s * x.scale, 1);
    expect(total).toBeCloseTo(220 / 100, 5);
  });

  it('two fingers moving together pan without changing scale', () => {
    const r = new PointerRouter();
    run(r, [ev('down', 1, 'touch', 100, 100, 0), ev('down', 2, 'touch', 200, 100, 10)]);
    const a = run(r, [ev('move', 1, 'touch', 100, 160, 40), ev('move', 2, 'touch', 200, 160, 41)]);
    const pz = a.filter((x): x is Extract<Action, { type: 'pan-zoom' }> => x.type === 'pan-zoom');
    expect(pz.reduce((s, x) => s + x.dy, 0)).toBeCloseTo(60, 5);
    expect(pz.reduce((s, x) => s * x.scale, 1)).toBeCloseTo(1, 5);
  });

  it('a lingering finger after a gesture never starts drawing', () => {
    const r = new PointerRouter();
    run(r, [ev('down', 1, 'touch', 100, 100, 0), ev('down', 2, 'touch', 200, 100, 10), ev('move', 2, 'touch', 300, 100, 40), ev('up', 2, 'touch', 300, 100, 60)]);
    const a = run(r, [ev('move', 1, 'touch', 120, 100, 80), ev('up', 1, 'touch', 120, 100, 100)]);
    expect(types(a)).toEqual([]);
    // After everything is lifted drawing works again.
    expect(types(run(r, [ev('down', 3, 'touch', 5, 5, 600)]))).toEqual(['draw-start']);
  });

  it('a quick two-finger tap is undo and leaves no ink', () => {
    const r = new PointerRouter();
    const a = run(r, [ev('down', 1, 'touch', 100, 100, 0), ev('down', 2, 'touch', 160, 100, 20), ev('up', 1, 'touch', 100, 100, 90), ev('up', 2, 'touch', 160, 100, 100)]);
    expect(types(a)).toEqual(['draw-start', 'draw-cancel', 'undo']);
  });

  it('a quick three-finger tap is redo', () => {
    const r = new PointerRouter();
    const a = run(r, [
      ev('down', 1, 'touch', 100, 100, 0), ev('down', 2, 'touch', 160, 100, 10), ev('down', 3, 'touch', 220, 100, 20),
      ev('up', 1, 'touch', 100, 100, 80), ev('up', 2, 'touch', 160, 100, 85), ev('up', 3, 'touch', 220, 100, 90),
    ]);
    expect(types(a)).toEqual(['draw-start', 'draw-cancel', 'redo']);
  });

  it('a slow or moving two-finger touch is not a tap', () => {
    const slow = new PointerRouter();
    expect(types(run(slow, [ev('down', 1, 'touch', 0, 0, 0), ev('down', 2, 'touch', 50, 0, 10), ev('up', 1, 'touch', 0, 0, 500), ev('up', 2, 'touch', 50, 0, 510)]))).not.toContain('undo');
    const moved = new PointerRouter();
    expect(types(run(moved, [ev('down', 1, 'touch', 0, 0, 0), ev('down', 2, 'touch', 50, 0, 10), ev('move', 2, 'touch', 120, 0, 40), ev('up', 1, 'touch', 0, 0, 80), ev('up', 2, 'touch', 120, 0, 90)]))).not.toContain('undo');
  });

  it('a single quick tap just draws a dot (no undo)', () => {
    const r = new PointerRouter();
    expect(types(run(r, [ev('down', 1, 'touch', 5, 5, 0), ev('up', 1, 'touch', 5, 5, 60)]))).toEqual(['draw-start', 'draw-end']);
  });
});

describe('PointerRouter: palm rejection', () => {
  it('ignores touches while the pen is down', () => {
    const r = new PointerRouter();
    run(r, [ev('down', 1, 'pen', 0, 0, 0)]);
    expect(run(r, [ev('down', 2, 'touch', 50, 50, 10), ev('move', 2, 'touch', 60, 60, 20), ev('up', 2, 'touch', 60, 60, 30)])).toEqual([]);
  });
  it('keeps ignoring touches for 500 ms after the pen lifts, then allows them', () => {
    const r = new PointerRouter();
    run(r, [ev('down', 1, 'pen', 0, 0, 0), ev('up', 1, 'pen', 0, 0, 1000)]);
    expect(run(r, [ev('down', 2, 'touch', 5, 5, 1000 + PALM_MS - 1)])).toEqual([]);
    run(r, [ev('up', 2, 'touch', 5, 5, 1000 + PALM_MS)]);
    expect(types(run(r, [ev('down', 3, 'touch', 5, 5, 1000 + PALM_MS + 1)]))).toEqual(['draw-start']);
  });
  it('a pen landing while a finger is drawing cancels the finger stroke', () => {
    const r = new PointerRouter();
    const a = run(r, [ev('down', 1, 'touch', 10, 10, 0), ev('down', 2, 'pen', 50, 50, 20)]);
    expect(types(a)).toEqual(['draw-start', 'draw-cancel', 'draw-start']);
  });
  it('an ignored palm cannot trigger undo or a gesture', () => {
    const r = new PointerRouter();
    run(r, [ev('down', 1, 'pen', 0, 0, 0)]);
    const a = run(r, [ev('down', 2, 'touch', 10, 10, 5), ev('down', 3, 'touch', 30, 10, 6), ev('up', 2, 'touch', 10, 10, 50), ev('up', 3, 'touch', 30, 10, 55)]);
    expect(a).toEqual([]);
  });
});

describe('Viewport', () => {
  it('maps font units to screen and back, y-up to y-down', () => {
    const v = new Viewport();
    v.k = 2; v.tx = 10; v.ty = 500;
    expect(v.toScreen(100, 100)).toEqual([210, 300]);
    expect(v.toWorld(210, 300)).toEqual([100, 100]);
  });
  it('zoomAt keeps the point under the cursor fixed', () => {
    const v = new Viewport();
    v.fit(600, 400, { minX: 0, minY: -200, maxX: 600, maxY: 800 });
    const [wx, wy] = v.toWorld(123, 77);
    v.zoomAt(123, 77, 3);
    const [sx, sy] = v.toScreen(wx, wy);
    expect(sx).toBeCloseTo(123, 6);
    expect(sy).toBeCloseTo(77, 6);
  });
  it('clamps the zoom range and ignores bad factors', () => {
    const v = new Viewport();
    v.zoomAt(0, 0, 1e9);
    expect(v.k).toBeLessThanOrEqual(24);
    v.zoomAt(0, 0, 1e-9);
    expect(v.k).toBeGreaterThanOrEqual(0.02);
    const before = v.state;
    v.zoomAt(0, 0, NaN);
    v.zoomAt(0, 0, -2);
    expect(v.state).toEqual(before);
  });
  it('fit centres the box and keeps it inside the canvas', () => {
    const v = new Viewport();
    v.fit(800, 500, { minX: -100, minY: -300, maxX: 700, maxY: 900 }, 10);
    const [x1, y1] = v.toScreen(-100, 900);
    const [x2, y2] = v.toScreen(700, -300);
    expect(x1).toBeGreaterThanOrEqual(9.99);
    expect(y1).toBeGreaterThanOrEqual(9.99);
    expect(x2).toBeLessThanOrEqual(790.01);
    expect(y2).toBeLessThanOrEqual(490.01);
    expect((x1 + x2) / 2).toBeCloseTo(400, 5);
    expect((y1 + y2) / 2).toBeCloseTo(250, 5);
  });
  it('gesture applies scale about the centre then pans', () => {
    const v = new Viewport();
    v.k = 1;
    v.gesture(100, 100, 2, 5, -7);
    expect(v.k).toBe(2);
    expect(v.toScreen(...v.toWorld(100, 100))).toEqual([100, 100]);
    expect(v.tx).toBe(-100 + 5);
  });
  it('state can be saved and restored', () => {
    const v = new Viewport();
    v.zoomAt(50, 50, 2.5);
    v.panBy(11, 22);
    const s = v.state;
    const w = new Viewport();
    w.set(s);
    expect(w.toScreen(10, 10)).toEqual(v.toScreen(10, 10));
  });
});

describe('History (command pattern)', () => {
  const s1: Stroke = { pts: [{ x: 0, y: 0, pressure: 0.5 }], size: 10 };
  const s2: Stroke = { pts: [{ x: 5, y: 5, pressure: 0.5 }], size: 10 };
  const path: PenPath = { closed: false, size: 8, nodes: [{ p: { x: 0, y: 0 }, kind: 'corner' }, { p: { x: 10, y: 0 }, kind: 'corner' }] };

  it('undo and redo walk the commands in order', () => {
    const h = new History();
    let s: EditState = EMPTY_STATE;
    s = h.run(new AddStroke(s1), s);
    s = h.run(new AddStroke(s2), s);
    expect(s.strokes).toEqual([s1, s2]);
    s = h.undo(s)!;
    expect(s.strokes).toEqual([s1]);
    s = h.undo(s)!;
    expect(s.strokes).toEqual([]);
    expect(h.undo(s)).toBeNull();
    s = h.redo(s)!;
    s = h.redo(s)!;
    expect(s.strokes).toEqual([s1, s2]);
    expect(h.redo(s)).toBeNull();
  });
  it('a new command clears the redo stack', () => {
    const h = new History();
    let s = h.run(new AddStroke(s1), EMPTY_STATE);
    s = h.undo(s)!;
    expect(h.canRedo).toBe(true);
    s = h.run(new AddStroke(s2), s);
    expect(h.canRedo).toBe(false);
  });
  it('caps the history at 200 commands and drops the oldest', () => {
    const h = new History();
    let s: EditState = EMPTY_STATE;
    for (let i = 0; i < 250; i++) s = h.run(new AddStroke({ ...s1, size: i }), s);
    expect(h.size).toBe(200);
    for (let i = 0; i < 200; i++) s = h.undo(s)!;
    expect(h.undo(s)).toBeNull();
    expect(s.strokes).toHaveLength(50); // the 50 oldest could no longer be undone
  });
  it('Clear is undoable and restores strokes and paths', () => {
    const h = new History();
    let s: EditState = h.run(new AddPath(path), h.run(new AddStroke(s1), EMPTY_STATE));
    s = h.run(new ClearAll(s), s);
    expect(s).toEqual(EMPTY_STATE);
    s = h.undo(s)!;
    expect(s.strokes).toEqual([s1]);
    expect(s.paths).toEqual([path]);
  });
  it('DeleteObject puts the object back at its original index', () => {
    const h = new History();
    let s: EditState = EMPTY_STATE;
    for (const x of [s1, s2, { ...s1, size: 99 }]) s = h.run(new AddStroke(x), s);
    s = h.run(new DeleteObject('stroke', 1, s2), s);
    expect(s.strokes.map((x) => x.size)).toEqual([10, 99]);
    s = h.undo(s)!;
    expect(s.strokes[1]).toBe(s2);
  });
  it('MoveNode applies and reverts exactly', () => {
    const h = new History();
    let s: EditState = h.run(new AddPath(path), EMPTY_STATE);
    const before = path.nodes[1]!;
    const after = { ...before, p: { x: 50, y: 20 } };
    s = h.run(new MoveNode(0, 1, before, after), s);
    expect(s.paths[0]!.nodes[1]!.p).toEqual({ x: 50, y: 20 });
    s = h.undo(s)!;
    expect(s.paths[0]!.nodes[1]).toEqual(before);
  });
  it('EraseStroke records an eraser stroke and is labelled as such', () => {
    const c = new EraseStroke(s1);
    expect(c.label).toBe('EraseStroke');
    expect(c.apply(EMPTY_STATE).strokes[0]!.erase).toBe(true);
  });
  it('never mutates the previous state', () => {
    const h = new History();
    const s0 = h.run(new AddStroke(s1), EMPTY_STATE);
    const snapshot = JSON.stringify(s0);
    h.run(new AddStroke(s2), s0);
    h.undo(s0);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

describe('Stabilizer', () => {
  const noisyLine = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 4, y: 100 + (i % 2 ? 6 : -6), t: i * 8 }));
  const spread = (ys: number[]) => Math.max(...ys) - Math.min(...ys);

  it('amount 0 is a pass-through', () => {
    const s = new Stabilizer(0);
    expect(s.push(12.5, 7.25, 0)).toEqual({ x: 12.5, y: 7.25 });
    expect(s.push(99, -3, 10)).toEqual({ x: 99, y: -3 });
  });
  it('smoothing reduces jitter, and more smoothing reduces it more', () => {
    const run = (amount: number) => {
      const st = new Stabilizer(amount);
      return noisyLine(60).map((p) => st.push(p.x, p.y, p.t).y).slice(10);
    };
    const raw = spread(noisyLine(60).map((p) => p.y));
    expect(spread(run(40))).toBeLessThan(raw);
    expect(spread(run(90))).toBeLessThan(spread(run(40)));
  });
  it('follows a real movement without wandering off', () => {
    const st = new Stabilizer(60);
    let last = { x: 0, y: 0 };
    for (let i = 0; i < 80; i++) last = st.push(i * 5, i * 5, i * 8);
    expect(Math.abs(last.x - 79 * 5)).toBeLessThan(60);
    expect(last.x).toBeGreaterThan(79 * 5 * 0.7);
  });
  it('reset forgets the previous stroke', () => {
    const st = new Stabilizer(80);
    st.push(0, 0, 0);
    st.push(500, 500, 8);
    st.reset();
    expect(st.push(10, 10, 100)).toEqual({ x: 10, y: 10 });
  });
  it('OneEuro survives zero and negative time steps', () => {
    const f = new OneEuro(1, 0.01);
    expect(Number.isFinite(f.filter(1, 100))).toBe(true);
    expect(Number.isFinite(f.filter(2, 100))).toBe(true);
    expect(Number.isFinite(f.filter(3, 50))).toBe(true);
  });
});

describe('PenTool', () => {
  const R = 10;
  it('tap adds corner nodes; drag while adding pulls symmetric smooth handles', () => {
    const pen = new PenTool();
    pen.down({ x: 0, y: 0 }, R); pen.up();
    pen.down({ x: 100, y: 0 }, R); pen.move({ x: 140, y: 30 }, 3); pen.up();
    expect(pen.nodes[0]).toMatchObject({ kind: 'corner' });
    expect(pen.nodes[0]!.hOut).toBeUndefined();
    const n = pen.nodes[1]!;
    expect(n.kind).toBe('smooth');
    expect(n.hOut).toEqual({ x: 140, y: 30 });
    expect(n.hIn).toEqual({ x: 60, y: -30 });
  });
  it('a tiny jitter while tapping does not create handles', () => {
    const pen = new PenTool();
    pen.down({ x: 50, y: 50 }, R); pen.move({ x: 51, y: 50 }, 5); pen.up();
    expect(pen.nodes[0]).toMatchObject({ kind: 'corner' });
    expect(pen.nodes[0]!.hOut).toBeUndefined();
  });
  it('tapping an existing node toggles smooth and corner', () => {
    const pen = new PenTool();
    pen.down({ x: 0, y: 0 }, R); pen.up();
    pen.down({ x: 100, y: 0 }, R); pen.up();
    pen.down({ x: 200, y: 0 }, R); pen.up();
    pen.down({ x: 100, y: 0 }, R); pen.up(); // tap the middle node
    expect(pen.nodes).toHaveLength(3);
    expect(pen.nodes[1]!.kind).toBe('smooth');
    expect(pen.nodes[1]!.hOut).toBeDefined();
    expect(pen.nodes[1]!.hOut!.y).toBeCloseTo(0, 6); // tangent follows neighbours
    pen.down({ x: 100, y: 0 }, R); pen.up();
    expect(pen.nodes[1]!.kind).toBe('corner');
    expect(pen.nodes[1]!.hOut).toBeUndefined();
  });
  it('dragging a node moves it together with its handles', () => {
    const pen = new PenTool();
    pen.down({ x: 100, y: 100 }, R); pen.move({ x: 140, y: 100 }, 3); pen.up();
    pen.down({ x: 100, y: 100 }, R); pen.move({ x: 100, y: 160 }, 3); pen.up();
    expect(pen.nodes).toHaveLength(1);
    expect(pen.nodes[0]!.p).toEqual({ x: 100, y: 160 });
    expect(pen.nodes[0]!.hOut).toEqual({ x: 140, y: 160 });
  });
  it('dragging a handle of a smooth node mirrors the opposite handle', () => {
    const pen = new PenTool();
    pen.down({ x: 100, y: 100 }, R); pen.move({ x: 140, y: 100 }, 3); pen.up();
    pen.down({ x: 140, y: 100 }, R); pen.move({ x: 100, y: 180 }, 3); pen.up();
    expect(pen.nodes[0]!.hOut).toEqual({ x: 100, y: 180 });
    expect(pen.nodes[0]!.hIn).toEqual({ x: 100, y: 20 });
  });
  it('a corner node keeps its handles independent', () => {
    const pen = new PenTool();
    pen.nodes = [{ p: { x: 100, y: 100 }, hIn: { x: 80, y: 100 }, hOut: { x: 120, y: 100 }, kind: 'corner' }];
    pen.down({ x: 120, y: 100 }, R); pen.move({ x: 150, y: 140 }, 3); pen.up();
    expect(pen.nodes[0]!.hOut).toEqual({ x: 150, y: 140 });
    expect(pen.nodes[0]!.hIn).toEqual({ x: 80, y: 100 });
  });
  it('closing needs at least 3 nodes (as v3); a closed path accepts no more nodes', () => {
    const pen = new PenTool();
    pen.down({ x: 0, y: 0 }, R); pen.up();
    pen.down({ x: 100, y: 0 }, R); pen.up();
    expect(pen.close()).toBe(false);
    pen.down({ x: 100, y: 100 }, R); pen.up();
    expect(pen.close()).toBe(true);
    pen.down({ x: 500, y: 500 }, R); pen.up();
    expect(pen.nodes).toHaveLength(3);
    expect(pen.close()).toBe(false);
  });
  it('commit needs at least 2 nodes, returns a deep copy and resets the tool', () => {
    const pen = new PenTool();
    pen.down({ x: 0, y: 0 }, R); pen.up();
    expect(pen.commit(12)).toBeNull();
    expect(pen.nodes).toHaveLength(1); // work is kept
    pen.down({ x: 100, y: 0 }, R); pen.up();
    pen.close();
    const p = pen.commit(12)!;
    expect(p).toMatchObject({ size: 12, closed: false });
    expect(p.nodes).toHaveLength(2);
    expect(pen.active).toBe(false);
    p.nodes[0]!.p.x = 999;
    expect(pen.nodes).toHaveLength(0);
  });
  it('cancel discards everything', () => {
    const pen = new PenTool();
    pen.down({ x: 0, y: 0 }, R); pen.up();
    pen.cancel();
    expect(pen.active).toBe(false);
  });
  it('handles win over nodes when they overlap, so they stay reachable', () => {
    const pen = new PenTool();
    pen.nodes = [{ p: { x: 100, y: 100 }, hOut: { x: 104, y: 100 }, kind: 'smooth', hIn: { x: 96, y: 100 } }];
    expect(pen.hit({ x: 104, y: 100 }, R)).toEqual({ kind: 'out', index: 0 });
    expect(pen.hit({ x: 100, y: 130 }, R)).toBeNull();
  });
  it('snaps new nodes to guides and reports it', () => {
    const pen = new PenTool();
    let ticks = 0;
    pen.snap = (p) => snapToGuides(p, { xs: [0], ys: [0, 500] }, 8);
    pen.onSnap = () => ticks++;
    pen.down({ x: 200, y: 497 }, R); pen.up();
    expect(pen.nodes[0]!.p).toEqual({ x: 200, y: 500 });
    expect(ticks).toBe(1);
    pen.down({ x: 300, y: 300 }, R); pen.up();
    expect(ticks).toBe(1);
  });
});

describe('snapToGuides', () => {
  it('snaps each axis independently to the nearest guide within the threshold', () => {
    const r = snapToGuides({ x: 3, y: 502 }, { xs: [0, 600], ys: [0, 500, 700] }, 8);
    expect(r).toEqual({ p: { x: 0, y: 500 }, snapped: true });
    expect(snapToGuides({ x: 50, y: 50 }, { xs: [0], ys: [0] }, 8)).toEqual({ p: { x: 50, y: 50 }, snapped: false });
    expect(snapToGuides({ x: 7, y: 300 }, { xs: [0, 10], ys: [] }, 8).p.x).toBe(10);
  });
});
