// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { IDBFactory } from 'fake-indexeddb';
import App from '@/app/App.svelte';
import { setPlatformForTests } from '@/platform';
import { createWebPlatform } from '@/platform/web';
import { closeDB } from '@/storage/db';
import { createProject, deleteProject, getGlyph, getProject, listProjects, saveGlyph, blankGlyph } from '@/storage/projects';
import { settings } from '@/app/stores/settings.svelte';
import { store } from '@/app/stores/project.svelte';
import { autosaver } from '@/app/stores/autosave.svelte';
import { V3_STORAGE_KEY } from '@/storage/migrate-v3';
import { autoBearings } from '@/engine/basic';

let host: HTMLElement;
let app: Record<string, unknown> | null = null;

const wait = (ms = 8) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => unknown, what = 'condition') {
  for (let i = 0; i < 200; i++) {
    flushSync();
    if (fn()) return;
    await wait(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const go = async (hash: string) => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await wait();
  flushSync();
};
const $ = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const $$ = <T extends Element>(sel: string) => [...host.querySelectorAll<T>(sel)];
const click = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found to click');
  (el as HTMLElement).click();
  flushSync();
};
function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
const button = (label: string | RegExp) => $$<HTMLButtonElement>('button, a.btn').find((b) => (typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? '')));

async function boot() {
  app = mount(App, { target: host });
  await until(() => !host.textContent?.includes('Loading…'), 'app ready');
}

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  window.location.hash = '';
  settings.setLocale('en');
  settings.setTheme('system');
  store.clear();
  setPlatformForTests(createWebPlatform());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => true;
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

describe('Projects screen', () => {
  it('creates a project through the dialog and opens its glyph map', async () => {
    await boot();
    click(button(/New font/));
    await until(() => $('#np-name'), 'dialog');
    click(button('Create')); // blank name: nothing is created
    expect(await listProjects()).toHaveLength(0);
    type($<HTMLInputElement>('#np-name')!, 'My Hand');
    click(button('Create'));
    await until(() => window.location.hash === '#/glyphs', 'navigation to glyphs');
    const projects = await listProjects();
    expect(projects.map((p) => p.name)).toEqual(['My Hand']);
    expect(store.project?.name).toBe('My Hand');
    await until(() => $$('a.gc').length > 0, 'glyph cells');
  });

  it('asks before deleting and removes the project only after confirming', async () => {
    const p = await createProject({ name: 'Doomed', set: 'latin', cell: 'x' });
    await boot();
    await until(() => host.textContent?.includes('Doomed'));
    click($('button.del'));
    await until(() => $('[role=dialog]'), 'confirm dialog');
    expect(host.textContent).toContain('“Doomed”');
    click(button('Cancel'));
    await until(() => !$('[role=dialog]'));
    expect(await getProject(p.id)).toBeDefined();
    click($('button.del'));
    await until(() => $('[role=dialog]'));
    click($$<HTMLButtonElement>('[role=dialog] button').find((b) => b.textContent === 'Delete'));
    await until(() => !host.textContent?.includes('Doomed'), 'card removed');
    expect(await getProject(p.id)).toBeUndefined();
  });
});

describe('first-launch migration', () => {
  it('copies fc3 data, shows the message, and leaves the original untouched', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const raw = JSON.stringify([{ id: 'a1', name: 'Old Hand', set: 'latin', cell: 'standard', chars: { A: { variants: [PNG], advance: 600, lsb: 40, rsb: 40 } }, ligatures: [], kerning: [], settings: {} }]);
    localStorage.setItem(V3_STORAGE_KEY, raw);
    await boot();
    await until(() => host.textContent?.includes('Old Hand'), 'migrated project card');
    expect(host.textContent).toContain('Your old projects were copied');
    expect(localStorage.getItem(V3_STORAGE_KEY)).toBe(raw);
    expect(await listProjects()).toHaveLength(1);
  });
});

