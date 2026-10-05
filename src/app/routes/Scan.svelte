<script lang="ts">
  import { onDestroy } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import NoProject from '../components/NoProject.svelte';
  import CellThumb from '../components/CellThumb.svelte';
  import Icon from '../components/Icon.svelte';
  import { charsForTab, type ScriptTab } from '../charsets';
  import { importArtInto, type ImportPolicy } from '@/engine/art';
  import { decodeToRGBA } from '@/scan/decode';
  import { createScanEngine, type CellInfo, type ScanEngine, type ScanParams } from '@/scan/engine';
  import { captureRect, cellRect, cellsOf, computeGrid, DEFAULTS, initialGrid, scLayout, type GridState, type LayoutInput } from '@/scan/scan-core';
  import { platform } from '@/platform';
  import { store } from '../stores/project.svelte';
  import { toast } from '../stores/toast.svelte';
  import { readColors } from '@/engine/render';
  import { t } from '../i18n/t.svelte';

  // ---- state -------------------------------------------------------------------------------------
  let engine: ScanEngine | null = null;
  let source: HTMLCanvasElement | null = null; // what is shown; the engine holds its own pixel copy
  let imgW = $state(0);
  let imgH = $state(0);
  let loading = $state(false);
  let dragOver = $state(false);

  let mode = $state<'template' | 'custom'>('template');
  let cols = $state(6);
  let rows = $state(8);
  let script = $state<ScriptTab>('latin');
  let page = $state(1);
  let grid = $state.raw<GridState>({ base: { px0: 0, py0: 0, sx: 1, sy: 1 }, ox: 0, oy: 0, k: 1 });
  let adj = $state.raw<Record<number, { dx: number; dy: number }>>({});
  let thr = $state<number>(DEFAULTS.threshold);
  let trim = $state<number>(DEFAULTS.trim);
  let labelStrip = $state<boolean>(DEFAULTS.labelStrip);
  let skip = $state.raw<ReadonlySet<number>>(new Set());
  let assign = $state.raw<Record<number, string>>({});
  let imported = $state.raw<ReadonlySet<number>>(new Set());
  let sel = $state<number | null>(null);
  let infos = $state.raw<ReadonlyMap<number, CellInfo>>(new Map());
  let policy = $state<ImportPolicy>('variant');
  let moveGrid = $state(false);
  let importing = $state<{ done: number; total: number } | null>(null);

  let wrap: HTMLDivElement | undefined = $state();
  let cv: HTMLCanvasElement | undefined = $state();
  let cw = 600;
  let ch = 400;
  let dpr = 1;
  let view = { k: 1, tx: 0, ty: 0 };
  let raf = 0;
  const ptrs = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let moved = false;
  let lastPinch: { d: number; cx: number; cy: number } | null = null;

  const project = $derived(store.project);
  const scriptChars = $derived(charsForTab(script).filter((c) => store.glyphs.has(c)));
  const layoutInput = $derived<LayoutInput>(
    mode === 'template' ? { mode: 'template', project: { set: project?.set ?? 'latin', cell: project?.cell ?? 'medium' } } : { mode: 'custom', custom: { cols, rows, chars: scriptChars } },
  );
  const L = $derived(scLayout(layoutInput));
  const cells = $derived(cellsOf(L, page));
  const hasImage = $derived(imgW > 0);
  const charOf = (gi: number) => assign[gi] ?? L.chars[gi] ?? '';
  const params = (): ScanParams => ({ layout: layoutInput, page, grid, adj, threshold: thr, trim, labelStrip });

  const summary = $derived.by(() => {
    let ink = 0;
    for (const c of cells) if (infos.get(c.gi)?.has && !skip.has(c.gi)) ink++;
    return { ink, total: cells.length, done: cells.filter((c) => imported.has(c.gi)).length };
  });

  // ---- loading an image ----------------------------------------------------------------------------
  async function loadImage(blob: Blob) {
    loading = true;
    try {
      const rgba = await decodeToRGBA(blob);
      source = toCanvas(rgba.data, rgba.width, rgba.height);
      engine ??= createScanEngine();
      const dims = await engine.load(rgba); // the pixel buffer moves to the engine
      imgW = dims.width;
      imgH = dims.height;
      adj = {};
      skip = new Set();
      assign = {};
      imported = new Set();
      infos = new Map();
      sel = null;
      grid = initialGrid(imgW, imgH);
      if (mode === 'template') {
        const d = await engine.detectPage(layoutInput);
        page = Math.min(d.page, L.pages.length);
        await align(false);
      } else page = 1;
      fitView();
      queueAnalysis();
    } catch (e) {
      toast(t('scan.load.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    } finally {
      loading = false;
    }
  }

  function toCanvas(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    return c;
  }

  async function openFile() {
    const f = await platform().openFile(['image/*']);
    if (f) await loadImage(f);
  }
  async function takePhoto() {
    try {
      const b = await platform().captureImage();
      if (b) await loadImage(b);
    } catch (e) {
      toast(t('scan.load.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) void loadImage(f);
  }

  async function rotate() {
    if (!engine || !source) return;
    const dims = await engine.rotate(1);
    const r = document.createElement('canvas');
    r.width = dims.width;
    r.height = dims.height;
    const ctx = r.getContext('2d');
    if (ctx) {
      ctx.translate(r.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(source, 0, 0);
    }
    source = r;
    imgW = dims.width;
    imgH = dims.height;
    adj = {};
    grid = initialGrid(imgW, imgH);
    if (mode === 'template') await align(false);
    fitView();
    queueAnalysis();
  }

  async function align(announce = true) {
    if (!engine || mode !== 'template') return;
    const res = await engine.align(layoutInput, page);
    grid = { base: res.base, ox: 0, oy: 0, k: 1 };
    if (announce) toast(res.ok ? t('scan.align.ok') : t('scan.align.weak'), res.ok ? 'ok' : 'wn');
    queueAnalysis();
  }
  function resetGrid() {
    grid = initialGrid(imgW, imgH);
    adj = {};
    queueAnalysis();
  }

  // ---- analysis (debounced; runs in the worker) ------------------------------------------------------
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticket = 0;
  function queueAnalysis() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!engine || !hasImage) return;
      const mine = ++ticket;
      try {
        const list = await engine.analyze(params());
        if (mine !== ticket) return; // a newer request superseded this one
        infos = new Map(list.map((c) => [c.gi, c]));
        schedule();
      } catch (e) {
        console.warn('FontCraft: scan analysis failed', e);
      }
    }, 180);
  }

  $effect(() => {
    // Anything that changes what is read triggers a fresh analysis.
    void [layoutInput, page, grid, adj, thr, trim, labelStrip];
    if (hasImage) queueAnalysis();
  });
  $effect(() => {
    void [infos, skip, imported, sel, cells, page, grid, adj, labelStrip, trim];
    schedule();
  });

  // ---- viewer ----------------------------------------------------------------------------------------
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }
  function fitView() {
    if (!hasImage) return;
    const k = Math.min(cw / imgW, ch / imgH) * 0.98;
    view = { k, tx: (cw - imgW * k) / 2, ty: (ch - imgH * k) / 2 };
    schedule();
  }

  function paint() {
    if (!cv || !hasImage) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const c = readColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg3;
    ctx.fillRect(0, 0, cw, ch);
    if (source) {
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(source, view.tx, view.ty, imgW * view.k, imgH * view.k);
    }
    const g = computeGrid(L, page, grid);
    ctx.font = '600 11px system-ui, sans-serif';
    for (const cell of cells) {
      const R = cellRect(L, g, page, cell, adj[cell.gi]);
      const x = view.tx + R.x * view.k, y = view.ty + R.y * view.k, w = R.w * view.k, h = R.h * view.k;
      const info = infos.get(cell.gi);
      const isSel = sel === cell.gi;
      const skipped = skip.has(cell.gi);
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.strokeStyle = skipped ? c.red : imported.has(cell.gi) ? '#22c55e' : info?.has ? c.accent : 'rgba(128,128,150,.75)';
      ctx.setLineDash(skipped ? [5, 4] : []);
      ctx.strokeRect(x, y, w, h);
      if (isSel) {
        ctx.fillStyle = 'rgba(108,99,255,.12)';
        ctx.fillRect(x, y, w, h);
        const C = captureRect(L, g, R, trim, labelStrip);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = c.amber;
        ctx.strokeRect(view.tx + C.x * view.k, view.ty + C.y * view.k, C.w * view.k, C.h * view.k);
      }
      ctx.setLineDash([]);
      const label = charOf(cell.gi) || String(cell.gi + 1);
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(10,10,11,.78)';
      ctx.fillRect(x, y, Math.min(w, tw), 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 4, y + 11);
    }
  }

  function resize() {
    if (!wrap || !cv) return;
    const w = Math.max(1, Math.round(wrap.clientWidth)), h = Math.max(1, Math.round(wrap.clientHeight));
    const r = window.devicePixelRatio || 1;
    if (cv.width === Math.round(w * r) && cv.height === Math.round(h * r)) return;
    const first = cw === 600 && ch === 400;
    cw = w; ch = h; dpr = r;
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
    if (first && hasImage) fitView();
    schedule();
  }
  $effect(() => {
    const el = wrap;
    if (!el || !cv) return;
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  });
  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(timer);
    engine?.dispose();
  });

  const local = (e: PointerEvent) => {
    const r = cv!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toImage = (px: number, py: number) => ({ x: (px - view.tx) / view.k, y: (py - view.ty) / view.k });

  function cellAt(px: number, py: number): number | null {
    const p = toImage(px, py);
    const g = computeGrid(L, page, grid);
    for (const cell of cells) {
      const R = cellRect(L, g, page, cell, adj[cell.gi]);
      if (p.x >= R.x && p.x <= R.x + R.w && p.y >= R.y && p.y <= R.y + R.h) return cell.gi;
    }
    return null;
  }

  function onDown(e: PointerEvent) {
    if (!hasImage) return;
    e.preventDefault();
    try { cv!.setPointerCapture(e.pointerId); } catch { /* best effort */ }
    const p = local(e);
    ptrs.set(e.pointerId, { ...p, sx: p.x, sy: p.y });
    moved = false;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      lastPinch = { d: Math.hypot(b!.x - a!.x, b!.y - a!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
    }
  }
  function onMove(e: PointerEvent) {
    const cur = ptrs.get(e.pointerId);
    if (!cur) return;
    const p = local(e);
    const dx = p.x - cur.x, dy = p.y - cur.y;
    cur.x = p.x; cur.y = p.y;
    if (Math.hypot(p.x - cur.sx, p.y - cur.sy) > 6) moved = true;
    if (ptrs.size >= 2 && lastPinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(b!.x - a!.x, b!.y - a!.y), cx = (a!.x + b!.x) / 2, cy = (a!.y + b!.y) / 2;
      zoomAt(cx, cy, d / lastPinch.d);
      view.tx += cx - lastPinch.cx;
      view.ty += cy - lastPinch.cy;
      lastPinch = { d, cx, cy };
      schedule();
      return;
    }
    if (!moved) return;
    if (moveGrid) {
      grid = { ...grid, ox: grid.ox + dx / view.k, oy: grid.oy + dy / view.k };
    } else {
      view.tx += dx;
      view.ty += dy;
      schedule();
    }
  }
  function onUp(e: PointerEvent) {
    const cur = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) lastPinch = null;
    if (cur && !moved && ptrs.size === 0) sel = cellAt(cur.x, cur.y);
  }
  function zoomAt(px: number, py: number, f: number) {
    const k = Math.min(40, Math.max(0.02, view.k * f));
    const ix = (px - view.tx) / view.k, iy = (py - view.ty) / view.k;
    view = { k, tx: px - ix * k, ty: py - iy * k };
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = cv!.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    schedule();
  }
  $effect(() => {
    const el = cv;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---- cell actions ----------------------------------------------------------------------------------
  const setSkip = (gi: number, on: boolean) => {
    const n = new Set(skip);
    if (on) n.add(gi); else n.delete(gi);
    skip = n;
  };
  function nudge(dx: number, dy: number) {
    if (sel === null) return;
    const cur = adj[sel] ?? { dx: 0, dy: 0 };
    adj = { ...adj, [sel]: { dx: cur.dx + dx, dy: cur.dy + dy } };
  }
  function metrics() {
    const s = project!.settings;
    return { ascender: s.ascender, descender: s.descender, capheight: s.capheight, defLsb: s.defLsb, defRsb: s.defRsb };
  }

  async function importCells(list: number[]) {
    if (!engine || !project) return;
    importing = { done: 0, total: list.length };
    let ok = 0, missing = 0;
    const done = new Set(imported);
    try {
      for (const gi of list) {
        const ch = charOf(gi);
        const glyph = ch ? store.glyphs.get(ch) : undefined;
        if (!glyph) missing++;
        else {
          const art = await engine.traceCell(params(), gi, metrics());
          if (art && art.contours.length) {
            store.saveGlyph(importArtInto(glyph, art, policy).glyph, true);
            done.add(gi);
            ok++;
          }
        }
        importing = { done: importing.done + 1, total: list.length };
      }
    } catch (e) {
      toast(t('scan.load.failed', { reason: String((e as Error)?.message ?? e) }), 'wn');
    } finally {
      importing = null;
      imported = done;
    }
    if (ok) {
      platform().haptic('success');
      toast(t('scan.import.done', { n: ok }), 'ok');
    } else toast(t('scan.import.none'), 'wn');
    if (missing) toast(t('scan.import.skipped', { n: missing }), 'if');
  }
  const importAll = () => importCells(cells.filter((c) => infos.get(c.gi)?.has && !skip.has(c.gi) && !imported.has(c.gi)).map((c) => c.gi));

  const selInfo = $derived(sel === null ? undefined : infos.get(sel));
  const stateLabel = (gi: number) => (skip.has(gi) ? 'scan.cell.skipped' : imported.has(gi) ? 'scan.cell.imported' : infos.get(gi)?.has ? 'scan.cell.ink' : 'scan.cell.blank');
  const scripts: ScriptTab[] = ['latin', 'bengali', 'digits', 'punct'];
  const projectChars = $derived([...store.glyphs.keys()]);
</script>

<TopBar title={t('scan.title')} subtitle={hasImage ? `${imgW}×${imgH}` : ''}>
  {#snippet actions()}
    {#if project}
      <button class="btn ghost" onclick={openFile}>{t('scan.open')}</button>
      <button class="btn ghost" onclick={takePhoto} aria-label={t('scan.camera')}><Icon name="camera" size={16} /></button>
    {/if}
  {/snippet}
</TopBar>

{#if !project}
  <NoProject />
{:else if !hasImage}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="empty" class:over={dragOver} ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)} ondrop={onDrop}>
    <h2>{loading ? t('scan.loading') : t('scan.empty.title')}</h2>
    <p>{t('scan.empty.body')}</p>
    <div class="row">
      <button class="btn primary" onclick={openFile} disabled={loading}>{t('scan.open')}</button>
      <button class="btn ghost" onclick={takePhoto} disabled={loading}><Icon name="camera" size={16} />{t('scan.camera')}</button>
    </div>
    <p class="hint">{t('scan.drop')}</p>
  </div>
{:else}
  <div class="sc">
    <div class="bar no-select">
      <button class="btn ghost" onclick={rotate}>{t('scan.rotate')}</button>
      {#if mode === 'template'}<button class="btn ghost" onclick={() => align(true)}>{t('scan.align')}</button>{/if}
      <button class="btn ghost" onclick={resetGrid}>{t('scan.reset')}</button>
      <button class="btn ghost" onclick={fitView}>{t('scan.fit')}</button>
      <button class="btn ghost" class:on={moveGrid} aria-pressed={moveGrid} onclick={() => (moveGrid = !moveGrid)}>{moveGrid ? t('scan.moveGrid') : t('scan.pan')}</button>
      {#if L.pages.length > 1}
        <span class="pages" role="group" aria-label="pages">
          {#each L.pages as _, i (i)}<button class="btn ghost" class:on={page === i + 1} aria-pressed={page === i + 1} onclick={() => { page = i + 1; sel = null; }}>{t('scan.page', { n: i + 1 })}</button>{/each}
        </span>
      {/if}
      <span class="sum mono" aria-live="polite">{t('scan.summary', summary)}</span>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="view no-select" bind:this={wrap} ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
      <canvas bind:this={cv} aria-label={t('scan.image')} onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}></canvas>
    </div>

    <div class="strip" role="listbox" aria-label={t('scan.cells')}>
      {#each cells as cell (cell.gi)}
        {@const info = infos.get(cell.gi)}
        <button class="cellbtn" class:sel={sel === cell.gi} class:ink={info?.has} class:done={imported.has(cell.gi)} class:skipped={skip.has(cell.gi)} role="option" aria-selected={sel === cell.gi} aria-label="{charOf(cell.gi)} {t(stateLabel(cell.gi))}" onclick={() => (sel = cell.gi)}>
          <CellThumb alpha={info?.thumb} size={48} />
          <span class="ch" lang={/[\u0980-\u09FF]/.test(charOf(cell.gi)) ? 'bn' : undefined}>{charOf(cell.gi) || cell.gi + 1}</span>
        </button>
      {/each}
    </div>

    <div class="panels">
      <section>
        <h4>{t('scan.mode')}</h4>
        <select class="input" bind:value={mode} aria-label={t('scan.mode')} onchange={() => { page = 1; resetGrid(); if (mode === 'template') void align(false); }}>
          <option value="template">{t('scan.mode.template')}</option>
          <option value="custom">{t('scan.mode.custom')}</option>
        </select>
        {#if mode === 'custom'}
          <div class="two">
            <label>{t('scan.cols')}<input class="input mono" type="number" min="1" max="20" bind:value={cols} /></label>
            <label>{t('scan.rows')}<input class="input mono" type="number" min="1" max="30" bind:value={rows} /></label>
          </div>
          <label>{t('scan.script')}
            <select class="input" bind:value={script}>{#each scripts as s (s)}<option value={s}>{t(`glyphs.tab.${s}`)}</option>{/each}</select>
          </label>
        {/if}
      </section>
      <section>
        <h4>{t('scan.threshold')}</h4>
        <label class="rng"><input type="range" min="40" max="230" bind:value={thr} aria-label={t('scan.threshold')} /><span class="mono">{thr}</span></label>
        <label class="rng"><span>{t('scan.trim')}</span><input type="range" min="0" max="6" step="0.5" bind:value={trim} aria-label={t('scan.trim')} /><span class="mono">{trim}</span></label>
        {#if mode === 'template'}<label class="chk"><input type="checkbox" bind:checked={labelStrip} />{t('scan.label')}</label>{/if}
      </section>
      <section>
        <h4>{t('scan.moveGrid')}</h4>
        <label class="rng"><span>{t('scan.gridOffsetX')}</span><input type="range" min="-200" max="200" step="1" value={grid.ox} oninput={(e) => (grid = { ...grid, ox: Number(e.currentTarget.value) })} /></label>
        <label class="rng"><span>{t('scan.gridOffsetY')}</span><input type="range" min="-200" max="200" step="1" value={grid.oy} oninput={(e) => (grid = { ...grid, oy: Number(e.currentTarget.value) })} /></label>
        <label class="rng"><span>{t('scan.gridScale')}</span><input type="range" min="0.8" max="1.2" step="0.001" value={grid.k} oninput={(e) => (grid = { ...grid, k: Number(e.currentTarget.value) })} /></label>
      </section>
      <section>
        <h4>{t('scan.inspector')}</h4>
        {#if sel === null}
          <p class="hint">{t('scan.cells')}</p>
        {:else}
          <div class="insp">
            <CellThumb alpha={selInfo?.thumb} size={96} />
            <div class="fields">
              <label>{t('scan.assign')}
                <select class="input" value={charOf(sel)} onchange={(e) => (assign = { ...assign, [sel!]: e.currentTarget.value })}>
                  {#each projectChars as c (c)}<option value={c}>{c}</option>{/each}
                </select>
              </label>
              <div class="nudge" role="group" aria-label={t('scan.nudge')}>
                <button class="btn ghost" aria-label="←" onclick={() => nudge(-0.5, 0)}>←</button>
                <button class="btn ghost" aria-label="↑" onclick={() => nudge(0, -0.5)}>↑</button>
                <button class="btn ghost" aria-label="↓" onclick={() => nudge(0, 0.5)}>↓</button>
                <button class="btn ghost" aria-label="→" onclick={() => nudge(0.5, 0)}>→</button>
              </div>
            </div>
          </div>
          <div class="row">
            <button class="btn ghost" onclick={() => setSkip(sel!, !skip.has(sel!))}>{skip.has(sel) ? t('scan.unskip') : t('scan.skip')}</button>
            <button class="btn primary" onclick={() => importCells([sel!])} disabled={!!importing || !selInfo?.has}>{t('scan.import.selected')}</button>
          </div>
        {/if}
      </section>
      <section>
        <h4>{t('scan.import.policy')}</h4>
        <select class="input" bind:value={policy} aria-label={t('scan.import.policy')}>
          <option value="variant">{t('scan.import.policy.variant')}</option>
          <option value="replace">{t('scan.import.policy.replace')}</option>
        </select>
        <button class="btn primary wide" onclick={importAll} disabled={!!importing || summary.ink === 0}>
          {importing ? t('scan.import.running', importing) : t('scan.import.all')}
        </button>
      </section>
    </div>
  </div>
{/if}

<style>
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px; text-align: center; border: 2px dashed transparent; margin: 16px; border-radius: var(--r3); }
  .empty.over { border-color: var(--accent); background: var(--abg); }
  h2 { font-size: 18px; }
  .empty p { font-size: 13px; color: var(--text2); max-width: 420px; line-height: 1.5; }
  .empty .hint { color: var(--text3); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .sc { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
  .bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 8px 12px; background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .bar .btn.on { background: var(--abg); border-color: var(--aborder); color: var(--accent2); }
  .pages { display: inline-flex; gap: 4px; }
  .sum { margin-left: auto; font-size: 11px; color: var(--text3); }
  .view { position: relative; flex: 1 0 300px; min-height: 300px; background: var(--bg3); overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  .strip { display: flex; gap: 6px; overflow-x: auto; padding: 8px 12px; background: var(--bg2); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .cellbtn { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; border-radius: var(--r); border: 2px solid var(--border); background: var(--bg3); min-width: 58px; min-height: var(--tap); }
  .cellbtn.ink { border-color: var(--aborder); }
  .cellbtn.done { border-color: #22c55e; }
  .cellbtn.skipped { border-style: dashed; border-color: var(--red); opacity: 0.6; }
  .cellbtn.sel { border-color: var(--accent); background: var(--abg); }
  .ch { font-size: 12px; color: var(--text2); }
  .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0; flex-shrink: 0; }
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: grid; gap: 8px; align-content: start; }
  h4 { font-size: 11px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.8px; }
  label { display: grid; gap: 4px; font-size: 12px; color: var(--text2); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rng { display: flex; align-items: center; gap: 8px; }
  .rng input[type='range'] { flex: 1; accent-color: var(--accent); min-width: 80px; }
  .rng .mono { color: var(--accent2); min-width: 30px; text-align: right; }
  .chk { display: flex; align-items: center; gap: 8px; }
  .chk input { accent-color: var(--accent); width: 18px; height: 18px; }
  .insp { display: flex; gap: 10px; align-items: flex-start; }
  .fields { display: grid; gap: 8px; flex: 1; }
  .nudge { display: flex; gap: 4px; }
  .nudge .btn { padding: 0 12px; }
  .wide { width: 100%; }
</style>
