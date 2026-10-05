// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { IDBFactory } from 'fake-indexeddb';
import { renderTemplate, stem } from './helpers/scanFixture';
import { scLayout } from '@/scan/scan-core';

const layoutL = scLayout({ mode: 'template', project: { set: 'latin', cell: 'medium' } });
// A slightly misaligned photograph with handwriting in the first three boxes.
const photo = renderTemplate(layoutL, 1, { scale: 1.02, dx: 3, dy: 2, ink: (gi) => (gi < 3 ? stem() : null) });
vi.mock('@/scan/decode', () => ({
  MAX_SIDE: 5000,
  decodeToRGBA: vi.fn(async () => ({ width: photo.width, height: photo.height, data: new Uint8ClampedArray(photo.data) })),
}));

import App from '@/app/App.svelte';
import { setPlatformForTests } from '@/platform';
import { createWebPlatform } from '@/platform/web';
import { closeDB } from '@/storage/db';
import { createProject, getGlyph } from '@/storage/projects';
import { settings } from '@/app/stores/settings.svelte';
import { store } from '@/app/stores/project.svelte';
import { autosaver } from '@/app/stores/autosave.svelte';
import { isGlyphDrawn } from '@/storage/types';

let host: HTMLElement;
let app: Record<string, unknown> | null = null;
const wait = (ms = 8) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => unknown, what = 'condition', ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    flushSync();
    if (fn()) return;
    await wait(15);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const $$ = <T extends Element>(sel: string) => [...host.querySelectorAll<T>(sel)];
const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const button = (label: string | RegExp) => $$<HTMLButtonElement>('button').find((b) => (typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? '')));
const click = (el?: Element | null) => { if (!el) throw new Error('nothing to click'); (el as HTMLElement).click(); flushSync(); };
const go = async (hash: string) => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); await wait(); flushSync(); };

async function openScanScreen() {
  const p = await createProject({ name: 'Scan Me', set: 'latin', cell: 'medium' });
  app = mount(App, { target: host });
  await until(() => !host.textContent?.includes('Loading…'), 'app ready');
  await store.open(p.id);
  setPlatformForTests({ ...createWebPlatform(), openFile: async () => new File([new Uint8Array([1])], 'page.png', { type: 'image/png' }) });
  await go('#/scan');
  click(button('Open scan or photo'));
  await until(() => $$('button.cellbtn').length > 0, 'cells to appear');
  return p;
}

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  window.location.hash = '';
  settings.setLocale('en');
  store.clear();
  setPlatformForTests(createWebPlatform());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(async () => {
  await autosaver.flush();
  if (app) await unmount(app);
  app = null;
  host.remove();
  setPlatformForTests(null);
  store.clear();
  await closeDB();
});

