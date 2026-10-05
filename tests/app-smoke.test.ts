// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { IDBFactory } from 'fake-indexeddb';
import App from '@/app/App.svelte';
import { setPlatformForTests } from '@/platform';
import { createWebPlatform } from '@/platform/web';
import { closeDB } from '@/storage/db';
import { createProject } from '@/storage/projects';
import { settings } from '@/app/stores/settings.svelte';

let host: HTMLElement;
let app: Record<string, unknown> | null = null;

const settle = async () => {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 8));
    flushSync();
  }
};

beforeEach(async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  window.location.hash = '';
  settings.setLocale('en');
  settings.setTheme('system');
  setPlatformForTests(createWebPlatform());
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (app) await unmount(app);
  app = null;
  host.remove();
  setPlatformForTests(null);
  await closeDB();
});

describe('App shell', () => {
  it('mounts, shows the empty-state welcome and both navigation bars', async () => {
    app = mount(App, { target: host });
    await settle();
    expect(host.textContent).toContain('Welcome to FontCraft');
    expect(host.querySelector('nav.rail')).not.toBeNull();
    expect(host.querySelector('nav.bottom')).not.toBeNull();
    // Bottom nav follows the plan: Projects, Glyphs, Scan, Preview, Export.
    const labels = [...host.querySelectorAll('nav.bottom a')].map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Projects', 'Glyphs', 'Scan', 'Preview', 'Export']);
  });

  it('lists existing projects from IndexedDB with progress counters', async () => {
    await createProject({ name: 'Rafi Hand', set: 'latin', cell: 'x' });
    app = mount(App, { target: host });
    await settle();
    expect(host.textContent).toContain('Rafi Hand');
    expect(host.textContent).toContain('0/52');
    expect(host.textContent).toContain('1 project');
  });

  it('navigates by hash and marks the active item', async () => {
    app = mount(App, { target: host });
    await settle();
    window.location.hash = '#/scan';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    expect(host.textContent).toContain('No project open'); // the scanner needs a project
    const active = host.querySelector('nav.rail a[aria-current="page"]');
    expect(active?.getAttribute('aria-label')).toBe('Scan');
  });

  it('the editor route keeps Glyphs highlighted on the phone nav', async () => {
    app = mount(App, { target: host });
    window.location.hash = '#/editor/' + encodeURIComponent('ক');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    const active = host.querySelector('nav.bottom a[aria-current="page"]');
    expect(active?.textContent?.trim()).toBe('Glyphs');
  });

  it('switching to Bengali re-renders labels and persists the choice', async () => {
    app = mount(App, { target: host });
    window.location.hash = '#/settings';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    const select = host.querySelector<HTMLSelectElement>('#lang')!;
    select.value = 'bn';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(document.documentElement.lang).toBe('bn');
    expect(host.querySelector('nav.bottom')?.textContent).toContain('প্রকল্প');
    expect(JSON.parse(localStorage.getItem('fc4.settings')!).locale).toBe('bn');
  });

  it('theme choice is applied to the document element', async () => {
    app = mount(App, { target: host });
    window.location.hash = '#/settings';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    const select = host.querySelector<HTMLSelectElement>('#theme')!;
    select.value = 'light';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    select.value = 'system';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('the back handler returns to Projects from another screen, and defers at the root', async () => {
    const base = createWebPlatform();
    const handlers: Array<() => boolean> = [];
    setPlatformForTests({
      ...base,
      onBack: (h) => {
        handlers.push(h);
        return () => handlers.splice(handlers.indexOf(h), 1);
      },
    });
    app = mount(App, { target: host });
    window.location.hash = '#/export';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();

    expect(handlers).toHaveLength(1);
    // On a non-root screen the handler consumes the event and navigates to Projects.
    expect(handlers[0]!()).toBe(true);
    expect(window.location.hash).toBe('#/');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    // At the root it declines, so the platform can minimise the app.
    expect(handlers[0]!()).toBe(false);
  });

  it('unregisters its handlers when unmounted', async () => {
    const base = createWebPlatform();
    const handlers: Array<() => boolean> = [];
    setPlatformForTests({
      ...base,
      onBack: (h) => {
        handlers.push(h);
        return () => handlers.splice(handlers.indexOf(h), 1);
      },
    });
    app = mount(App, { target: host });
    await settle();
    expect(handlers).toHaveLength(1);
    await unmount(app);
    app = null;
    expect(handlers).toHaveLength(0);
  });
});
