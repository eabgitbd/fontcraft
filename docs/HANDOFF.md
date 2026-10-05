# Hand-off guide for the next agent

You are continuing **FontCraft v4**: a handwriting-to-font studio that builds as a website (PWA) and an Android APK (Capacitor) from one repository. The owner is non-technical and will upload the repository to GitHub; GitHub Actions builds everything. **Read `docs/BUILD_PLAN.md` first (the specification), then this file, then `PROGRESS.md`.** Milestones M0 to M4 are done. You start at **M5**.

## 1. Orientation
```
src/app/        Svelte UI: App.svelte (shell, router, jobs), routes/, components/, stores/, i18n/
src/engine/     Drawing engine and geometry (pure TypeScript): pointers, history, pen, viewport, render, geometry/
src/scan/       Scanner, tracing, SVG import, template PDF, worker engine, v3 bitmap conversion
src/storage/    IndexedDB (idb): projects, glyphs (one record per glyph), blobs, backups; .fcproj; v3 migration
src/platform/   Web and Android adapters (save, share, clipboard, haptics, back button, camera, wake lock)
src/shared/     tokens.css, base.css, empty-module.ts
web/landing/    Static landing page (placeholder). web/app/ is the studio's HTML entry and icons
scripts/        verify.mjs (build checks), make-icons.mjs, patch-android.mjs
e2e/            Real-browser tests (not CI): lib.mjs, editor.e2e.mjs, scan.e2e.mjs
tests/          Vitest unit and integration tests (jsdom where needed), tests/helpers/scanFixture.ts
docs/           BUILD_PLAN.md (spec), DECISIONS.md (D1 to D38), PARITY.md (v3 features), this file
legacy/         fontcraft-v3.html, the original single-file app, kept as a reference
.github/workflows/  web.yml (Pages) and android.yml (APK), copied from the plan; do not change without reading plan section 6
```
Key data model (`src/storage/types.ts`): coordinates are font units (UPM 1000), y-up. A `Glyph` has 1 to 4 `Variant`s. A variant keeps raw input (`strokes`, `paths` from the pen tool, `traced` imported art, optional `legacyPng` reference bitmap) and the **derived** `contours` (union plus curve fit; this is what export must use). Outer contours are clockwise, holes counter-clockwise (y-up), which is what CFF wants. `Project` holds settings (ascender, descender, xheight, capheight, default widths, designer, license, version, varMode...), `ligatures` ({input, output, name}) and `kerning` ({left, right, value}).

## 2. Commands
```
npm ci
npm run typecheck                      # svelte-check, 0 errors required
npm test                               # vitest, 367 tests
BASE_PATH=/fontcraft/ npm run build:web && node scripts/verify.mjs web
npm run build:android && node scripts/verify.mjs android
npm run build:web && node e2e/editor.e2e.mjs && node e2e/scan.e2e.mjs     # real browser (see section 4)
```
Run the first four before every hand-back. Never claim something works that was not run.

## 3. Rules that keep this project honest (from the plan, section 0 and 12)
- No fake formats. If a font format cannot be verified, **disable its button and say why**. v3 wrote an OTF and named it `.woff2`.
- No hostile code (right-click blocking, devtools detection, `debugger`). `verify.mjs` enforces this.
- No CDN or runtime network dependency; everything is bundled (fonts included).
- All user-visible strings go through `t()`; add keys to **both** `en.json` and `bn.json` (a test checks key and placeholder parity).
- All saving, sharing, copying and file picking goes through `platform()`; never `<a download>`, `navigator.clipboard` or `confirm()` in UI code.
- Anything heavy goes in a worker. Keep the app shell JS under 150 KB gzipped (currently 103.6).
- Be honest in `PROGRESS.md` about what was not verified.

