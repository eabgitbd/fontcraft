# FontCraft v4 — Agent Build Plan

**Give an AI coding agent two files: this plan and `fontcraft-v3.html`.** The agent writes every file in the repository. The human uploads the result to GitHub. GitHub Actions then builds the Android APK and deploys the website, both from the same repository. The human never needs Android Studio.

---

## 0. Read this first (agent operating rules)

1. **Read `fontcraft-v3.html` completely before writing code.** It is the source of truth for features. Copy it to `legacy/fontcraft-v3.html` in the repo and never delete it.
2. **Deliver complete files.** No `TODO`, no placeholders, no "add your code here", no stubs, no skipped sections. If something cannot be finished, say so in `PROGRESS.md` and make the feature visibly disabled in the UI instead of shipping something fake.
3. **Never regress v3.** Every feature in the parity checklist (section 8) must still work. Do not remove a feature because it is hard.
4. **Work in milestones (section 11).** Each milestone must leave the repo in a state where `npm run typecheck`, `npm test`, `npm run build:web` and `npm run build:android` all pass. After each milestone, update `PROGRESS.md` (done, next, known problems) so another agent or session can continue.
5. **Do not pin versions from memory.** Install the latest stable release of every dependency, then commit `package-lock.json`. If you cannot run npm, say so clearly in `PROGRESS.md` (the workflows fall back to `npm install`).
6. **Never invent an API.** If unsure how a library works, read its installed `node_modules` typings or README. If a library does not do what this plan assumes, use the fallback given here, and record the decision in `docs/DECISIONS.md`.
7. **No hostile code.** Do not include any anti-devtools, `debugger` statements, right-click blocking, shortcut blocking, or window-size checks. v3 has all four (lines 1547–1563). Do not port them.
8. **No runtime network dependencies.** No CDN scripts, no Google Fonts, no remote images. Everything is bundled so the app works offline.
9. **Never commit secrets or keystores.**
10. Final answer to the human must list: every file created, the exact upload steps (section 13), and anything not finished.

---

## 1. Goal and deliverables

| Deliverable | How it is produced |
|---|---|
| Website (landing page at `/`, studio at `/app/`, installable PWA, works offline) | GitHub Actions → GitHub Pages |
| Android app (APK, plus AAB if a signing key is configured) | GitHub Actions workflow named **Build APK app** |
| Direct APK download link on the website | Rolling GitHub Release named `latest` with a fixed file name `FontCraft.apk` |

Quality goals for the Android app: smooth drawing (stylus and finger), native-feeling navigation, no freezing, offline, safe data, real exported fonts.

---

## 2. Locked technology choices

| Concern | Choice | Notes |
|---|---|---|
| Build tool | **Vite** + **TypeScript** (strict) | |
| UI | **Svelte 5** (runes) + `@sveltejs/vite-plugin-svelte` | Hand-written project, not a generator template |
| Routing | Tiny **hash router** (own code, about 40 lines) | Works on GitHub Pages and inside Capacitor with no server config |
| Drawing engine | **Custom Canvas 2D + Pointer Events**, no Fabric.js | Framework-independent TypeScript in `src/engine/` |
| Stroke shaping | `perfect-freehand` | Pressure-aware outlines |
| Geometry | `paper` (paper.js), **lazy-loaded** | Boolean union, simplify, curve fit. Use `paper-jsdom`-free core build; if it will not bundle, use `clipper2-wasm` or `polygon-clipping` for union plus own Schneider curve-fit |
| Font writing | `opentype.js` (OTF) + `fonteditor-core` (TTF, WOFF, WOFF2) | See section 8.9 for verification rules |
| Storage | `idb` (IndexedDB) | No `localStorage` for project data |
| Fonts (UI) | `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`, `@fontsource/noto-sans-bengali` | Bundled, offline |
| PDF template | `jspdf`, lazy-loaded | |
| PWA (web only) | `vite-plugin-pwa` | Not used in the Android build |
| Native wrapper | `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` | Use the latest major |
| Native plugins | `@capacitor/filesystem`, `@capacitor/share`, `@capacitor/clipboard`, `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/app`, `@capacitor/keyboard`, `@capacitor/camera`, `@capacitor/screen-orientation` | |
| Icons/splash | `@capacitor/assets` + `sharp` (dev) | Generated in CI from an SVG |
| Tests | `vitest` | Geometry, storage migration, font export round-trip |
| Node in CI | 22 | |
| Java in CI | 21 (Zulu) | Check the installed Capacitor version's requirement and adjust if it asks for another version |

`APP_ID` is `com.codetoday.fontcraft` and `APP_NAME` is `FontCraft`. Both are defined once in `capacitor.config.ts` and in the workflow `env`.

---

## 3. Repository layout (create exactly this)