describe('Scan screen', () => {
  it('without a project it asks for one', async () => {
    app = mount(App, { target: host });
    await until(() => !host.textContent?.includes('Loading…'));
    await go('#/scan');
    expect(host.textContent).toContain('No project open');
  });

  it('with a project it invites you to open a scan or take a photo', async () => {
    const p = await createProject({ name: 'X', set: 'latin', cell: 'medium' });
    app = mount(App, { target: host });
    await until(() => !host.textContent?.includes('Loading…'));
    await store.open(p.id);
    await go('#/scan');
    expect(host.textContent).toContain('Bring in your handwriting');
    expect(button('Open scan or photo')).toBeDefined();
    expect(button(/Take photo/)).toBeDefined();
  });

  it('opens an image, aligns the grid, and flags exactly the boxes that have handwriting', async () => {
    await openScanScreen();
    expect($$('button.cellbtn')).toHaveLength(20); // page 1 of the template
    await until(() => $$('button.cellbtn.ink').length === 3, 'three inked cells');
    expect($$('button.cellbtn.ink').map((b) => b.getAttribute('aria-label')?.charAt(0))).toEqual(['A', 'B', 'C']);
    expect(host.textContent).toContain('3 of 20 cells have handwriting');
    expect($$('[role=group][aria-label=pages] button')).toHaveLength(3); // 52 characters span three pages
  });

  it('Import all turns the handwriting into traced vector glyphs saved in the project', async () => {
    const p = await openScanScreen();
    await until(() => $$('button.cellbtn.ink').length === 3);
    click(button(/Import all with handwriting/));
    await until(() => $$('button.cellbtn.done').length === 3, 'three imported cells', 8000);
    const a = store.glyphs.get('A')!;
    expect(isGlyphDrawn(a)).toBe(true);
    expect(a.variants[0]!.traced!.length).toBeGreaterThan(0);
    expect(a.variants[0]!.contours.length).toBeGreaterThan(0);
    expect(a.variants[0]!.strokes).toEqual([]); // vector art, not a picture and not raw strokes
    expect(a.lsb).toBe(50);
    expect(a.advance).toBeGreaterThan(100);
    await autosaver.flush();
    expect((await getGlyph(p.id, 'B'))!.variants[0]!.traced!.length).toBeGreaterThan(0);
    expect(store.glyphs.get('D')!.variants[0]!.traced).toBeUndefined();
    expect(host.textContent).toContain('3 imported');
  });

  it('the traced glyph is where the guide lines say: top near the cap height, bottom near the baseline', async () => {
    await openScanScreen();
    await until(() => $$('button.cellbtn.ink').length === 3);
    click(button(/Import all with handwriting/));
    await until(() => $$('button.cellbtn.done').length === 3, 'imported', 8000);
    const ys = store.glyphs.get('A')!.variants[0]!.contours.flatMap((c) => c.nodes.map((n) => n.p.y));
    expect(Math.max(...ys)).toBeGreaterThan(630);
    expect(Math.max(...ys)).toBeLessThan(760);
    expect(Math.min(...ys)).toBeGreaterThan(-40);
  });

  it('a skipped cell is left out of Import all', async () => {
    await openScanScreen();
    await until(() => $$('button.cellbtn.ink').length === 3);
    click($$('button.cellbtn')[1]); // select B
    click(button('Skip this cell'));
    await until(() => $$('button.cellbtn.skipped').length === 1);
    click(button(/Import all with handwriting/));
    await until(() => $$('button.cellbtn.done').length === 2, 'two imported', 8000);
    expect(isGlyphDrawn(store.glyphs.get('B')!)).toBe(false);
    expect(isGlyphDrawn(store.glyphs.get('A')!)).toBe(true);
  });

  it('importing a cell onto a glyph that already has a drawing adds another variant (up to four)', async () => {
    await openScanScreen();
    await until(() => $$('button.cellbtn.ink').length === 3);
    click(button(/Import all with handwriting/));
    await until(() => $$('button.cellbtn.done').length === 3, 'first import', 8000);
    click($$('button.cellbtn')[0]);
    click(button('Import this cell'));
    await until(() => store.glyphs.get('A')!.variants.length === 2, 'second variant', 8000);
    expect(store.glyphs.get('A')!.variants[1]!.traced!.length).toBeGreaterThan(0);
    expect(store.glyphs.get('A')!.variants[0]!.traced!.length).toBeGreaterThan(0);
  });

  it('a cell can be saved under a different character', async () => {
    await openScanScreen();
    await until(() => $$('button.cellbtn.ink').length === 3);
    click($$('button.cellbtn')[0]);
    const select = $$<HTMLSelectElement>('select').find((s) => s.getAttribute('aria-label') === null && [...s.options].some((o) => o.value === 'Z'))!;
    select.value = 'Z';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    click(button('Import this cell'));
    await until(() => isGlyphDrawn(store.glyphs.get('Z')!), 'Z drawn', 8000);
    expect(isGlyphDrawn(store.glyphs.get('A')!)).toBe(false);
  });

  it('a failing image shows a clear message and keeps the invitation', async () => {
    const { decodeToRGBA } = await import('@/scan/decode');
    vi.mocked(decodeToRGBA).mockRejectedValueOnce(new Error('unsupported image'));
    const p = await createProject({ name: 'Bad', set: 'latin', cell: 'medium' });
    app = mount(App, { target: host });
    await until(() => !host.textContent?.includes('Loading…'));
    await store.open(p.id);
    setPlatformForTests({ ...createWebPlatform(), openFile: async () => new File([new Uint8Array([1])], 'x.png') });
    await go('#/scan');
    click(button('Open scan or photo'));
    await until(() => host.textContent?.includes('Could not open that image: unsupported image'), 'error toast');
    expect(button('Open scan or photo')).toBeDefined();
  });

  it('moving the grid sideways makes the scanner read the wrong place, and moving it back fixes it', async () => {
    await openScanScreen();
    await until(() => $$('button.cellbtn.ink').length === 3);
    const labels = () => $$('button.cellbtn.ink').map((b) => b.getAttribute('aria-label')?.charAt(0)).join('');
    const slider = $$<HTMLInputElement>('input[type=range]').find((i) => i.parentElement?.textContent?.includes('Grid left/right'))!;
    const set = (v: string) => { slider.value = v; slider.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };
    set('200');
    await until(() => labels() !== 'ABC', 'a different reading');
    set('0');
    await until(() => labels() === 'ABC', 'the original reading again');
  });
});