## 4. How to test properly (this found every serious bug so far)
**jsdom is not enough.** Canvas, workers, layout, real pointer/touch events and page unload only exist in a real browser. The authoring environment had no browser and blocked browser downloads, but the **npm package `@sparticuz/chromium` ships a Chromium binary inside the package**, and the npm registry was reachable:
```
mkdir -p /tmp/br && cd /tmp/br && npm init -y && npm install @sparticuz/chromium puppeteer-core
cd <repo> && npm run build:web                      # default BASE_PATH "/", e2e serves dist/
E2E_MODULES=/tmp/br node e2e/editor.e2e.mjs         # 33 checks
E2E_MODULES=/tmp/br node e2e/scan.e2e.mjs           # 25 checks
```
(or set `CHROMIUM_PATH` to any Chrome/Chromium). Screenshots go to `/tmp/e2e`; **look at them**. Background servers do not survive between tool calls in that sandbox: start the server and the test in the same command (`e2e/lib.mjs` does this itself).
Pitfalls already paid for (full list in DECISIONS D38): file choosers need a real click; one automatic download per page; measure sampled curves not Bezier anchors; a pixel read-back (`getImageData`) changes Chromium's canvas behaviour; vitest with `conditions: ['browser']` needs `// @vitest-environment jsdom` for DOM tests.
Also use **mutation checks**: break a behaviour on purpose and confirm a test fails. Several tests here passed for the wrong reason until this was done.

## 4b. Environment facts
Node 22, npm 10. TypeScript is pinned to 6 because `svelte-check` does not accept 7 yet (D1). Gradle and Google Maven are not reachable, so no APK can be built locally. `@capacitor/android` 8 needs Java 21 and compiles with Gradle 8.14.3 / AGP 8.13.0, `minSdk` 24, `compileSdk` 36 (confirmed from the generated project).

---
## 5. The work that remains

### M5. Real font export (`src/font/`), the biggest task
Specification: plan section 8.9. Done when: round-trip tests pass for every enabled format, no fake formats, the export report shows correct counts, and the preview renders with the real font.

Tasks, in order:
1. **Dependencies** (check they install and bundle): `opentype.js` for OTF (CFF), `fonteditor-core` for TTF, WOFF and WOFF2 (WOFF2 needs a WASM module; load it lazily, precache it, make sure `verify.mjs` still passes: no CDN URL may remain in the bundle, and check any new dependency for strings like the jsPDF one in D34).
2. **`build.ts`**: project to `opentype.Font`. `.notdef` and a `space` glyph are required. One glyph per project glyph, using **variant 0** as the default form; single code points map to Unicode (`char.codePointAt(0)`); multi-code-point keys (Bengali conjuncts such as `ক্ষ`) become named glyphs with no cmap entry, reachable only through ligatures. Convert `Contour` nodes to path commands (cubic `C`, `L` for handle-less segments, `Z`). Use `glyph.advance` as the advance width. Fill name-table fields from settings (family from the project name, subfamily, designer, license, version). Use `ascender`, `descender`, `unitsPerEm`, `xHeight`, `capHeight` and `italicAngle` from settings. Note `glyph.lsb`/`rsb` are design guides: the contours are already placed in glyph space, do not shift them again (confirm this against the editor guides when testing).
3. **`features.ts`**: ligatures as GSUB `liga`; kerning as GPOS `kern` pair adjustment. If the library cannot write a table, build the binary table in TypeScript and inject it; failing that, use the legacy `kern` table and **say so in the report**. Never drop data silently. Bengali: also register the user's conjunct ligatures under script tags `bng2` and `beng` (features `akhn`, `liga`) besides `DFLT`, and state the limitation in the UI: "Basic Bengali support: base letters and your own conjunct glyphs. Full automatic conjunct shaping is not included."
4. **Formats**: OTF from opentype.js; TTF, WOFF, WOFF2 by converting the OTF buffer with fonteditor-core (this converts cubic to quadratic curves and flips winding as TrueType needs). **Each format must have a test that builds, converts, re-parses and checks it.** If one fails here, disable its button with the reason (the buttons are already shown disabled with a text; see `src/app/routes/Export.svelte`).
5. **`verify.ts`**: re-parse the produced bytes; check glyph count, each drawn glyph has a non-empty path, **no glyph consists only of axis-aligned rectangles** (the v3 failure), kerning and ligature counts match the project. Show the **export report** ("212 glyphs, 0 empty, 41 kern pairs, 3 ligatures, 2 warnings") before saving. Warn about glyphs that are still bitmap-only (`legacyPng` without `traced`; the Export screen already offers conversion) and about empty glyphs.
6. **`compile.worker.ts`** with progress messages; reuse the pattern of `src/scan/engine.ts` (Worker plus in-process fallback behind one interface, so it is unit-testable).
7. **Export screen**: enable a format button only if its verification passed; save through `platform().saveFile(name, blob, mime)` (mimes: `font/otf`, `font/ttf`, `font/woff`, `font/woff2`). Also port `expCSS` (an honest `@font-face` snippet listing only formats that exist), `expSheet` (specimen sheet; jsPDF is already a lazy dependency and `src/scan/template-pdf.ts` shows the pattern, including rasterising Bengali via `src/scan/raster.ts`).
8. **Variants**: v3 settings `varMode` (random, cycle, first). Minimum: export variant 0. Stretch: export further variants as alternate glyphs with GSUB `rand` or `calt` cycling; if skipped, say so in the report.
9. **Preview** (`src/app/routes/Preview.svelte`): currently draws glyph outlines directly. Replace/augment with the real font: build the font blob, load it with `FontFace`, render text with CSS, so kerning and ligatures are visible. Add the v3 line-height and weight controls (listed open in PARITY). Keep the Bengali sample sentences.
10. Tests: unit tests for every function; a browser test (add to `e2e/`) that exports a font from a project with drawn glyphs, loads it with `FontFace` in the page and checks `document.fonts.check` plus a measured text width that changes when a kern pair is added.