```
fontcraft/
├─ .github/workflows/
│  ├─ web.yml                     # test + build + deploy website (section 6.1)
│  └─ android.yml                 # "Build APK app" (section 6.2)
├─ assets/                        # generated by scripts/make-icons.mjs in CI, also committed
│  └─ icon.svg                    # master logo (agent draws it: "F" glyph mark, accent #6c63ff on #0a0a0b)
├─ docs/
│  ├─ DECISIONS.md
│  └─ PARITY.md                   # v3 feature checklist with status
├─ legacy/fontcraft-v3.html
├─ scripts/
│  ├─ make-icons.mjs
│  ├─ patch-android.mjs
│  └─ verify.mjs
├─ src/
│  ├─ shared/                     # used by landing and app
│  │  ├─ tokens.css               # design tokens (from v3 :root variables)
│  │  └─ base.css
│  ├─ app/
│  │  ├─ main.ts
│  │  ├─ App.svelte
│  │  ├─ router.ts
│  │  ├─ routes/
│  │  │  ├─ Dashboard.svelte
│  │  │  ├─ CharMap.svelte
│  │  │  ├─ Editor.svelte
│  │  │  ├─ Scanner.svelte
│  │  │  ├─ Ligatures.svelte
│  │  │  ├─ Kerning.svelte
│  │  │  ├─ Preview.svelte
│  │  │  ├─ Export.svelte
│  │  │  └─ Settings.svelte
│  │  ├─ components/              # NavRail, BottomNav, BottomSheet, ToolPalette, GlyphGrid (virtualised),
│  │  │                           # Modal, Toast, Slider, MetricsPanel, ProjectCard, AutosaveBadge
│  │  ├─ stores/                  # project.svelte.ts, editor.svelte.ts, settings.svelte.ts, toast.svelte.ts
│  │  └─ i18n/                    # en.json, bn.json, t.ts
│  ├─ engine/
│  │  ├─ viewport.ts              # pan/zoom transform, em-space <-> screen-space
│  │  ├─ input.ts                 # Pointer Events, gestures, palm rejection
│  │  ├─ renderer.ts              # committed layer cache + live layer
│  │  ├─ history.ts               # command-based undo/redo
│  │  ├─ tools/                   # freehand.ts, bezier.ts, erase.ts, select.ts
│  │  └─ geometry/                # path.ts, outline.ts, union.ts, simplify.ts, fit.ts, hit.ts
│  ├─ font/
│  │  ├─ build-font.ts            # project -> opentype.Font
│  │  ├─ formats.ts               # OTF/TTF/WOFF/WOFF2 conversion
│  │  ├─ features.ts              # kern + liga (+ Bengali ligature features)
│  │  ├─ verify.ts                # re-parse and report
│  │  └─ compile.worker.ts
│  ├─ scan/
│  │  ├─ scan-core.ts             # ported scProcess/scAutoAlign etc (pure functions)
│  │  ├─ scan.worker.ts
│  │  └─ trace.ts                 # bitmap -> contours
│  ├─ storage/
│  │  ├─ db.ts                    # IndexedDB schema
│  │  ├─ projects.ts
│  │  ├─ migrate-v3.ts            # localStorage 'fc3' -> IndexedDB
│  │  ├─ backup.ts                # .fcproj (zip) import/export, auto-backup
│  │  └─ types.ts
│  └─ platform/
│     ├─ index.ts                 # picks web or android at runtime
│     ├─ web.ts
│     └─ android.ts
├─ tests/
├─ web/
│  ├─ landing/index.html          # static, no framework, under 30 KB
│  ├─ landing/landing.css
│  └─ app/index.html              # mounts src/app/main.ts
├─ capacitor.config.ts
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ svelte.config.js
├─ vite.config.ts
├─ .gitignore                     # node_modules, dist, dist-android, android/, *.keystore, .env*
├─ PROGRESS.md
└─ README.md                      # for the human (section 13)
```

`android/` is **not committed**. CI generates it with `npx cap add android`, then applies `scripts/patch-android.mjs`. This means the human never needs Android tooling. Anything Android-specific lives in `patch-android.mjs` so it is repeatable.

---

## 4. Build configuration

### 4.1 `package.json` scripts (required names)

```json
{
  "scripts": {
    "dev": "vite --config vite.config.ts",
    "build:web": "vite build --mode web",
    "build:android": "vite build --mode android",
    "preview": "vite preview",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json && tsc --noEmit",
    "test": "vitest run",
    "verify:web": "node scripts/verify.mjs web",
    "verify:android": "node scripts/verify.mjs android"
  }
}
```

### 4.2 `vite.config.ts` behaviour (write it to satisfy all of this)

- Function form: `defineConfig(({ mode }) => ...)`.
- **Mode `web`:** `root: 'web'`, two HTML entries (`web/landing/index.html` → `/`, `web/app/index.html` → `/app/`), `outDir: '../dist'`, `emptyOutDir: true`, `base: process.env.BASE_PATH || '/'`. Enable `vite-plugin-pwa` scoped to `/app/`.
  - Because the landing page lives in `web/landing/`, configure the build so its output is `dist/index.html`, and the studio's is `dist/app/index.html`. Use a small `closeBundle` plugin that moves `dist/landing/index.html` to `dist/index.html` and rewrites its relative asset paths, or use `rollupOptions.input` names plus `build.rollupOptions.output` so the final tree matches. **The final tree must match the check in `verify.mjs`.**
