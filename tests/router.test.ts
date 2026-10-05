import { describe, expect, it } from 'vitest';
import { createRouter, hrefFor, parseHash } from '@/app/router';

describe('parseHash / hrefFor', () => {
  it('maps the empty hash and unknown paths to the dashboard', () => {
    expect(parseHash('')).toEqual({ name: 'dashboard' });
    expect(parseHash('#/')).toEqual({ name: 'dashboard' });
    expect(parseHash('#/nope')).toEqual({ name: 'dashboard' });
  });

  it('parses every named route', () => {
    for (const name of ['glyphs', 'editor', 'scan', 'ligatures', 'kerning', 'preview', 'export', 'settings'] as const) {
      expect(parseHash(`#/${name}`)).toEqual({ name });
    }
  });

  it('round-trips a Bengali character parameter', () => {
    const route = { name: 'editor', param: 'ক্ষ' } as const;
    const href = hrefFor(route);
    expect(href).toBe('#/editor/' + encodeURIComponent('ক্ষ'));
    expect(parseHash(href)).toEqual(route);
  });

  it('round-trips characters that are special in URLs', () => {
    for (const ch of ['/', '#', '?', '%', '\\', ' ']) {
      expect(parseHash(hrefFor({ name: 'editor', param: ch }))).toEqual({ name: 'editor', param: ch });
    }
  });

  it('ignores a malformed escape instead of throwing', () => {
    expect(parseHash('#/editor/%E0%A4%A')).toEqual({ name: 'editor' });
  });
});

describe('createRouter', () => {
  function fakeWindow() {
    const listeners = new Set<() => void>();
    const loc = { hash: '' };
    return {
      location: {
        get hash() {
          return loc.hash;
        },
        set hash(v: string) {
          loc.hash = v;
          listeners.forEach((l) => l());
        },
        replace(v: string) {
          loc.hash = v;
        },
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      fire: () => listeners.forEach((l) => l()),
    };
  }

  it('notifies subscribers immediately and on change, and stops after unsubscribe', () => {
    const win = fakeWindow();
    const router = createRouter(win as never);
    const seen: string[] = [];
    const off = router.subscribe((r) => seen.push(r.name));
    router.navigate({ name: 'scan' });
    router.navigate({ name: 'export' });
    off();
    router.navigate({ name: 'kerning' });
    expect(seen).toEqual(['dashboard', 'scan', 'export']);
    expect(router.current().name).toBe('kerning');
  });

  it('replace() changes the route without notifying until hashchange fires', () => {
    const win = fakeWindow();
    const router = createRouter(win as never);
    router.navigate({ name: 'settings' }, { replace: true });
    expect(router.current().name).toBe('settings');
  });
});
