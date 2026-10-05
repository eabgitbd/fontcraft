# Progress

Plan: `docs/BUILD_PLAN.md` (the original specification). Decisions: `docs/DECISIONS.md`. v3 feature checklist: `docs/PARITY.md`.
**Hand-off guide for the next agent: `docs/HANDOFF.md`** (read it first).

## Status: milestones M0 to M4 are done and verified. M5 (real font export) is next.

| Milestone | State | What it delivered |
|---|---|---|
| **M0** Skeleton and pipeline | done | Vite 8, TypeScript 6 (strict), Svelte 5; `web` and `android` build modes; landing placeholder; `verify.mjs`, `make-icons.mjs`, `patch-android.mjs`; both GitHub workflows (from plan section 6); owner README |
| **M1** Foundations | done | Design tokens (dark plus light), hash router, English and Bengali strings, layout (rail, bottom navigation), modal, toasts, IndexedDB storage, debounced autosaver, web and Android platform adapters |
| **M2** Parity port | done | Projects (create, open, delete, import), virtualised glyph map, ligature and kerning screens, preview, font settings, `.fcproj` and v3 JSON import, first-launch migration from `localStorage['fc3']`, auto-backups |
| **M3** Drawing engine | done | Pressure-aware strokes, stabiliser, Bezier pen, area eraser, select, zoom and pan, palm rejection, multi-touch gestures, command history, union and curve fitting, live outline, reference image |
| **M4** Scanner and tracing | done | Scan screen (worker), template PDF (incl. Bengali), marching-squares tracer, SVG import, reference tracing, v3 bitmap to vector conversion, `traced` art layer |
| **M5** Real font export | **not started** | see the plan below |
| **M6** Android polish | not started | |
| **M7** Website and PWA | not started | |
| **M8** Hardening | not started | |

## Verification (last run, all green)
```
npm run typecheck                                        0 errors, 0 warnings
npm test                                                 367 tests in 24 files, exit code 0
BASE_PATH=/fontcraft/ npm run build:web && verify web    PASSED
npm run build:android && verify android                  PASSED
npm run build:web && node e2e/editor.e2e.mjs             33 of 33 checks (real Chromium)
npm run build:web && node e2e/scan.e2e.mjs               25 of 25 checks (real Chromium)
```
Source: about 8,000 lines in `src/`, about 4,350 lines of tests and browser tests. Source scans: no `debugger`, `contextmenu` or window-size checks; no `navigator.clipboard`, `showSaveFilePicker` or download anchors outside `src/platform/`; no CDN host in either build.

Bundle (gzip): app shell JS 103.6 KB (budget 150), CSS 6.0 KB, scan worker 8.3 KB, Android plugin chunk 4.8 KB (lazy), jsPDF 123.8 KB (lazy, only when a template is made). Offline precache 24 entries, 1.1 MB.

## What was learned the hard way (bugs found by running the real app)
The jsdom unit suite cannot see canvas, worker, layout or page-unload behaviour. Running the built app in a real Chromium found these, all fixed and now covered by `e2e/`:
1. Editor canvases were never sized (setup ran before they existed): nothing drew.
2. `#app` had no height: every screen was about 80 px too short.
3. Clear left stale ink (offscreen canvas then `drawImage` onto the display canvas). Ink is now its own displayed layer (D23).
4. A stroke drawn just before a reload was lost: unload cannot finish chained IndexedDB reads, nor sometimes even a single write. Strokes are now written on the next tick with read-free `put`s (D24).
5. jsPDF carried a CDN URL and three unused optional libraries; the verifier caught it (D34).
Roughly thirty deliberate breakages (mutations of key behaviour) were each confirmed to make a unit test fail; mutation checking is part of how this project is verified (see `docs/HANDOFF.md` section 4).

## NOT verified (be honest about these)
- **No APK has ever been built.** Gradle and Google's Maven are unreachable from the authoring environment. The first run of **Build APK app** on GitHub is the real test. Verified locally only: `cap add android`, `capacitor-assets generate`, `patch-android.mjs` against a real generated project (idempotent).
- **No physical device.** Touch and stylus were exercised with Chromium's synthetic events (faithful for pointer logic, not for a digitiser: palm size, hover, tilt, latency) and the Android WebView itself has not run the app.
- **The phone layout is cramped** (toolbar takes three rows, glyph title squeezed out of the top bar at 390 px). That is the M6 redesign, not a bug in M3 or M4.
- **No service worker is registered anywhere** (vite-plugin-pwa is configured with `injectRegister: false` and nothing registers it yet). The manifest and precache exist; registration and the update toast are M7.
- Scanning was tested on synthetic photos (shifted, scaled, noisy, JPEG, rotated), not on real phone photos with lens distortion, shadows or perspective. v3 had no perspective correction and none was added.
- `npm audit`: 0 vulnerabilities in production dependencies. Seven findings in build-time tools (`@capacitor/assets`, `sharp`), which only run in CI on the repository's own icon.

## Known issues and small backlog
- Reference images are stored in IndexedDB but not included in `.fcproj`.
- Imported (`traced`) art cannot be selected individually; undo, the eraser or Clear remove it.
- The template does not print the Bengali name labels (`BN`), only cell number and U+ code.
- Contour rebuild is synchronous at each stroke end (about 27 ms for a 600-point stroke); a glyph with many dozens of strokes will be slower. Backup zipping (`fflate.zipSync`) is also on the main thread.
- Leftovers: `src/app/routes/ComingSoon.svelte` is only a fallback now; some i18n keys are unused (`editor.leave.title`, `screen.soon.*`).
- Scan images are capped at 5000 px on the long side; only 90 degree rotation; no lens or perspective correction.
- Android: haptics, share sheet, camera and back button are implemented in `src/platform/android.ts` and unit tested against mocked plugins only.

## Plan for the rest (details and acceptance criteria are in `docs/HANDOFF.md`)
1. **M5 Real font export** (largest remaining task): `src/font/` with `build.ts`, `features.ts` (GSUB liga, GPOS kern), `verify.ts`, `compile.worker.ts`; OTF, TTF, WOFF, WOFF2 each enabled only if a re-parse test passes; export report; CSS snippet; specimen sheet; real-font preview with `FontFace`; Bengali ligatures under `bng2`/`beng`.
2. **M6 Android polish**: phone editor (floating tool palette, bottom sheet with snap points), back-button chain, haptics, safe areas and keyboard, long-press labels, a11y pass, finalise `patch-android.mjs`, get the first APK building on GitHub.
3. **M7 Website and PWA**: real landing page (under 30 KB, both APK links), service-worker registration with update toast, `.fcproj` file handler, precache check.
4. **M8 Hardening**: 500-glyph performance (workers for backup and contour rebuild), empty and error states, a11y, README verified step by step against the workflows, final self-review against plan sections 0 and 12.