- **Mode `android`:** `root: 'web/app'`, one entry, `outDir: '../../dist-android'`, `base: './'` (relative paths, required by Capacitor), **no PWA plugin, no service worker**.
- `resolve.alias`: `@` → `src` (absolute path, so it works with both roots). Allow the dev server to read `src` (`server.fs.allow`).
- `define`: `__REPO_URL__` from `process.env.VITE_REPO_URL`, `__APP_VERSION__` from `package.json` plus `process.env.VITE_BUILD_NUMBER`.
- `build.target: 'es2020'` (Android WebView on Android 8+ must run it). `build.sourcemap: false`. `chunkSizeWarningLimit` raised only for lazy chunks.
- Heavy libraries (`paper`, `fonteditor-core`, `jspdf`, `harfbuzz` if used, tracing) are only imported through dynamic `import()` so they are separate lazy chunks.
- Workers are created with `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`.

### 4.3 `capacitor.config.ts`

```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.codetoday.fontcraft',
  appName: 'FontCraft',
  webDir: 'dist-android',
  backgroundColor: '#0a0a0b',
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0a0a0b', showSpinner: false },
    Keyboard: { resize: 'body' },
    StatusBar: { style: 'DARK', backgroundColor: '#0a0a0b', overlaysWebView: false }
  }
};
export default config;
```

The agent must adjust plugin option names to match the installed Capacitor version's typings.

---

## 5. Scripts the agent must write

### 5.1 `scripts/make-icons.mjs`
Uses `sharp` to render `assets/icon.svg` into: `assets/icon-only.png` (1024), `assets/icon-foreground.png` (1024, logo inside the safe zone, transparent), `assets/icon-background.png` (1024, solid `#0a0a0b`), `assets/splash.png` and `assets/splash-dark.png` (2732×2732, logo centred on `#0a0a0b`). Also renders `web/app/public/icon-192.png`, `icon-512.png` and a maskable 512 for the PWA. CI then runs `npx capacitor-assets generate --android` to produce all launcher icons and splash screens.

### 5.2 `scripts/patch-android.mjs` (idempotent; running twice changes nothing more)
Runs after `cap add android` and `cap sync`. Reads `VERSION_CODE` and `VERSION_NAME` from env.
- In `android/app/build.gradle`: set `versionCode` and `versionName` (regex replace on the existing lines).
- In `android/app/src/main/AndroidManifest.xml`: set `android:windowSoftInputMode="adjustResize"` on the main activity; ensure `android:usesCleartextTraffic="false"`; remove any permission the app does not use. Keep `INTERNET` (Capacitor needs it) and camera only if `@capacitor/camera` is used.
- Set the app theme status/navigation bar colours to `#0a0a0b` in `styles.xml` / `colors.xml`.
- Print a summary of every change. Exit non-zero if an expected pattern is not found (so a Capacitor template change is noticed instead of silently ignored).

### 5.3 `scripts/verify.mjs <web|android>` — the safety net (CI runs it)
Fails the build (exit 1, clear message) if any check fails.

Both modes:
- No file in the output contains: `debugger`, `fonts.googleapis.com`, `cdnjs.cloudflare.com`, `unpkg.com`, `cdn.jsdelivr.net`.
- Output HTML has no absolute-root asset URLs when `base` is `./`.

`web` mode (`dist/`):
- `dist/index.html`, `dist/app/index.html`, a web manifest and a service worker file exist.
- Landing page HTML is under 30 KB.
- Every `href`/`src` in both HTML files resolves to an existing file (respecting `BASE_PATH`).

`android` mode (`dist-android/`):
- `dist-android/index.html` exists and all referenced assets exist.
- No service worker registration string (`serviceWorker.register`) in the output.

Also fail if `src/` contains the strings `debugger`, `outerWidth - window.innerWidth` or `contextmenu` with `preventDefault` (block hostile code from creeping back).

---

## 6. GitHub Actions (write these files exactly, adjusting only for real errors)

### 6.1 `.github/workflows/web.yml`

```yaml
name: Build & Deploy Website

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: |
          if [ -f package-lock.json ]; then npm ci; else npm install; fi

      - name: Typecheck
        run: npm run typecheck

      - name: Unit tests
        run: npm test

      - name: Build website
        env:
          VITE_REPO_URL: ${{ github.server_url }}/${{ github.repository }}
          VITE_BUILD_NUMBER: ${{ github.run_number }}
        run: |
          REPO="${{ github.event.repository.name }}"
          if [[ "$REPO" == *.github.io ]]; then export BASE_PATH="/"; else export BASE_PATH="/$REPO/"; fi
          npm run build:web

      - name: Verify output
        run: node scripts/verify.mjs web

      - name: Upload Pages artifact
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 6.2 `.github/workflows/android.yml` (the workflow shown in the Actions tab as **Build APK app**)

```yaml
name: Build APK app

on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: android-${{ github.ref }}
  cancel-in-progress: true