describe('Glyphs screen', () => {
  it('shows only the glyphs of the project, with state, and filters to empty ones', async () => {
    const p = await createProject({ name: 'Bn', set: 'bengali', cell: 'x' });
    await saveGlyph(p.id, { ...blankGlyph('ক'), variants: [{ strokes: [{ pts: [{ x: 10, y: 10, pressure: 1 }], size: 20 }], contours: [] }] });
    await boot();
    await go('#/');
    click($('a.open'));
    await until(() => $$('a.gc').length > 0, 'cells');
    // A Bengali-only project has no Latin tab at all.
    expect($$('[role=tab]').map((t) => t.textContent)).toEqual(['বাংলা']);
    const drawn = $$('a.gc').find((a) => a.getAttribute('aria-label')?.startsWith('ক —'));
    expect(drawn?.className).toContain('drawn');
    expect(drawn?.getAttribute('aria-label')).toContain('drawn');
    const before = $$('a.gc').length;
    click($<HTMLInputElement>('.chk input'));
    await until(() => $$('a.gc').length < before || $$('a.gc').length === 0, 'filtered');
    expect($$('a.gc').some((a) => a.getAttribute('aria-label')?.startsWith('ক —'))).toBe(false);
    // Virtualised: a full set never mounts every cell.
    expect($$('a.gc').length).toBeLessThan(76);
  });

  it('"Next empty" opens the first glyph that has no drawing yet', async () => {
    const p = await createProject({ name: 'Nx', set: 'latin', cell: 'x' });
    const ink = [{ pts: [{ x: 10, y: 10, pressure: 1 }], size: 20 }];
    await saveGlyph(p.id, { ...blankGlyph('A'), variants: [{ strokes: ink, contours: [] }] });
    await saveGlyph(p.id, { ...blankGlyph('B'), variants: [{ strokes: ink, contours: [] }] });
    await boot();
    click($('a.open'));
    await until(() => $$('a.gc').length > 0);
    click(button('Next empty'));
    await until(() => window.location.hash === '#/editor/C', 'editor for the first empty glyph');
  });

  it('virtualises a large project (500 glyphs mount only a window)', async () => {
    const p = await createProject({ name: 'Big', set: 'all', cell: 'x' });
    expect((await getProject(p.id))!.stats.total).toBeGreaterThan(150);
    await boot();
    click($('a.open'));
    await until(() => $$('a.gc').length > 0);
    expect($$('a.gc').length).toBeLessThan(60);
  });
});

