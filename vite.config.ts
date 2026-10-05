import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as { version: string };

const repoUrl = process.env.VITE_REPO_URL ?? '';
const buildNumber = process.env.VITE_BUILD_NUMBER ?? 'dev';

/** Replaces __REPO_URL__ in the static landing page (Vite `define` does not touch HTML). */
function landingTokens(): Plugin {
  return {
    name: 'fontcraft-landing-tokens',
    transformIndexHtml(html) {
      return html.split('__REPO_URL__').join(repoUrl || '#');
    },
  };
}

/** jsPDF names a CDN script for its `pdfobjectnewwindow` output mode, which FontCraft never calls. Remove the URL. */
function stripPdfCdn(): Plugin {
  return {
    name: 'fontcraft-strip-pdf-cdn',
    enforce: 'pre',
    transform(code, id) {
      if (!/node_modules[\\/]jspdf[\\/]/.test(id) || !code.includes('cdnjs.cloudflare.com')) return null;
      return { code: code.split('https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js').join(''), map: null };
    },
  };
}

/** Moves dist/landing/index.html to dist/index.html so the landing page is served at "/". */
function moveLanding(outDir: string): Plugin {
  return {
    name: 'fontcraft-move-landing',
    apply: 'build',
    closeBundle: {
      order: 'post',
      handler() {
        const from = resolve(outDir, 'landing', 'index.html');
        const to = resolve(outDir, 'index.html');
        if (!existsSync(from)) return;
        mkdirSync(outDir, { recursive: true });
        renameSync(from, to);
        rmSync(resolve(outDir, 'landing'), { recursive: true, force: true });
        // Asset URLs are absolute (they start with `base`), so no rewriting is needed.
        // Guard against a relative base, which would break once the file moves up one level.
        const html = readFileSync(to, 'utf8');
        if (html.includes('../assets/')) writeFileSync(to, html.split('../assets/').join('./assets/'));
      },
    },
  };
}

/** Copies web/app/public/* (icons) to dist/app/ so PWA icons resolve under /app/. */
function copyAppPublic(outDir: string): Plugin {
  return {
    name: 'fontcraft-copy-app-public',
    apply: 'build',
    closeBundle: {
      order: 'post',
      handler() {
        const src = resolve(here, 'web/app/public');
        if (!existsSync(src)) return;
        cpSync(src, resolve(outDir, 'app'), { recursive: true });
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const isAndroid = mode === 'android';
  const base = isAndroid ? './' : process.env.BASE_PATH || '/';

  const common = {
    plugins: [] as Plugin[],
    resolve: {
      alias: [
        // jsPDF optionally imports these for features FontCraft does not use; do not bundle them.
        { find: /^(html2canvas|canvg|dompurify)$/, replacement: resolve(here, 'src/shared/empty-module.ts') },
        { find: '@', replacement: resolve(here, 'src') },
      ],
    },
    define: {
      __REPO_URL__: JSON.stringify(repoUrl),
      __APP_VERSION__: JSON.stringify(`${pkg.version}+${buildNumber}`),
      __IS_ANDROID_BUILD__: JSON.stringify(isAndroid),
    },
    server: { fs: { allow: [here] } },
    worker: { format: 'es' as const },
    base,
  };

  if (isAndroid) {
    return {
      ...common,
      root: resolve(here, 'web/app'),
      plugins: [svelte(), stripPdfCdn()],
      build: {
        outDir: resolve(here, 'dist-android'),
        emptyOutDir: true,
        target: 'es2020',
        sourcemap: false,
        chunkSizeWarningLimit: 900,
      },
    };
  }

  const outDir = resolve(here, 'dist');
  const appBase = `${base}app/`;
  return {
    ...common,
    root: resolve(here, 'web'),
    publicDir: false as const,
    plugins: [
      svelte(),
      stripPdfCdn(),
      landingTokens(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        filename: 'sw.js',
        manifestFilename: 'app.webmanifest',
        scope: appBase,
        base,
        includeAssets: [],
        manifest: {
          name: 'FontCraft',
          short_name: 'FontCraft',
          description: 'Turn your handwriting into a real font.',
          start_url: appBase,
          scope: appBase,
          id: appBase,
          display: 'standalone',
          theme_color: '#0a0a0b',
          background_color: '#0a0a0b',
          icons: [
            { src: `${base}app/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}app/icon-512.png`, sizes: '512x512', type: 'image/png' },
            { src: `${base}app/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['app/**/*.{html,png,svg,webmanifest}', 'assets/**/*.{js,css,woff2,wasm}'],
          navigateFallback: `${appBase}index.html`,
          navigateFallbackAllowlist: [new RegExp(`^${appBase.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`)],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          cleanupOutdatedCaches: true,
        },
      }),
      moveLanding(outDir),
      copyAppPublic(outDir),
    ],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          landing: resolve(here, 'web/landing/index.html'),
          app: resolve(here, 'web/app/index.html'),
        },
      },
    },
  };
});