jobs:
  apk:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      HAS_KEYSTORE: ${{ secrets.KEYSTORE_BASE64 != '' }}
      VERSION_CODE: ${{ github.run_number }}
      VERSION_NAME: 1.0.${{ github.run_number }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: |
          if [ -f package-lock.json ]; then npm ci; else npm install; fi

      - name: Unit tests
        run: npm test

      - name: Build web assets for Android
        env:
          VITE_BUILD_NUMBER: ${{ github.run_number }}
        run: npm run build:android

      - name: Verify web assets
        run: node scripts/verify.mjs android

      - name: Add Android platform
        run: |
          if [ ! -d android ]; then npx cap add android; fi

      - name: Generate icons and splash
        run: |
          node scripts/make-icons.mjs
          npx capacitor-assets generate --android

      - name: Sync Capacitor
        run: npx cap sync android

      - name: Patch Android project
        run: node scripts/patch-android.mjs

      - uses: actions/setup-java@v4
        with:
          distribution: zulu
          java-version: 21

      - uses: gradle/actions/setup-gradle@v4

      - name: Build debug APK
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon

      - name: Collect debug APK
        run: |
          mkdir -p out
          cp android/app/build/outputs/apk/debug/app-debug.apk out/FontCraft-debug.apk

      - name: Build signed release (only if signing secrets exist)
        if: env.HAS_KEYSTORE == 'true'
        working-directory: android
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
          SIGNING_STORE_PASSWORD: ${{ secrets.SIGNING_STORE_PASSWORD }}
          SIGNING_KEY_ALIAS: ${{ secrets.SIGNING_KEY_ALIAS }}
          SIGNING_KEY_PASSWORD: ${{ secrets.SIGNING_KEY_PASSWORD }}
        run: |
          set -euo pipefail
          echo "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/release.keystore"
          ./gradlew assembleRelease bundleRelease --no-daemon
          BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
          UNSIGNED=$(ls app/build/outputs/apk/release/*.apk | head -1)
          "$BT/zipalign" -p -f 4 "$UNSIGNED" "$RUNNER_TEMP/aligned.apk"
          "$BT/apksigner" sign \
            --ks "$RUNNER_TEMP/release.keystore" \
            --ks-key-alias "$SIGNING_KEY_ALIAS" \
            --ks-pass env:SIGNING_STORE_PASSWORD \
            --key-pass env:SIGNING_KEY_PASSWORD \
            --out ../out/FontCraft.apk "$RUNNER_TEMP/aligned.apk"
          "$BT/apksigner" verify ../out/FontCraft.apk
          AAB=$(ls app/build/outputs/bundle/release/*.aab | head -1)
          cp "$AAB" ../out/FontCraft.aab
          jarsigner -keystore "$RUNNER_TEMP/release.keystore" \
            -storepass "$SIGNING_STORE_PASSWORD" -keypass "$SIGNING_KEY_PASSWORD" \
            ../out/FontCraft.aab "$SIGNING_KEY_ALIAS"

      - name: Choose the APK to publish
        run: |
          if [ ! -f out/FontCraft.apk ]; then cp out/FontCraft-debug.apk out/FontCraft.apk; fi
          ls -la out

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: FontCraft-android-${{ github.run_number }}
          path: out/*
          retention-days: 30

      - name: Publish rolling release "latest"
        if: github.ref == 'refs/heads/main'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release delete latest --yes --cleanup-tag --repo "${{ github.repository }}" || true
          gh release create latest out/FontCraft.apk \
            --repo "${{ github.repository }}" --target "${{ github.sha }}" --prerelease \
            --title "Latest build #${{ github.run_number }}" \
            --notes "Automatic build of commit ${{ github.sha }}."

      - name: Publish versioned release
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          FILES="out/FontCraft.apk"; [ -f out/FontCraft.aab ] && FILES="$FILES out/FontCraft.aab"
          gh release create "$GITHUB_REF_NAME" $FILES \
            --repo "${{ github.repository }}" --generate-notes
```

Signing behaviour the agent must document in the README:
- **Without secrets:** the APK is debug-signed. It installs fine, but the debug key is regenerated on every CI run, so **a newer build cannot install over an older one** (Android says the signature differs). The user must uninstall first. The app's auto-backup and `.fcproj` export exist so no work is lost.
- **With secrets:** every build uses the same key, so updates install over the old version. This is the recommended setup.

---

## 7. Design tokens and look

Port the dark theme exactly from v3's `:root` variables (`--bg #0a0a0b`, `--accent #6c63ff`, etc.) into `src/shared/tokens.css`. Add light-theme tokens and `prefers-color-scheme` support. Font stack: Inter (UI), JetBrains Mono (numbers, codes), Noto Sans Bengali (Bengali UI text). Radius and spacing scales from v3. All interactive controls: minimum 44 px on desktop, **48 px on touch**.

---

## 8. Product specification

### 8.1 Data model (all coordinates in font units, UPM 1000, y-up)

```ts
type Pt = { x: number; y: number };
type PathNode = { p: Pt; hIn?: Pt; hOut?: Pt; kind: 'corner' | 'smooth' };
type Contour = { nodes: PathNode[]; closed: boolean };
type Stroke = { pts: { x: number; y: number; pressure: number }[]; size: number; erase?: boolean };
type Variant = {
  strokes: Stroke[];          // raw input, kept so the glyph stays editable
  contours: Contour[];        // cached union/simplified result, rebuilt on change
  legacyPng?: Blob;           // v3 bitmap, kept as a reference layer after migration
};
type Glyph = { char: string; advance: number; lsb: number; rsb: number; variants: Variant[] }; // max 4 variants
type FontSettings = { upm: number; ascender: number; descender: number; xheight: number; capheight: number;
  designer: string; license: string; subfamily: string; version: string; italic: number; tracking: number };
type Project = { id: string; schema: 4; name: string; set: string; cell: string; settings: FontSettings;
  ligatures: Ligature[]; kerning: KernPair[]; createdAt: number; updatedAt: number };
```

Ligature and kerning shapes: copy the fields the v3 code uses in `saveLig`, `saveKM`, `saveKP` (lines about 1354–1396). Do not guess; read them.

### 8.2 Storage (`src/storage/`)
- IndexedDB via `idb`. Stores: `projects` (metadata + settings + ligatures + kerning), `glyphs` (key `[projectId, char]`), `blobs` (reference images), `backups`.
- **One glyph = one record.** Saving a glyph writes only that record. Autosave is debounced (500 ms) and also runs on `visibilitychange` (hidden) and on the Capacitor `App` `pause` event.
- Call `navigator.storage.persist()` on first run.
- If a write fails (quota), show a clear toast and offer immediate `.fcproj` export.
- **Auto-backup:** every 20 glyph saves and on app pause, write a `.fcproj` snapshot (keep the last 5). Settings has a "Restore from backup" list.
- `.fcproj` = zip (`fflate` is fine) containing `project.json`, `glyphs/*.json`, `refs/*`. Include `schema`. Provide `migrate(schemaN → schemaN+1)` functions with tests. `impJSON` (v3 JSON backup import) must still be supported: import v3 `*_fontcraft.json` files.

### 8.3 Migration from v3 (`migrate-v3.ts`)
On first launch, if `localStorage['fc3']` exists and the DB has no projects: read it (`S.projects`, shape shown in v3 `createProj`: `id, name, set, cell, chars{ch:{variants[dataURL|null], advance, lsb, rsb}}, ligatures, kerning, settings`).
1. Copy every project into IndexedDB. Each PNG data URL becomes `legacyPng`.
2. Trace each PNG to contours in a worker (section 8.8) so glyphs become vector. The PNGs are white strokes (alpha and red channel above threshold, same test as v3 `expFont`) on a `#0f0f11` background, drawn in a canvas scaled to fit the em box.
3. Show a progress screen. **Never delete or modify `localStorage['fc3']`.** Show a one-time message: "Your old projects were copied. The originals are untouched."
4. Test with a fixture built from v3's data shape.

### 8.4 Platform adapter (`src/platform/`) — fixes browser-only calls
One interface, two implementations, chosen with `Capacitor.isNativePlatform()`:

```ts
interface Platform {
  saveFile(name: string, data: Blob, mime: string): Promise<'saved' | 'shared' | 'cancelled'>;
  openFile(accept: string[]): Promise<File | null>;
  copyText(text: string): Promise<void>;
  haptic(kind: 'tick' | 'success' | 'warn'): void;
  onBack(handler: () => boolean): () => void;      // return true if handled
  keepAwake(on: boolean): void;                    // best effort
  captureImage(): Promise<Blob | null>;            // camera; web falls back to a file input
  isNative: boolean;
}
```

- **Android `saveFile`:** write to `Directory.Cache` with `Filesystem.writeFile` (base64), then `Share.share({ url })` so the user picks "Save to Files", Drive, WhatsApp, etc. Also offer "Save to Documents" (`Directory.Documents`, folder `FontCraft`). Never use `<a download>` or `font.download()` on native.
- **Web `saveFile`:** File System Access API (`showSaveFilePicker`) when available, else a blob anchor download.
- Every v3 place that used `font.download`, `doc.save`, blob-anchor, or `navigator.clipboard` must call this adapter instead.

### 8.5 Drawing engine (`src/engine/`) — the "smooth and realistic" core
- **Pointer Events only.** `touch-action: none` on the canvas. One code path for finger, stylus and mouse, **including the Bezier pen** (v3's pen is mouse-only).
- **Input quality:** use `getCoalescedEvents()` for every move, and `getPredictedEvents()` for the live stroke only (drop predictions when the stroke is committed). Read `pressure`; for finger input (constant 0.5) simulate pressure from speed.
- **Stabiliser:** adjustable smoothing (0–100), implemented as a streamline/one-euro filter before `perfect-freehand`.
- **Rendering:** two canvases. The committed layer is cached and redrawn only when strokes or the viewport change. The live layer redraws only the current stroke in `requestAnimationFrame`. Use `getContext('2d', { desynchronized: true })` where supported. Handle `devicePixelRatio` correctly and keep the canvas crisp at any zoom.
- **Viewport:** pinch-zoom, two-finger pan, wheel zoom, double-tap-to-fit. **Palm rejection:** while a `pen` pointer is active or was active in the last 500 ms, ignore `touch` pointers for drawing (still allow two-finger gestures only when no pen is down).
- **Gestures:** two-finger tap = undo, three-finger tap = redo (must not leave a stray dot).
- **Guides:** baseline, x-height, cap-height, ascender, descender, advance and side-bearing lines from the project settings. Optional snapping of pen nodes to guides within 8 px, with a haptic tick when it snaps.
- **History:** command pattern (`AddStroke`, `EraseStroke`, `MoveNode`, `DeleteObject`, `Clear`). Unlimited within a session, capped at 200 commands. No full-canvas JSON snapshots.
- **Tools** (same shortcuts as v3): Draw (D), Bezier pen (B), Erase (E), Select (V). Brush size, colour and opacity controls as in v3. Erase removes stroke area (splits strokes) or, if that is too hard to implement well, deletes whole strokes touched; document the choice in `DECISIONS.md`.
- **Bezier pen:** click/tap adds a corner node; drag while adding pulls symmetric handles (same as v3 `bzDn`/`bzMv`); tap a node to toggle smooth/corner; handles are draggable; Enter or a Done button commits; C or a Close button closes; Esc or Cancel discards; minimum 3 nodes to close (as v3).
- **Zoom controls:** +, −, fit (`zIn`, `zOut`, `zFit`), also `+ − 0` keys.
- **Live outline preview toggle:** shows the unioned, simplified contours that will actually be exported, over the raw strokes.
- **Performance target:** no dropped frames while drawing on a mid-range Android phone; stroke-to-pixel latency visibly low.

### 8.6 Geometry (`src/engine/geometry/`)
- `outline.ts`: stroke → polygon via `perfect-freehand`.
- `union.ts`: union all variant polygons (lazy `paper`, or the fallback named in section 2). Fix winding (outer clockwise for CFF, inner counter-clockwise), drop contours with area below a threshold.
- `fit.ts`: polygon → cubic Bezier contours (Schneider curve fitting or `paper` `Path.simplify`) with a tolerance setting ("Smoothness" slider in export).
- Unit tests: a rectangle stroke unions into one contour; two overlapping strokes give one contour; a ring gives an outer and an inner contour with opposite winding; curve fitting stays within tolerance.

### 8.7 Character map and glyph management
Port `mkChars`, `renderCmap`, `setScript`, `openEd`, `CS` (Latin, Bengali, digits, punctuation), `BN` (Bengali names) and the sets `latin`, `bengali`, `bengali-ext`, `latin-ext`, all. The grid is **virtualised** (render only visible cells). Cells show a vector thumbnail. Add: completion percentage per script, "show only empty" filter, "jump to next empty glyph", and per-glyph state (empty / drawn / has variants). Variants: up to 4 per glyph (as v3 `addVar`), with a switcher. Glyph metrics (advance, lsb, rsb) as in v3, plus an "auto side bearings" button computed from the outline bounds.

### 8.8 Scanner and tracing
- Port v3's scan module as **pure functions in `scan-core.ts`**: `scLayout`, `scCells`, `scProcess`, `scAnalyze`, `scDetectPage`, `scAutoAlign`, `scResetGrid`, the zoom/pan viewport, cell selection, assign/skip/nudge, `scImportSel`, `importAll`. Keep the same algorithm and default values first, then move the heavy pixel loops (`scProcess`, `scAnalyze`, `scAutoAlign`) into `scan.worker.ts` with `OffscreenCanvas`/transferable buffers so the UI never freezes.
- Support drag-and-drop, file input and, on Android, `platform.captureImage()`.
- **Tracing (`trace.ts`):** bitmap alpha mask → contours → curve-fit. Try, in order: `esm-potrace-wasm` (or another maintained Potrace WASM package that bundles with Vite); otherwise write marching-squares contour extraction plus the `fit.ts` curve fit (no dependencies). Record the choice. Imported scan cells become vector glyphs, not PNGs.
- Also port: threshold tracing (`applyThresh`), SVG import (`importSVG`; map SVG paths into contours, scaling to the em box), reference image overlay with opacity (`loadRef`, `clearRef`, `setRefOp`).
- **Template PDF** (`dlTemplate`): port with `jspdf` lazy-loaded; output goes through `platform.saveFile`. Keep the Latin and Bengali templates.

### 8.9 Font export (`src/font/`) — must produce real fonts
Pipeline: project → for each glyph, contours (variant 0 as the default form) → `opentype.Path` (cubic `C` commands) → `opentype.Font` (`familyName`, `styleName`, `unitsPerEm`, `ascender`, `descender`, plus name-table fields from settings: designer, license, version) → binary.

- **Formats:** OTF (CFF, from `opentype.js`), TTF, WOFF, WOFF2 (from `fonteditor-core`, converting the OTF buffer; WOFF2 needs its WASM initialised, load it lazily). **Each format must be verified by a test that converts and re-parses it.** If a format fails verification in your environment, **disable that button in the UI with the reason** instead of renaming another format (v3's `woff2` silently wrote an `.otf`; that must never happen again).
- **Kerning and ligatures are exported.** `features.ts`: write ligatures as GSUB `liga`, kerning as GPOS `kern` (pair adjustment). If the writer library cannot emit a table, build the binary table yourself in TypeScript and inject it into the font; if that also fails, fall back to the legacy `kern` table for kerning and say so in the export report. Never drop the data silently.
- **Bengali:** export user-defined Bengali ligatures/conjuncts also under the `bng2` and `beng` scripts (features `akhn`, `liga`) besides `DFLT`. State the limitation in the UI: "Basic Bengali support: base letters and your own conjunct glyphs. Full automatic conjunct shaping is not included." Do not claim more.
- **Runs in a worker** (`compile.worker.ts`), with progress messages.
- **After building, always verify (`verify.ts`):** re-parse the produced bytes; check glyph count, that each drawn glyph has a non-empty path, that no glyph consists only of axis-aligned rectangles (the v3 failure), that kerning/ligature counts match the project. Show the result as an **export report** ("212 glyphs · 0 empty · 41 kern pairs · 3 ligatures · 2 warnings") before saving.
- Also port: CSS `@font-face` snippet (`expCSS`, honest about which formats exist), specimen sheet (`expSheet`), project backup/import (`expJSON`, `impJSON`), settings (`loadSets`, `saveSets`).
- Ligature and kerning screens: port `renderLigs`, `saveLig`, `delLig`, `renderKern`, `kViz`, `saveKP`, `saveKM`, `delKP` including the kerning visualiser.
- **Preview** (`renderPv` etc.): the live preview must render text with the **font being built** (build a font blob, load it with `FontFace`) so the user sees the real result, including kerning. Keep the size, line-height, letter-spacing, colour, weight and background controls and copy-text.

### 8.10 UI language
English and বাংলা (`en.json`, `bn.json`), switchable in Settings, stored in settings. All visible strings go through `t()`. Keep v3's Bengali sample sentences in the preview.

---

## 9. Mobile and responsive UI specification

| Screen width | Layout |
|---|---|
| ≥ 1024 px | Left icon rail (like v3), full side panels |
| 768–1023 px | Left rail, collapsible side panels |
| < 768 px | **Bottom navigation** (Projects, Glyphs, Scan, Preview, Export) plus a top app bar. This replaces v3's hidden sidebar, which left phones with no navigation. |

- **Editor on phones:** the canvas fills the screen. A floating tool palette holds Draw, Pen, Erase, Select, Undo, Redo. Brush settings, metrics, variants, reference image and guides live in a **bottom sheet** with peek/half/full snap points.
- **Landscape** is allowed in the editor (larger canvas); save and restore the viewport per glyph.
- **Safe areas:** use `env(safe-area-inset-*)`, viewport `viewport-fit=cover`.
- **Back button** (`platform.onBack`): close bottom sheet → close modal → leave editor (ask to save if unsaved) → leave project → confirm exit. Never lose a drawing on back.
- **Keyboard:** modals scroll the focused input into view; Bengali input works in all text fields.
- **Haptics:** node snap (tick), glyph saved (success), warning on destructive confirm.
- **Keep the screen awake** while the editor is open (best effort).
- No hover-only UI: replace `data-tip` tooltips with long-press labels on touch.
- `user-select: none` only on the canvas and toolbars, not on inputs or text the user may want to copy.
- Delete confirmations use a modal, not `confirm()`.
- Toasts and the autosave badge port from v3.
- Focus states, labels (`aria-label`) on icon buttons, sufficient contrast, respect `prefers-reduced-motion`.

---

## 10. Website specification

### 10.1 Landing page (`web/landing/`)
Plain HTML + CSS, **no JavaScript framework, under 30 KB total**, English/Bengali toggle with a few lines of JS. Sections: hero ("Turn your handwriting into a real font"), three-step how-it-works, feature list (draw, pen tool, scan a template, Bengali + Latin, export OTF/TTF/WOFF/WOFF2, works offline), buttons **Open the app** (`./app/`) and **Download Android APK** (`__REPO_URL__/releases/download/latest/FontCraft.apk`), and a footer with the GitHub link. Include `<meta>` description and Open Graph tags. Must look good on a phone first.

### 10.2 Studio as a PWA (`/app/`)
- `vite-plugin-pwa`, `registerType: 'prompt'` (show an "Update available" toast), scope and `start_url` both `${base}app/`.
- Precache the app shell, fonts, workers and WASM (raise `maximumFileSizeToCacheInBytes` as needed) so the whole studio works offline after the first visit.
- Manifest: name, short_name `FontCraft`, `display: standalone`, `theme_color` and `background_color` `#0a0a0b`, icons 192/512 plus maskable, `file_handlers` for `.fcproj`.
- Performance budget: app shell ≤ 150 KB gzipped JS; heavy libraries only as lazy chunks; Lighthouse mobile Performance ≥ 90, Accessibility ≥ 95 (agent cannot run Lighthouse in CI; keep the budget by construction and report the bundle sizes in `PROGRESS.md`).

---

## 11. Milestones (each ends with green typecheck, tests, both builds; update `PROGRESS.md`)

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Skeleton and green pipeline.** Vite + TS + Svelte, both build modes, landing placeholder, empty app shell showing the FontCraft logo, capacitor config, all three scripts, both workflows, `.gitignore`, README. | `build:web` and `build:android` pass and `verify.mjs` passes. **The human can already upload this and confirm that the workflows run and produce a website and an APK.** |
| **M1** | **Foundations.** Tokens/theme, router, layout (rail + bottom nav), toasts, modals, i18n, storage (`idb`), platform adapter (web + android), settings store. | Unit tests for storage and platform mocks pass; navigation works on desktop and phone widths. |
| **M2** | **Parity port (with the new storage).** Dashboard, project create/open/delete, character map, editor shell, settings modal, shortcuts modal, ligature/kerning screens, preview, `.fcproj` and v3-JSON import, migration from `fc3`. Editor may use a simple temporary pointer-based freehand tool. | Every line of `docs/PARITY.md` is ticked or has an explicit reason. |
| **M3** | **New drawing engine** (section 8.5), vector glyph model, geometry (8.6), command history, Bezier pen rebuild, live outline preview. | Draw, erase, pen, undo/redo, zoom/pan all work with mouse, finger and simulated pen events; geometry tests pass. |
| **M4** | **Scanner and tracing** (8.8): scan module in a worker, trace, SVG import, threshold trace, reference layer, template PDF. | Scan import produces vector glyphs; UI stays responsive on a large photo. |
| **M5** | **Real font export** (8.9) with worker, verification tests, export report, kern/liga, real-font preview. | Round-trip tests pass for every enabled format; no fake formats; export report shows correct counts. |
| **M6** | **Android polish** (section 9): bottom nav, bottom sheet, back button, haptics, camera, safe areas, share/save, auto-backup, icons and splash via `make-icons.mjs`, `patch-android.mjs` finalised. | `android.yml` produces an APK. |
| **M7** | **Website and PWA** (section 10): real landing page, PWA, update toast, offline test by inspection of precache manifest. | `web.yml` deploys; landing page under 30 KB; both APK links present. |
| **M8** | **Hardening.** Empty/error states everywhere, large-project performance pass (test with 500 glyphs), docs finalised, `PROGRESS.md` cleaned, README verified against the workflows. | Final self-review against sections 0 and 12 passes. |

If the agent can only finish part of this in one session, it stops at the end of a milestone, updates `PROGRESS.md`, and reports clearly.

---

## 12. Definition of done (agent self-check before handing over)

Run and report the output of:
```
npm run typecheck
npm test
BASE_PATH=/fontcraft/ npm run build:web && node scripts/verify.mjs web
npm run build:android && node scripts/verify.mjs android
```
And confirm each of these in the final message:
- No `debugger`, no anti-devtools, no context-menu blocking anywhere in `src/` or the outputs.
- No CDN or Google Fonts URLs anywhere in the outputs.
- Every export goes through `platform.saveFile`, and every clipboard call through `platform.copyText`.
- `fc3` migration never deletes the original data.
- No fake formats (each export button is backed by a verified conversion or disabled with a reason).
- `docs/PARITY.md` lists every v3 feature and its status.
- `README.md` matches the workflows (section 13).
- Bundle sizes are reported in `PROGRESS.md`.

---

## 13. `README.md` content (for the human; write it in simple English, short steps)

1. **Upload to GitHub:** create a new repository (public or private), then upload all files **including the hidden-looking `.github` folder**. Uploading through the website is limited to 100 files per upload, so upload in several batches, or use GitHub Desktop or `git push`. Commit to the `main` branch.
2. **Turn on the website:** repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site appears at `https://<username>.github.io/<repository>/`.
3. **Watch the builds:** open the **Actions** tab. **Build & Deploy Website** and **Build APK app** start automatically on every push to `main`. A first APK build takes roughly 8–15 minutes.
4. **Get the APK:** either open the finished **Build APK app** run and download the artifact (a zip containing `FontCraft.apk`), or open the repository **Releases → latest** and download `FontCraft.apk` directly. The website's Download button points to the same file.
5. **Install on the phone:** open the APK on the phone and allow "Install unknown apps" for the app you opened it with.
6. **Recommended: stable signing key (so updates install over the old version).** Create a keystore once (on any computer with Java: `keytool -genkeypair -v -keystore fontcraft.keystore -alias fontcraft -keyalg RSA -keysize 2048 -validity 10000`), then convert it to base64 with `base64 -w0 fontcraft.keystore` (Linux/macOS) or `certutil -encode fontcraft.keystore keystore.txt` (Windows, remove the BEGIN/END lines). In **Settings → Secrets and variables → Actions**, add: `KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`, `SIGNING_KEY_PASSWORD`. Keep the keystore file and passwords backed up in at least two safe places. If they are lost, the app can never be updated in place. Never commit the keystore.
7. **Without the key:** the APK still works, but before installing a newer build you must uninstall the old one (export your projects first from the app: Export → Backup).
8. **Publish a numbered version:** create and push a tag such as `v1.0.0`; the workflow also attaches the APK (and the AAB, if signing secrets exist) to a versioned release.
9. **If a build fails:** open the failed run, copy the red error lines, and give them to the AI agent with this plan.

---

## 14. Known limits (state these honestly in the app and README)

- Bengali: real conjunct shaping (reph, matra reordering, automatic conjunct formation) is **not** generated automatically. The app supports base letters and user-drawn conjunct glyphs exported as ligatures.
- Pressure and tilt need a stylus and a device that reports them. Finger drawing uses simulated pressure.
- Debug-signed APKs cannot be updated in place (section 6.2).
- The APK is not built for Google Play submission unless the signing secrets are added; the AAB is produced only in that case.
- iOS is out of scope.