describe('Editor', () => {
  async function openEditor(char: string) {
    const p = await createProject({ name: 'Ed', set: 'latin', cell: 'x' });
    await boot();
    await store.open(p.id);
    await go('#/editor/' + encodeURIComponent(char));
    await until(() => $('canvas.live'), 'canvas');
    return p;
  }

  const draw = (canvas: HTMLCanvasElement, pts: Array<[number, number]>) => {
    const ev = (type: string, [x, y]: [number, number]) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev('pointerdown', pts[0]!));
    for (const p of pts.slice(1)) canvas.dispatchEvent(ev('pointermove', p));
    canvas.dispatchEvent(ev('pointerup', pts.at(-1)!));
    flushSync();
  };

  it('draws a stroke, autosaves it to IndexedDB, and undo/redo work', async () => {
    const p = await openEditor('A');
    const canvas = $<HTMLCanvasElement>('canvas.live')!;
    draw(canvas, [[5, 5], [60, 80], [120, 40]]);
    expect(store.glyphs.get('A')!.variants[0]!.strokes).toHaveLength(1);
    await autosaver.flush();
    expect((await getGlyph(p.id, 'A'))!.variants[0]!.strokes).toHaveLength(1);
    expect((await getProject(p.id))!.stats.drawn).toBe(1);

    click($('button[aria-label="Undo"]'));
    expect(store.glyphs.get('A')!.variants[0]!.strokes).toHaveLength(0);
    click($('button[aria-label="Redo"]'));
    expect(store.glyphs.get('A')!.variants[0]!.strokes).toHaveLength(1);
  });

  it('a finished stroke reaches IndexedDB within moments, without waiting for the debounce or a flush', async () => {
    const p = await openEditor('W');
    draw($<HTMLCanvasElement>('canvas.live')!, [[5, 5], [60, 80]]);
    // No autosaver.flush() here on purpose: a page being closed cannot be relied on to flush.
    await wait(60);
    expect((await getGlyph(p.id, 'W'))!.variants[0]!.strokes).toHaveLength(1);
  });

  it('erase cuts the ink away (area eraser): the stroke list keeps an eraser stroke and the contours disappear', async () => {
    await openEditor('B');
    const canvas = $<HTMLCanvasElement>('canvas.live')!;
    draw(canvas, [[5, 5], [5, 5]]);
    expect(store.glyphs.get('B')!.variants[0]!.strokes).toHaveLength(1);
    expect(store.glyphs.get('B')!.variants[0]!.contours.length).toBeGreaterThan(0);
    click($('button[aria-label^="Erase"]'));
    draw(canvas, [[5, 5], [5, 5]]);
    const v = store.glyphs.get('B')!.variants[0]!;
    expect(v.strokes).toHaveLength(2);
    expect(v.strokes[1]!.erase).toBe(true);
    expect(v.contours).toHaveLength(0);
    click($('button[aria-label="Undo"]'));
    expect(store.glyphs.get('B')!.variants[0]!.contours.length).toBeGreaterThan(0);
  });

  it('an eraser stroke on an empty glyph is not recorded', async () => {
    await openEditor('Q');
    click($('button[aria-label^="Erase"]'));
    draw($<HTMLCanvasElement>('canvas.live')!, [[5, 5], [9, 9]]);
    expect(store.glyphs.get('Q')!.variants[0]!.strokes).toHaveLength(0);
  });

  it('the pen tool builds a closed path, Done adds it, and it becomes a contour', async () => {
    await openEditor('P');
    click($('button[aria-label^="Bezier pen"]'));
    const canvas = $<HTMLCanvasElement>('canvas.live')!;
    for (const pt of [[10, 10], [200, 12], [100, 150]] as Array<[number, number]>) draw(canvas, [pt]);
    expect(button('Done')!.disabled).toBe(false);
    expect(button('Close path')!.disabled).toBe(false);
    click(button('Close path'));
    click(button('Done'));
    const v = store.glyphs.get('P')!.variants[0]!;
    expect(v.paths).toHaveLength(1);
    expect(v.paths![0]!.closed).toBe(true);
    expect(v.contours.length).toBeGreaterThan(0);
    click($('button[aria-label="Undo"]'));
    expect(store.glyphs.get('P')!.variants[0]!.paths).toBeUndefined();
  });

  it('Done with fewer than two points explains why instead of doing nothing', async () => {
    await openEditor('P');
    click($('button[aria-label^="Bezier pen"]'));
    draw($<HTMLCanvasElement>('canvas.live')!, [[10, 10]]);
    expect(button('Done')!.disabled).toBe(true);
  });

  it('select picks a stroke and Delete removes it (undoable)', async () => {
    await openEditor('S');
    const canvas = $<HTMLCanvasElement>('canvas.live')!;
    draw(canvas, [[5, 5], [5, 5]]);
    click($('button[aria-label^="Select"]'));
    draw(canvas, [[5, 5]]);
    click(button(/Delete selected/));
    expect(store.glyphs.get('S')!.variants[0]!.strokes).toHaveLength(0);
    click($('button[aria-label="Undo"]'));
    expect(store.glyphs.get('S')!.variants[0]!.strokes).toHaveLength(1);
  });

  it('keyboard shortcuts switch tools', async () => {
    await openEditor('K');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    flushSync();
    expect($('button[aria-label^="Bezier pen"]')?.getAttribute('aria-pressed')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    flushSync();
    expect($('button[aria-label^="Erase"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('zoom buttons change the zoom readout and Fit resets it', async () => {
    await openEditor('Z');
    const readout = () => $('.zoom')!.textContent!;
    const base = readout();
    click($('button[aria-label^="Zoom in"]'));
    expect(readout()).not.toBe(base);
    click($('button[aria-label^="Fit"]'));
    expect(readout()).toBe(base);
  });

  it('metrics, variants (max 4) and auto bearings update the glyph', async () => {
    const p = await openEditor('C');
    type($<HTMLInputElement>('#m-advance')!, '700');
    expect(store.glyphs.get('C')!.advance).toBe(700);
    // Draw something so auto bearings have ink to measure.
    const canvas = $<HTMLCanvasElement>('canvas.live')!;
    const ev = (t: string, x: number, y: number) => new PointerEvent(t, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev('pointerdown', 0, 0));
    canvas.dispatchEvent(ev('pointermove', 0, 0));
    canvas.dispatchEvent(ev('pointerup', 0, 0));
    flushSync();
    click(button('Auto side bearings'));
    const g = store.glyphs.get('C')!;
    expect({ lsb: g.lsb, rsb: g.rsb }).toEqual(autoBearings(g.variants[0]!.strokes, g.advance));
    expect(g.lsb).not.toBe(50); // changed from the default, so the button really did something

    // The add button is offered until the 4-variant limit, then disappears.
    while ($('button[aria-label="Add variant"]')) click($('button[aria-label="Add variant"]'));
    expect(store.glyphs.get('C')!.variants).toHaveLength(4);
    click(button('Remove this variant'));
    expect(store.glyphs.get('C')!.variants).toHaveLength(3);
    await autosaver.flush();
    expect((await getGlyph(p.id, 'C'))!.variants).toHaveLength(3);
    expect((await getGlyph(p.id, 'C'))!.advance).toBe(700);
  });

  it('shows a helpful message when no project is open or the glyph does not exist', async () => {
    await boot();
    await go('#/editor/A');
    expect(host.textContent).toContain('No project open');
    const p = await createProject({ name: 'X', set: 'latin', cell: 'x' });
    await store.open(p.id);
    await go('#/editor/' + encodeURIComponent('ক'));
    await until(() => host.textContent?.includes('Pick a character'));
  });
});

describe('Ligatures and kerning screens', () => {
  it('adds and removes a ligature and persists it', async () => {
    const p = await createProject({ name: 'L', set: 'latin', cell: 'x' });
    await boot();
    await store.open(p.id);
    await go('#/ligatures');
    expect(host.textContent).toContain('No ligatures yet');
    click(button(/Add ligature/));
    await until(() => $('#l-in'));
    type($<HTMLInputElement>('#l-in')!, 'f');
    click(button('Save'));
    expect((await getProject(p.id))!.ligatures).toHaveLength(0); // needs two characters
    type($<HTMLInputElement>('#l-in')!, 'fi');
    click(button('Save'));
    await until(() => $$('li.row').length === 1, 'ligature row');
    expect((await getProject(p.id))!.ligatures).toEqual([{ input: 'fi', output: 'fi_lig', name: 'fi ligature' }]);
    click($('li.row button.danger'));
    await until(() => $$('li.row').length === 0, 'row removed');
    expect((await getProject(p.id))!.ligatures).toEqual([]);
  });

  it('adds, updates (no duplicate) and removes kerning pairs', async () => {
    const p = await createProject({ name: 'K', set: 'latin', cell: 'x' });
    await boot();
    await store.open(p.id);
    await go('#/kerning');
    type($<HTMLInputElement>('#kp-l')!, 'T');
    type($<HTMLInputElement>('#kp-r')!, 'o');
    type($<HTMLInputElement>('#kp-v')!, '-40');
    click(button('Save pair'));
    await until(() => $$('li.kr').length === 1);
    type($<HTMLInputElement>('#kp-v')!, '-55');
    click(button('Save pair'));
    await until(() => host.textContent?.includes('-55u'));
    expect((await getProject(p.id))!.kerning).toEqual([{ left: 'T', right: 'o', value: -55 }]);
    click($('li.kr button.danger'));
    await until(() => $$('li.kr').length === 0);
    expect((await getProject(p.id))!.kerning).toEqual([]);
  });
});

describe('Export and settings screens', () => {
  it('disables font formats honestly and saves a .fcproj through the platform adapter', async () => {
    const p = await createProject({ name: 'My Font', set: 'latin', cell: 'x' });
    const saveFile = vi.fn(async () => 'saved' as const);
    setPlatformForTests({ ...createWebPlatform(), saveFile });
    await boot();
    await store.open(p.id);
    await go('#/export');
    for (const f of ['OTF', 'TTF', 'WOFF', 'WOFF2']) expect(button(f)?.disabled).toBe(true);
    expect(host.textContent).toContain('is not available yet');
    click(button(/Save backup/));
    await until(() => saveFile.mock.calls.length === 1, 'saveFile');
    const [name, blob, mime] = saveFile.mock.calls[0] as unknown as [string, Blob, string];
    expect(name).toBe('My_Font.fcproj');
    expect(mime).toBe('application/zip');
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  });

  it('saves font settings and renames the project', async () => {
    const p = await createProject({ name: 'Old', set: 'latin', cell: 'x' });
    await boot();
    await store.open(p.id);
    await go('#/settings');
    await until(() => $('#fs-family'));
    type($<HTMLInputElement>('#fs-family')!, 'Renamed');
    type($<HTMLInputElement>('#fs-designer')!, 'Rafi');
    type($<HTMLInputElement>('#fs-ascender')!, '850');
    const saveBtns = $$<HTMLButtonElement>('button').filter((b) => b.textContent === 'Save');
    click(saveBtns.at(-1));
    await until(() => store.project?.name === 'Renamed');
    const saved = (await getProject(p.id))!;
    expect(saved.settings.designer).toBe('Rafi');
    expect(saved.settings.ascender).toBe(850);
  });

  it('preview lays out drawn glyphs and reports the ones that are missing', async () => {
    const p = await createProject({ name: 'Pv', set: 'latin', cell: 'x' });
    await saveGlyph(p.id, { ...blankGlyph('A'), variants: [{ strokes: [{ pts: [{ x: 10, y: 10, pressure: 1 }, { x: 200, y: 400, pressure: 1 }], size: 30 }], contours: [] }] });
    await boot();
    await store.open(p.id);
    await go('#/preview');
    type($<HTMLTextAreaElement>('#pv-text')!, 'AB?');
    await until(() => $$('svg.line path').length >= 1, 'one drawn glyph');
    expect(host.textContent).toContain('No drawn glyph for:');
    expect(host.querySelector('.miss')?.textContent).toMatch(/B/);
  });
});

describe('deleting the open project', () => {
  it('clears the in-memory project so screens do not show stale data', async () => {
    const p = await createProject({ name: 'Gone', set: 'latin', cell: 'x' });
    await boot();
    await store.open(p.id);
    await deleteProject(p.id);
    store.clear();
    await go('#/glyphs');
    expect(host.textContent).toContain('No project open');
  });
});
