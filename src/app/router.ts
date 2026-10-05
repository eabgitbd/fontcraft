// Tiny hash router. Works on GitHub Pages and inside Capacitor without any server config.

export type RouteName = 'dashboard' | 'glyphs' | 'editor' | 'scan' | 'ligatures' | 'kerning' | 'preview' | 'export' | 'settings';

export type Route = { name: RouteName; param?: string };

const PATHS: Record<RouteName, string> = {
  dashboard: '',
  glyphs: 'glyphs',
  editor: 'editor',
  scan: 'scan',
  ligatures: 'ligatures',
  kerning: 'kerning',
  preview: 'preview',
  export: 'export',
  settings: 'settings',
};

const BY_PATH = new Map<string, RouteName>(Object.entries(PATHS).map(([name, path]) => [path, name as RouteName]));

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [first = '', ...rest] = clean.split('/');
  const name = BY_PATH.get(first) ?? 'dashboard';
  const raw = rest.join('/');
  if (!raw) return { name };
  try {
    return { name, param: decodeURIComponent(raw) };
  } catch {
    return { name };
  }
}

export function hrefFor(route: Route): string {
  const base = `#/${PATHS[route.name]}`;
  return route.param ? `${base}/${encodeURIComponent(route.param)}` : base;
}

type Listener = (route: Route) => void;

export function createRouter(win: Pick<Window, 'location' | 'addEventListener' | 'removeEventListener'> = window) {
  const listeners = new Set<Listener>();
  const current = (): Route => parseHash(win.location.hash);
  const notify = () => {
    const r = current();
    for (const l of listeners) l(r);
  };
  win.addEventListener('hashchange', notify);
  return {
    current,
    navigate(route: Route, opts: { replace?: boolean } = {}) {
      const href = hrefFor(route);
      if (opts.replace) win.location.replace(href);
      else win.location.hash = href;
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      fn(current());
      return () => listeners.delete(fn);
    },
    destroy() {
      win.removeEventListener('hashchange', notify);
      listeners.clear();
    },
  };
}

export type Router = ReturnType<typeof createRouter>;