### M6. Android polish (plan section 9)
- Phone editor: the canvas fills the screen; a floating tool palette (Draw, Pen, Erase, Select, Undo, Redo); a **bottom sheet** with peek/half/full snap points for brush, metrics, variants, reference, display and import. The current phone layout stacks the toolbar in three rows and squeezes the glyph title out of the top bar at 390 px (see the phone screenshot recipe in `e2e/`). Fix this first.
- Back-button chain (`platform.onBack`): close sheet, then modal, then leave the editor, then leave the project, then confirm exit. Never lose a drawing (strokes are already saved immediately, D24).
- Haptics: node snap (tick, done), glyph saved (success, done), warning on destructive confirm (add).
- Keyboard: modals scroll the focused input into view (done); verify with Bengali input; safe areas and `adjustResize` (patched in `scripts/patch-android.mjs`).
- Replace hover-only tooltips with long-press labels; `aria-label` on every icon button; focus states; contrast; `prefers-reduced-motion` (base.css has it).
- Camera on Android uses `Camera.takePhoto` (D9); test the permission flow and that cancelling returns `null`.
- Finalise `scripts/patch-android.mjs` and `android.yml`; **get the first APK building on GitHub** and fix whatever Gradle reports. This is the first time that path runs.

### M7. Website and PWA (plan section 10)
- Real landing page in `web/landing/` (plain HTML and CSS, under 30 KB, English/Bengali toggle, hero, three steps, features, **Open the app** and **Download Android APK** buttons using `__REPO_URL__/releases/download/latest/FontCraft.apk`, Open Graph tags, phone-first).
- **Register the service worker** (nothing does today). Web build only; the Android build must not register one (`verify.mjs` checks). `registerType: 'prompt'` with an "Update available" toast; scope and `start_url` already `${base}app/`.
- Precache must include the worker chunks, WOFF2 fonts and any WASM from M5; inspect the generated manifest. Add `.fcproj` `file_handlers` to the manifest.

### M8. Hardening
- Test with a 500-glyph project (create via script); move backup zipping and contour rebuild to workers if they stall; keep input at 60 fps.
- Empty and error states everywhere; a11y pass; remove leftovers (`ComingSoon.svelte`, unused i18n keys); optionally include reference images in `.fcproj`.
- Walk the README steps against the real workflows; final self-review against plan sections 0 and 12; update `PROGRESS.md` and `PARITY.md` so every line is ticked or has a reason.

## 6. Where to look for things
| Question | Look at |
|---|---|
| How are strokes turned into the exported outline? | `src/engine/geometry/` (`outline.ts`, `union.ts`, `fit.ts`, `build.ts`), `src/engine/art.ts` |
| How do the editor tools work? | `src/app/routes/Editor.svelte`, `src/engine/pen.ts`, `history.ts`, `pointers.ts`, `render.ts` |
| How does scanning work? | `src/scan/scan-core.ts` (pure), `scan-ops.ts`, `engine.ts`, `src/app/routes/Scan.svelte` |
| How is data stored and saved? | `src/storage/`, `src/app/stores/project.svelte.ts`, D24 in DECISIONS |
| Why was X chosen? | `docs/DECISIONS.md` |
| What is left from v3? | `docs/PARITY.md` |
