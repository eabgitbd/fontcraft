<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import { autoBearings, thinPoints } from '@/engine/basic';
  import { buildContours } from '@/engine/geometry/build';
  import { AddPath, AddStroke, ClearAll, DeleteObject, EraseStroke, History, MoveNode, SetTraced, type Command, type EditState } from '@/engine/history';
  import { normalizeWinding } from '@/engine/geometry/rings';
  import { createScanEngine, type ScanEngine } from '@/scan/engine';
  import { parseSvg, placeSvgArtwork } from '@/scan/svg-import';
  import { PenTool } from '@/engine/pen';
  import { PointerRouter, type Action, type PointerKind, type PtrEvent } from '@/engine/pointers';
  import { drawContourPreview, drawEraserCursor, drawGuides, drawInk, drawLiveStroke, drawNodes, drawReference, drawSelectionBox, readColors } from '@/engine/render';
  import { hitTest, type Hit } from '@/engine/select';
  import { snapToGuides } from '@/engine/snap';
  import { Stabilizer } from '@/engine/stabilizer';
  import { Viewport, type ViewState } from '@/engine/viewport';
  import { blobUrl } from '../blobUrl';
  import { deleteRef, getRef, saveRef } from '@/storage/refs';
  import { MAX_VARIANTS, emptyVariant, type Glyph, type PenPath, type Pt, type Stroke, type StrokePoint } from '@/storage/types';
  import { platform } from '@/platform';
  import { store } from '../stores/project.svelte';
  import { toast } from '../stores/toast.svelte';
  import { hrefFor } from '../router';
  import { t } from '../i18n/t.svelte';

  let { char }: { char: string | undefined } = $props();

  type Tool = 'draw' | 'pen' | 'erase' | 'select';
  const FIT_PAD = 100;
  const FIT_TOLERANCE = 1.5;
  const PREFS_KEY = 'fc4.editor';
  /** Zoom and pan are remembered per glyph while the app is open. */
  const savedViews = new Map<string, ViewState>();

  type Prefs = { brush: number; stab: number; ink: string | null; opacity: number; refOpacity: number; showOutline: boolean; snap: boolean };
  const defaults: Prefs = { brush: 8, stab: 30, ink: null, opacity: 100, refOpacity: 35, showOutline: false, snap: true };
  const loadPrefs = (): Prefs => {
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
    } catch {
      return { ...defaults };
    }
  };
  const initial = loadPrefs();

  // ---- reactive UI state -------------------------------------------------------------------------
  let draft = $state.raw<Glyph | null>(null);
  let vi = $state(0);
  let tool = $state<Tool>('draw');
  let brush = $state(initial.brush);
  let stab = $state(initial.stab);
  let ink = $state<string | null>(initial.ink);
  let opacity = $state(initial.opacity);
  let refOpacity = $state(initial.refOpacity);
  let showOutline = $state(initial.showOutline);
  let snap = $state(initial.snap);
  let guides = $state(true);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let penTick = $state(0); // bumps when the pen's internal state changes, so the buttons update
  let selected = $state.raw<Hit | null>(null);
  let zoomPct = $state(100);
  let refImg = $state.raw<HTMLImageElement | null>(null);
  let legacyImg = $state.raw<HTMLImageElement | null>(null);

  $effect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ brush, stab, ink, opacity, refOpacity, showOutline, snap } satisfies Prefs));
    } catch {
      /* preferences are best effort */
    }
  });

  // ---- engine objects (not reactive) -------------------------------------------------------------
  const vp = new Viewport();
  const history = new History(200);
  const pen = new PenTool();
  const editPen = new PenTool(); // node editing for a selected pen path
  const router = new PointerRouter();
  let stabilizer = new Stabilizer(initial.stab);

  let wrap: HTMLDivElement | undefined = $state();
  let base: HTMLCanvasElement | undefined = $state();
  let inkLayer: HTMLCanvasElement | undefined = $state();
  let top: HTMLCanvasElement | undefined = $state();
  let cw = 600;
  let ch = 600;
  let dpr = 1;
  let sized = false;
  let userMoved = false;
  let viewKey = '';

  let live: { pts: StrokePoint[]; size: number; erase: boolean; real: boolean } | null = null;
  let predicted: StrokePoint[] = [];
  let cursor: Pt | null = null;
  let editBefore: PenPath | null = null;
  let editPathIndex = -1;
  let lastTap = { t: 0, x: 0, y: 0 };
  let raf = 0;
  let dirtyBase = true;

  const settings = $derived(store.project?.settings);
  const variant = $derived(draft ? (draft.variants[vi] ?? draft.variants[0]) : undefined);
  const brushUnits = $derived(brush * 4);
  const editState = (): EditState => ({ strokes: variant?.strokes ?? [], paths: variant?.paths ?? [], traced: variant?.traced ?? [] });

  // ---- loading a glyph ---------------------------------------------------------------------------
  $effect(() => {
    const c = char;
    const p = store.project;
    if (!c || !p) {
      draft = null;
      return;
    }
    if (draft?.char === c) return;
    finishPen();
    saveView();
    const g = store.glyphs.get(c);
    draft = g ? { ...g, variants: g.variants.map((v) => ({ ...v, strokes: [...v.strokes] })) } : null;
    vi = 0;
    resetEditing();
    viewKey = `${p.id}:${c}`;
    userMoved = false;
    const sv = savedViews.get(viewKey);
    if (sv && sized) {
      vp.set(sv);
      userMoved = true;
    } else if (sized) fit();
    void loadRef(p.id, c);
  });

  function resetEditing() {
    history.clear();
    pen.cancel();
    selected = null;
    live = null;
    refreshFlags();
    markBase();
  }

  const refreshFlags = () => {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  };

  async function loadRef(pid: string, c: string) {
    refImg = null;
    try {
      const blob = await getRef(pid, c);
      if (!blob) return markBase();
      const img = new Image();
      img.onload = () => {
        if (draft?.char === c) {
          refImg = img;
          markBase();
        }
      };
      img.src = blobUrl(blob);
    } catch {
      /* a missing reference is not an error */
    }
  }

  $effect(() => {
    const png = variant?.legacyPng;
    legacyImg = null;
    if (!png) return markBase();
    const img = new Image();
    img.onload = () => {
      legacyImg = img;
      markBase();
    };
    img.src = blobUrl(png);
  });

  // Anything that changes what is drawn schedules a repaint.
  $effect(() => {
    void [draft, vi, guides, ink, opacity, refOpacity, refImg, legacyImg, showOutline, tool, selected, penTick];
    markBase();
  });
  $effect(() => {
    stabilizer = new Stabilizer(stab);
  });

  // ---- viewport ----------------------------------------------------------------------------------
  const fitBox = () => {
    const s = settings!;
    const adv = draft?.advance ?? 500;
    return { minX: -FIT_PAD, maxX: adv + FIT_PAD, minY: s.descender - FIT_PAD, maxY: s.ascender + FIT_PAD };
  };
  function fit() {
    if (!settings) return;
    vp.fit(cw, ch, fitBox(), 6);
    userMoved = false;
    updateZoom();
    markBase();
  }
  function updateZoom() {
    const ref = (() => {
      const b = fitBox();
      return Math.min(Math.max(1, cw - 12) / (b.maxX - b.minX), Math.max(1, ch - 12) / (b.maxY - b.minY));
    })();
    zoomPct = Math.round((vp.k / ref) * 100);
  }
  function zoomBy(f: number) {
    vp.zoomAt(cw / 2, ch / 2, f);
    userMoved = true;
    updateZoom();
    markBase();
  }
  function saveView() {
    if (viewKey && sized) savedViews.set(viewKey, vp.state);
  }

  // ---- painting ----------------------------------------------------------------------------------
  function markBase() {
    dirtyBase = true;
    schedule();
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function paint() {
    if (!base || !inkLayer || !top || !settings || !draft || !sized) return;
    const colors = readColors();
    const size = { w: cw, h: ch };
    if (dirtyBase) {
      dirtyBase = false;
      // Layer 1: workspace, guides and reference images (opaque).
      const ctx = base.getContext('2d');
      if (ctx) {
        drawGuides(ctx, vp, dpr, size, settings, draft.advance, draft.lsb, draft.rsb, colors, guides);
        if (refImg) drawReference(ctx, vp, dpr, refImg, settings, draft.advance, refOpacity / 100);
        if (legacyImg) drawReference(ctx, vp, dpr, legacyImg, settings, draft.advance, 0.45);
      }
      // Layer 2: the ink, a transparent canvas of its own so eraser strokes can cut it with
      // destination-out. It is shown directly (opacity is CSS), never copied to another canvas.
      const ictx = inkLayer.getContext('2d');
      if (ictx) {
        const st = editState();
        drawInk(ictx, vp, dpr, size, st.strokes, st.paths, ink ?? colors.text, live?.erase ? live : null, st.traced);
      }
    }
    const lctx = top.getContext('2d');
    if (!lctx) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, top.width, top.height);
    if (live && !live.erase) drawLiveStroke(lctx, vp, dpr, [...live.pts, ...predicted], live.size, live.real, ink ?? colors.text, opacity / 100);
    if (tool === 'erase' && cursor) drawEraserCursor(lctx, vp, dpr, cursor, brushUnits, colors);
    if (showOutline && variant) drawContourPreview(lctx, vp, dpr, variant.contours, colors);
    if (tool === 'pen' && pen.active) drawNodes(lctx, vp, dpr, pen.nodes, pen.closed, colors, 6);
    if (tool === 'select' && selected) {
      if (selected.kind === 'path' && editPen.active) drawNodes(lctx, vp, dpr, editPen.nodes, editPen.closed, colors, 6);
      else if (selected.kind === 'stroke') {
        const s = editState().strokes[selected.index];
        if (s) drawSelectionBox(lctx, vp, dpr, s, colors);
      }
    }
  }

  function resize() {
    if (!wrap || !base || !inkLayer || !top) return;
    const w = Math.max(1, Math.round(wrap.clientWidth));
    const h = Math.max(1, Math.round(wrap.clientHeight));
    const ratio = window.devicePixelRatio || 1;
    const tw = Math.round(w * ratio);
    const th = Math.round(h * ratio);
    // The canvases are created and destroyed with the glyph, so compare against their real size.
    if (sized && base.width === tw && base.height === th && top.width === tw && inkLayer.width === tw) return;
    cw = w;
    ch = h;
    dpr = ratio;
    for (const c of [base, inkLayer, top]) {
      c.width = tw;
      c.height = th;
    }
    const first = !sized;
    sized = true;
    if (first) {
      const sv = savedViews.get(viewKey);
      if (sv) {
        vp.set(sv);
        userMoved = true;
      } else fit();
    } else if (!userMoved) fit();
    updateZoom();
    markBase();
  }

  // The canvases only exist once a glyph is loaded, so size them (and watch for resizes) when they appear.
  $effect(() => {
    const el = wrap;
    if (!el || !base || !inkLayer || !top) return;
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  });

  onMount(() => {
    platform().keepAwake(true);
  });
  onDestroy(() => {
    platform().keepAwake(false);
    if (raf) cancelAnimationFrame(raf);
    finishPen();
    saveView();
    void store.flush();
  });

  // ---- committing edits --------------------------------------------------------------------------
  function setState(s: EditState) {
    if (!draft) return;
    const contours = buildContours(s.strokes, s.paths, { tolerance: FIT_TOLERANCE }, s.traced);
    const variants = draft.variants.map((v, i) => {
      if (i !== vi) return v;
      const { paths: _p, traced: _t, ...rest } = v;
      return { ...rest, strokes: [...s.strokes], contours, ...(s.paths.length ? { paths: [...s.paths] } : {}), ...(s.traced.length ? { traced: [...s.traced] } : {}) };
    });
    draft = { ...draft, variants };
    store.saveGlyph(draft, true);
    refreshFlags();
    markBase();
  }

  function run(cmd: Command) {
    setState(history.run(cmd, editState()));
  }

  function undo() {
    if (pen.active && tool === 'pen') return pen.cancel(), bumpPen();
    const s = history.undo(editState());
    if (s) {
      selected = null;
      setState(s);
    }
  }
  function redo() {
    const s = history.redo(editState());
    if (s) {
      selected = null;
      setState(s);
    }
  }
  function clearAll() {
    const st = editState();
    if (st.strokes.length || st.paths.length || st.traced.length) {
      selected = null;
      run(new ClearAll(st));
    }
  }

  const bumpPen = () => {
    penTick++;
    markBase();
  };

  /** Commits an in-progress pen path if it has two or more points; otherwise discards it. */
  function finishPen() {
    if (!pen.active) return;
    const path = pen.commit(brushUnits);
    if (path) run(new AddPath(path));
    else pen.cancel();
    bumpPen();
  }

  function penDone() {
    const path = pen.commit(brushUnits);
    if (!path) return toast(t('editor.pen.need2'), 'wn');
    run(new AddPath(path));
    platform().haptic('success');
    toast(t('editor.pen.applied'), 'ok');
    bumpPen();
  }
  function penClose() {
    if (!pen.close()) return toast(t('editor.pen.need3'), 'wn');
    bumpPen();
  }
  function penCancel() {
    pen.cancel();
    bumpPen();
  }

  function deleteSelected() {
    if (!selected) return;
    const st = editState();
    const obj = selected.kind === 'stroke' ? st.strokes[selected.index] : st.paths[selected.index];
    if (!obj) return;
    const sel = selected;
    selected = null;
    editPen.cancel();
    run(new DeleteObject(sel.kind, sel.index, obj));
  }

  function chooseTool(next: Tool) {
    if (next === tool) return;
    if (tool === 'pen') finishPen();
    editPen.cancel();
    selected = null;
    tool = next;
    markBase();
  }

  // ---- pointer input -----------------------------------------------------------------------------
  const world = (x: number, y: number): Pt => {
    const [wx, wy] = vp.toWorld(x, y);
    return { x: wx, y: wy };
  };
  const guideSet = () => {
    const s = settings!;
    const g = draft!;
    return { xs: [0, g.advance, g.lsb, g.advance - g.rsb], ys: [0, s.xheight, s.capheight, s.ascender, s.descender] };
  };

  function handle(actions: Action[]) {
    for (const a of actions) {
      switch (a.type) {
        case 'draw-start':
          return void onStart(a);
        case 'draw-move':
          onMoveAction(a);
          break;
        case 'draw-end':
          onEnd(a);
          break;
        case 'draw-cancel':
          onCancelDraw();
          break;
        case 'pan-zoom':
          vp.gesture(a.cx, a.cy, a.scale, a.dx, a.dy);
          userMoved = true;
          updateZoom();
          markBase();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
      }
    }
  }

  function onStart(a: Extract<Action, { type: 'draw-start' }>) {
    if (!draft || !settings) return;
    const w = world(a.x, a.y);
    if (tool === 'draw' || tool === 'erase') {
      stabilizer = new Stabilizer(stab);
      const sp = stabilizer.push(a.x, a.y, a.t);
      const sw = world(sp.x, sp.y);
      live = { pts: [{ x: sw.x, y: sw.y, pressure: a.pressure }], size: tool === 'erase' ? brushUnits * 1.5 : brushUnits, erase: tool === 'erase', real: a.kind === 'pen' };
      predicted = [];
      if (tool === 'erase') markBase();
      else schedule();
    } else if (tool === 'pen') {
      pen.snap = snap ? (p) => snapToGuides(p, guideSet(), 8 / vp.k) : undefined;
      pen.onSnap = () => platform().haptic('tick');
      pen.down(w, 16 / vp.k);
      bumpPen();
    } else {
      selectDown(w, a);
    }
  }

  function onMoveAction(a: Extract<Action, { type: 'draw-move' }>) {
    if (tool === 'draw' || tool === 'erase') {
      if (!live) return;
      const sp = stabilizer.push(a.x, a.y, a.t);
      const sw = world(sp.x, sp.y);
      const last = live.pts[live.pts.length - 1]!;
      if (Math.hypot(sw.x - last.x, sw.y - last.y) * vp.k < 0.6) return;
      live.pts.push({ x: sw.x, y: sw.y, pressure: a.pressure });
      cursor = sw;
      if (live.erase) markBase();
      else schedule();
    } else if (tool === 'pen') {
      pen.move(world(a.x, a.y), 4 / vp.k);
      bumpPen();
    } else if (tool === 'select' && selected?.kind === 'path' && editPen.dragging) {
      editPen.move(world(a.x, a.y), 2 / vp.k);
      markBase();
    }
  }

  function onEnd(a: Extract<Action, { type: 'draw-end' }>) {
    if (tool === 'draw' || tool === 'erase') {
      if (!live) return;
      const done = live;
      live = null;
      predicted = [];
      const raw = world(a.x, a.y);
      const last = done.pts[done.pts.length - 1]!;
      // The filter lags the pointer; finish exactly where the pointer lifted.
      if (done.pts.length > 1 && Math.hypot(raw.x - last.x, raw.y - last.y) * vp.k > 0.6) done.pts.push({ x: raw.x, y: raw.y, pressure: a.pressure });
      const stroke: Stroke = { pts: thinPoints(done.pts, Math.max(0.5, done.size / 14)), size: done.size, ...(done.erase ? { erase: true } : {}) };
      const hasInk = editState().strokes.some((s) => !s.erase) || editState().paths.length > 0 || editState().traced.length > 0;
      if (done.erase && !hasInk) return markBase();
      run(done.erase ? new EraseStroke(stroke) : new AddStroke(stroke));
    } else if (tool === 'pen') {
      pen.up();
      bumpPen();
    } else if (tool === 'select') selectUp(a);
  }

  function onCancelDraw() {
    live = null;
    predicted = [];
    if (tool === 'pen') {
      pen.abortDrag();
      bumpPen();
    }
    editPen.cancel();
    if (selected?.kind === 'path') loadEditPen(selected.index);
    markBase();
  }

  // ---- select tool -------------------------------------------------------------------------------
  function loadEditPen(index: number) {
    const p = editState().paths[index];
    editPathIndex = index;
    editPen.cancel();
    if (!p) return;
    editBefore = p;
    editPen.nodes = p.nodes.map((n) => ({ ...n, p: { ...n.p }, ...(n.hIn ? { hIn: { ...n.hIn } } : {}), ...(n.hOut ? { hOut: { ...n.hOut } } : {}) }));
    editPen.closed = p.closed;
  }

  function selectDown(w: Pt, a: Extract<Action, { type: 'draw-start' }>) {
    const radius = 14 / vp.k;
    if (selected?.kind === 'path' && editPen.hit(w, radius)) {
      editPen.down(w, radius);
      markBase();
      return;
    }
    const st = editState();
    const hit = hitTest(st.strokes, st.paths, w, 8 / vp.k);
    selected = hit;
    editPen.cancel();
    if (hit?.kind === 'path') loadEditPen(hit.index);
    lastTap = { ...lastTap, x: a.x, y: a.y };
    markBase();
  }

  function selectUp(a: Extract<Action, { type: 'draw-end' }>) {
    if (selected?.kind === 'path' && editPen.dragging) {
      editPen.up();
      const before = editBefore;
      if (before) {
        const changed = editPen.nodes.map((n, i) => ({ n, i })).filter(({ n, i }) => JSON.stringify(n) !== JSON.stringify(before.nodes[i]));
        for (const { n, i } of changed) {
          run(new MoveNode(editPathIndex, i, before.nodes[i]!, n));
        }
        if (changed.length) loadEditPen(editPathIndex);
      }
      markBase();
      return;
    }
    // Double tap on empty space fits the glyph to the screen.
    if (!selected && Math.hypot(a.x - lastTap.x, a.y - lastTap.y) < 12) {
      if (a.t - lastTap.t < 320) fit();
      lastTap = { t: a.t, x: a.x, y: a.y };
    }
  }

  // ---- DOM events --------------------------------------------------------------------------------
  const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse');
  function mk(type: PtrEvent['type'], e: PointerEvent, src: PointerEvent = e): PtrEvent {
    const r = top!.getBoundingClientRect();
    return { type, id: e.pointerId, kind: kindOf(e), x: src.clientX - r.left, y: src.clientY - r.top, t: src.timeStamp, pressure: src.pressure };
  }

  function onDown(e: PointerEvent) {
    if (!draft || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try {
      top!.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    handle(router.handle(mk('down', e)));
  }
  function onMove(e: PointerEvent) {
    const r = top!.getBoundingClientRect();
    cursor = world(e.clientX - r.left, e.clientY - r.top);
    const list = e.getCoalescedEvents?.() ?? [];
    for (const ce of list.length ? list : [e]) handle(router.handle(mk('move', e, ce)));
    if (live && !live.erase) {
      const pred = e.getPredictedEvents?.() ?? [];
      predicted = pred.slice(0, 3).map((pe) => {
        const w = world(pe.clientX - r.left, pe.clientY - r.top);
        return { x: w.x, y: w.y, pressure: pe.pressure || 0.5 };
      });
    }
    if (tool === 'erase') schedule();
  }
  function onUp(e: PointerEvent) {
    handle(router.handle(mk('up', e)));
    if (top?.hasPointerCapture?.(e.pointerId)) top.releasePointerCapture(e.pointerId);
  }
  function onCancel(e: PointerEvent) {
    handle(router.handle(mk('cancel', e)));
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = top!.getBoundingClientRect();
    vp.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    userMoved = true;
    updateZoom();
    markBase();
  }
  $effect(() => {
    const el = top;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---- panels ------------------------------------------------------------------------------------
  function commitGlyph(next: Glyph) {
    draft = next;
    store.saveGlyph(next);
    markBase();
  }
  function setMetric(key: 'advance' | 'lsb' | 'rsb', value: string) {
    if (!draft) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    commitGlyph({ ...draft, [key]: Math.max(0, Math.min(3000, Math.round(n))) });
  }
  function autoSide() {
    if (!draft || !variant) return;
    const b = autoBearings(variant.strokes, draft.advance);
    if (b) commitGlyph({ ...draft, ...b });
  }
  function addVariant() {
    if (!draft || draft.variants.length >= MAX_VARIANTS) return;
    finishPen();
    commitGlyph({ ...draft, variants: [...draft.variants, emptyVariant()] });
    vi = draft.variants.length - 1;
    resetEditing();
  }
  function removeVariant() {
    if (!draft || draft.variants.length <= 1) return;
    commitGlyph({ ...draft, variants: draft.variants.filter((_, i) => i !== vi) });
    vi = Math.max(0, vi - 1);
    resetEditing();
  }
  function pickVariant(i: number) {
    finishPen();
    vi = i;
    resetEditing();
  }

  async function save() {
    if (!draft) return;
    finishPen();
    store.saveGlyph(draft);
    await store.flush();
    platform().haptic('success');
    toast(t('editor.saved'), 'ok');
  }

  async function pickRef() {
    const p = store.project;
    if (!p || !draft) return;
    try {
      const file = await platform().openFile(['image/*']);
      if (!file) return;
      await saveRef(p.id, draft.char, file);
      await loadRef(p.id, draft.char);
    } catch {
      toast(t('editor.ref.failed'), 'wn');
    }
  }
  async function clearRef() {
    const p = store.project;
    if (!p || !draft) return;
    await deleteRef(p.id, draft.char);
    refImg = null;
    markBase();
  }

  // ---- imported artwork: SVG and a traced reference picture ----------------------------------------
  let engine: ScanEngine | null = null;
  const getEngine = () => (engine ??= createScanEngine());
  let traceThreshold = $state(128);
  onDestroy(() => engine?.dispose());

  const metrics = () => {
    const s = settings!;
    return { ascender: s.ascender, descender: s.descender, capheight: s.capheight, defLsb: s.defLsb, defRsb: s.defRsb };
  };

  /** Adds artwork to the glyph as one undoable step, keeping any art that is already there. */
  function addArt(contours: ReturnType<typeof placeSvgArtwork>) {
    const cur = editState().traced;
    run(new SetTraced(cur, normalizeWinding([...cur, ...contours], 1), 'Import'));
  }

  async function importSvg() {
    if (!draft) return;
    try {
      const file = await platform().openFile(['.svg', 'image/svg+xml']);
      if (!file) return;
      const { contours } = parseSvg(await file.text());
      addArt(placeSvgArtwork(contours, { advance: draft.advance, ascender: settings!.ascender, descender: settings!.descender }));
      toast(t('editor.import.done'), 'ok');
    } catch (e) {
      toast(t('editor.import.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    }
  }

  async function traceReference() {
    const p = store.project;
    if (!p || !draft) return;
    try {
      const blob = await getRef(p.id, draft.char);
      if (!blob) return;
      const contours = await getEngine().traceReference(blob, traceThreshold, draft.advance, metrics());
      if (!contours.length) return toast(t('editor.ref.nothing'), 'wn');
      addArt(contours);
      toast(t('editor.ref.traced'), 'ok');
    } catch (e) {
      toast(t('editor.import.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    }
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') return void (e.preventDefault(), e.shiftKey ? redo() : undo());
    if (mod && k === 'y') return void (e.preventDefault(), redo());
    if (mod && k === 's') return void (e.preventDefault(), void save());
    if (mod || e.altKey) return;
    if (k === 'd') chooseTool('draw');
    else if (k === 'b') chooseTool('pen');
    else if (k === 'e') chooseTool('erase');
    else if (k === 'v') chooseTool('select');
    else if (k === 'g') guides = !guides;
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-' || k === '_') zoomBy(0.8);
    else if (k === '0') fit();
    else if (k === 'enter' && tool === 'pen') penDone();
    else if (k === 'c' && tool === 'pen') penClose();
    else if (k === 'escape') {
      if (tool === 'pen') penCancel();
      else if (selected) (selected = null), editPen.cancel(), markBase();
    } else if ((k === 'delete' || k === 'backspace') && tool === 'select') deleteSelected();
  }

  const TOOLS: { id: Tool; icon: IconName; label: string }[] = [
    { id: 'draw', icon: 'pen', label: 'editor.tool.draw' },
    { id: 'pen', icon: 'nib', label: 'editor.tool.pen' },
    { id: 'erase', icon: 'eraser', label: 'editor.tool.erase' },
    { id: 'select', icon: 'cursor', label: 'editor.tool.select' },
  ];
  const penState = $derived.by(() => {
    void penTick; // the pen is a plain object; this tick tells Svelte when to re-read it
    return { active: pen.active, canClose: pen.canClose, canCommit: pen.canCommit };
  });
</script>

<svelte:window onkeydown={onKey} />

{#if !store.project}
  <TopBar title={t('editor.title')} />
  <NoProject />
{:else if !draft || !settings}
  <TopBar title={t('editor.title')} />
  <div class="empty">
    <p>{t('editor.none')}</p>
    <a class="btn primary" href={hrefFor({ name: 'glyphs' })}>{t('nav.glyphs')}</a>
  </div>
{:else}
  <TopBar title={draft.char} subtitle="{store.project.name} · {vi + 1}/{draft.variants.length}">
    {#snippet actions()}
      <button class="btn ghost" onclick={clearAll}>{t('editor.clear')}</button>
      <button class="btn ghost" onclick={undo} disabled={!canUndo && !penState.active} aria-label={t('common.undo')}>↩</button>
      <button class="btn ghost" onclick={redo} disabled={!canRedo} aria-label={t('common.redo')}>↪</button>
      <button class="btn primary" onclick={save}><Icon name="check" size={16} />{t('editor.save')}</button>
    {/snippet}
  </TopBar>
  <div class="ed">
    <div class="main">
      <div class="tools no-select" role="toolbar" aria-label={t('editor.title')}>
        {#each TOOLS as tl (tl.id)}
          <button class="tb" class:on={tool === tl.id} aria-pressed={tool === tl.id} onclick={() => chooseTool(tl.id)} title={t(tl.label)} aria-label={t(tl.label)}><Icon name={tl.icon} /></button>
        {/each}
        <span class="sep"></span>
        <button class="tb" onclick={() => zoomBy(0.8)} title={t('editor.zoom.out')} aria-label={t('editor.zoom.out')}><Icon name="zoomout" /></button>
        <span class="zoom mono" aria-live="polite">{zoomPct}%</span>
        <button class="tb" onclick={() => zoomBy(1.25)} title={t('editor.zoom.in')} aria-label={t('editor.zoom.in')}><Icon name="zoomin" /></button>
        <button class="tb" onclick={fit} title={t('editor.zoom.fit')} aria-label={t('editor.zoom.fit')}><Icon name="fit" /></button>
        <span class="sep"></span>
        <button class="tb" class:on={guides} aria-pressed={guides} onclick={() => (guides = !guides)} title={t('editor.guides')} aria-label={t('editor.guides')}><Icon name="grid" /></button>
        <button class="tb" class:on={showOutline} aria-pressed={showOutline} onclick={() => (showOutline = !showOutline)} title={t('editor.outline')} aria-label={t('editor.outline')}><Icon name="eye" /></button>
        <label class="rng"><span>{t('editor.brush')}</span><input type="range" min="1" max="40" bind:value={brush} /><span class="mono">{brush}</span></label>
        <label class="rng"><span>{t('editor.stabilizer')}</span><input type="range" min="0" max="100" bind:value={stab} /><span class="mono">{stab}</span></label>
      </div>
      {#if tool === 'pen' || tool === 'select'}
        <div class="ctx no-select">
          {#if tool === 'pen'}
            <button class="btn primary" onclick={penDone} disabled={!penState.canCommit}>{t('editor.pen.done')}</button>
            <button class="btn ghost" onclick={penClose} disabled={!penState.canClose}>{t('editor.pen.close')}</button>
            <button class="btn ghost" onclick={penCancel} disabled={!penState.active}>{t('editor.pen.cancel')}</button>
            <label class="chk"><input type="checkbox" bind:checked={snap} />{t('editor.snap')}</label>
            <span class="hint">{t('editor.pen.hint')}</span>
          {:else}
            <button class="btn danger" onclick={deleteSelected} disabled={!selected}><Icon name="trash" size={16} />{t('editor.delete')}</button>
            <span class="hint">{t('editor.select.hint')}</span>
          {/if}
        </div>
      {/if}
      <div class="cv no-select" bind:this={wrap}>
        <canvas class="layer" bind:this={base} aria-hidden="true"></canvas>
        <canvas class="layer" bind:this={inkLayer} aria-hidden="true" style:opacity={opacity / 100}></canvas>
        <canvas class="layer live" bind:this={top} aria-label={t('editor.canvas', { char: draft.char })} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onCancel} onpointerleave={() => ((cursor = null), schedule())}></canvas>
      </div>
    </div>
    <aside class="side">
      <section>
        <h4>{t('editor.metrics')}</h4>
        {#each [['advance', 'editor.advance', draft.advance], ['lsb', 'editor.lsb', draft.lsb], ['rsb', 'editor.rsb', draft.rsb]] as [key, label, val] (key)}
          <div class="row"><label for="m-{key}">{t(label as string)}</label><input id="m-{key}" class="num mono" type="number" inputmode="numeric" value={val} oninput={(e) => setMetric(key as 'advance' | 'lsb' | 'rsb', e.currentTarget.value)} /></div>
        {/each}
        <button class="btn ghost wide" onclick={autoSide}>{t('editor.autoBearings')}</button>
      </section>
      <section>
        <h4>{t('editor.variants')}</h4>
        <div class="vars">
          {#each draft.variants as _, i (i)}
            <button class="vt" class:on={i === vi} aria-pressed={i === vi} aria-label="{t('editor.variants')} {i + 1}" onclick={() => pickVariant(i)}>{i + 1}</button>
          {/each}
          {#if draft.variants.length < MAX_VARIANTS}
            <button class="vt add" aria-label={t('editor.variants.add')} onclick={addVariant}>+</button>
          {/if}
        </div>
        {#if draft.variants.length > 1}<button class="btn ghost wide" onclick={removeVariant}>{t('editor.variants.remove')}</button>{/if}
        <p class="note">{t('editor.variants.note')}</p>
        {#if variant?.legacyPng}<p class="note">{t('editor.legacy')}</p>{/if}
      </section>
      <section>
        <h4>{t('editor.reference')}</h4>
        <div class="btns">
          <button class="btn ghost" onclick={pickRef}><Icon name="image" size={16} />{t('editor.ref.load')}</button>
          {#if refImg}<button class="btn ghost" onclick={clearRef}>{t('editor.ref.clear')}</button>{/if}
        </div>
        {#if refImg}
          <label class="rng col"><span>{t('editor.ref.opacity')}</span><input type="range" min="5" max="100" bind:value={refOpacity} /></label>
          <label class="rng col"><span>{t('editor.ref.threshold')} <span class="mono">{traceThreshold}</span></span><input type="range" min="20" max="235" bind:value={traceThreshold} /></label>
          <button class="btn ghost wide" onclick={traceReference}>{t('editor.ref.trace')}</button>
        {/if}
      </section>
      <section>
        <h4>{t('editor.import')}</h4>
        <button class="btn ghost wide" onclick={importSvg}>{t('editor.import.svg')}</button>
        <p class="note">{t('editor.import.note')}</p>
      </section>
      <section>
        <h4>{t('editor.display')}</h4>
        <div class="row"><label for="ink">{t('editor.ink')}</label><input id="ink" type="color" value={ink ?? '#f0f0f4'} oninput={(e) => (ink = e.currentTarget.value)} /></div>
        <label class="rng col"><span>{t('editor.opacity')}</span><input type="range" min="10" max="100" bind:value={opacity} /></label>
        <p class="note">{t('editor.displayOnly')}</p>
      </section>
    </aside>
  </div>
{/if}

<style>
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text3); font-size: 13px; padding: 24px; text-align: center; }
  .empty a { text-decoration: none; }
  .ed { flex: 1; display: flex; min-height: 0; }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .tools { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }
  .ctx { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--bg3); border-bottom: 1px solid var(--border); flex-wrap: wrap; flex-shrink: 0; }
  .hint { font-size: 11px; color: var(--text3); flex: 1; min-width: 160px; }
  .chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); min-height: 36px; }
  .chk input { accent-color: var(--accent); width: 18px; height: 18px; }
  .tb { width: var(--tap); height: var(--tap); border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text2); display: grid; place-items: center; flex-shrink: 0; }
  .tb:hover { background: var(--bg3); border-color: var(--border2); }
  .tb.on { background: var(--abg); border-color: var(--aborder); color: var(--accent2); }
  .sep { width: 1px; height: 26px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
  .zoom { font-size: 11px; color: var(--text3); min-width: 42px; text-align: center; }
  .rng { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text3); margin-left: 6px; flex-shrink: 0; }
  .rng.col { flex-direction: column; align-items: stretch; margin: 8px 0 0; gap: 4px; }
  .rng input { width: 96px; accent-color: var(--accent); }
  .rng.col input { width: 100%; }
  .cv { flex: 1; min-height: 240px; position: relative; overflow: hidden; background: var(--bg3); }
  .layer { position: absolute; inset: 0; width: 100%; height: 100%; }
  .live { touch-action: none; cursor: crosshair; -webkit-touch-callout: none; }
  .side { width: 260px; flex-shrink: 0; background: var(--bg2); border-left: 1px solid var(--border); overflow-y: auto; }
  section { padding: 14px 16px; border-bottom: 1px solid var(--border); }
  h4 { font-size: 11px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .row label { font-size: 12px; color: var(--text2); }
  .row input[type='color'] { width: 40px; height: 32px; border: none; background: transparent; padding: 0; }
  .num { width: 84px; min-height: 36px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 6px; text-align: right; padding: 0 8px; }
  .num:focus { outline: none; border-color: var(--accent); }
  .wide { width: 100%; margin-top: 6px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .vars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
  .vt { aspect-ratio: 1; min-height: 40px; border-radius: 8px; border: 1px solid var(--border2); background: var(--bg3); font-size: 15px; }
  .vt.on { border-color: var(--accent); border-width: 2px; }
  .vt.add { color: var(--text3); }
  .note { font-size: 11px; color: var(--text3); line-height: 1.45; margin-top: 8px; }
  @media (max-width: 767px) {
    .ed { flex-direction: column; overflow-y: auto; }
    .main { flex: none; }
    .cv { height: 55vh; flex: none; }
    .side { width: auto; border-left: none; border-top: 1px solid var(--border); overflow: visible; }
  }
</style>
