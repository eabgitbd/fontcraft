# Decisions

Each entry: what was decided, why, and what it replaces.

## D1. TypeScript 6 instead of 7
`svelte-check` declares a peer dependency of TypeScript `^5 || ^6`. The plan says to install the latest stable release of everything; TypeScript 7 exists but `npm install` refuses the combination. TypeScript 6 (latest 6.x) is the newest version every tool accepts. Revisit when `svelte-check` supports 7.

## D2. Everything else at latest stable
Vite 8, Svelte 5, Capacitor 8, vite-plugin-pwa 1, Vitest 5, idb 8, fflate 0.8. Exact versions are frozen by the committed `package-lock.json`.

## D3. Landing page is moved after the build
Vite builds both HTML entries under `dist/landing/` and `dist/app/`. A `closeBundle` plugin moves `dist/landing/index.html` to `dist/index.html`. Asset URLs are absolute (they start with `BASE_PATH`), so no rewriting is needed. A relative `BASE_PATH` is not supported for the web build.

## D4. Icons for the studio are copied into `dist/app/`
`web/app/public/` holds the PWA icons. In web mode `publicDir` is disabled and a plugin copies that folder to `dist/app/`, so the manifest icon URLs under `/app/` resolve. In Android mode the folder is the normal `publicDir` of the `web/app` root.

## D5. Service worker lives at the site root, scoped to `/app/`
`vite-plugin-pwa` writes `sw.js` to `dist/`. It is registered with scope `${BASE_PATH}app/` (narrower than its location, which browsers allow), so it never controls the landing page.

## D6. Only WOFF2 font files are precached
Fontsource ships WOFF and WOFF2. Every browser and Android WebView this app targets supports WOFF2, so WOFF is excluded from the precache to keep offline storage small.

## D7. Fonts are imported by subset
Inter (variable, `wght.css`, unicode-range split), JetBrains Mono Latin 400/500, Noto Sans Bengali Bengali-subset 400/600. This keeps the shell small while Bengali UI text still renders.

## D8. Native plugins are a lazy chunk
`src/platform/index.ts` calls `Capacitor.isNativePlatform()` once and only then `import('./android')`. The web bundle therefore carries no Capacitor plugin code (the chunk is about 4.8 KB gzipped and is never fetched in a browser).

## D9. Camera uses `takePhoto`, not `getPhoto`
`@capacitor/camera` 8 marks `getPhoto` deprecated. `captureImage()` uses `Camera.takePhoto`, then fetches the returned file URI through `Capacitor.convertFileSrc` to get a Blob.

## D10. Back button at the root minimises the app
The app registers one back handler. On any screen except Projects it navigates to Projects and consumes the event. At Projects it declines, and the Android adapter calls `App.minimizeApp()` instead of killing the app. The "ask before leaving" flow (plan section 9) is part of M6, when the editor has unsaved state to protect.

## D11. `localStorage` holds UI preferences only
Language and theme live in `localStorage['fc4.settings']`. Project data never does. `localStorage['fc3']` is read-only input for the future migration.

## D12. Java 21 confirmed
The installed `@capacitor/android` 8 compiles with `JavaVersion.VERSION_21`, matching the workflow's Zulu 21. Its generated Gradle wrapper uses Gradle 8.14.3 with Android Gradle Plugin 8.13.0, `compileSdk`/`targetSdk` 36, `minSdk` 24.

## D13. IndexedDB transactions are not aborted on "not found"
Calling `tx.abort()` made `tx.done` reject with nobody listening, which surfaced as an unhandled rejection in tests. The not-found paths now throw and let the empty transaction commit.

## D14. Migrated glyphs start bitmap-backed, then are traced (resolved by D36)
`migrate-v3.ts` stores each v3 PNG as `Variant.legacyPng` and leaves `strokes` and `contours` empty. A glyph counts as drawn if it has strokes, contours or a bitmap. The editor shows the bitmap as a reference layer and the preview draws it as an image. **Real font export (M5) needs vector contours**, so tracing these bitmaps is a required M4 task, not optional.

## D15. `.fcproj` is written with synchronous fflate
`zipSync` keeps the code simple and testable. It runs on the main thread, which is fine for normal projects but may pause the UI on very large ones. Moving it to a worker is on the M8 list.

## D16. A restored or imported project is always a new project
Import, backup restore and migration never overwrite an existing project. A project's `id` is regenerated on every import, so importing the same file twice gives two projects rather than silent data loss.

## D17. Erase removes whole strokes in M2 (superseded by D21)
The temporary M2 editor deleted every stroke the eraser touched. M3 replaced it with an area eraser.

## D18. Only scripts present in the project get a tab
A Bengali-only project shows one tab; v3 showed four tabs, three of them permanently empty. Characters a project does not contain are never shown as editable cells.

## D19. "Next empty" opens the glyph in the editor
It takes the first glyph without a drawing in the active script and opens it. It does not merely scroll, because the next action is always to draw it.

## D20. polygon-clipping instead of paper.js for boolean operations
The plan names paper.js with a fallback. polygon-clipping is pure JavaScript, has no DOM dependency (so the geometry is unit tested in Node), and handled self-overlapping stroke outlines correctly in a probe. On a spiral outline it was about 16 times faster than a capsule-union reference (11 ms against 187 ms). Curve fitting is our own Schneider implementation (`src/engine/geometry/fit.ts`).

## D21. The eraser is a stroke flagged `erase`, applied in order
Eraser input is stored as a stroke with `erase: true`. The shape builder unions consecutive ink strokes and subtracts each eraser stroke from everything drawn before it, so erasing can split a stroke and drawing after erasing puts ink back. Eraser size is 1.5 times the brush size. An eraser stroke on an empty glyph is not recorded.

## D22. Pen paths are stored as `Variant.paths`
`paths` is an optional array of `Contour & { size }`. Like strokes it is raw input. `contours` stays the derived result (union plus curve fit) that export will use. Pen paths sit underneath strokes, so an eraser stroke can cut them too. Because the union re-fits the outline, an isolated pen path is reproduced within the fitting tolerance, not node for node.

## D23. Ink is its own displayed canvas layer
The editor has three stacked canvases: display layer (opaque: workspace, guides, reference), ink layer (transparent), live layer (current stroke, pen overlay, selection). An earlier version drew ink to an offscreen canvas and copied it onto the display canvas. In real Chromium that left stale pixels after Clear for some strokes, which jsdom could never show. Showing the ink canvas directly (opacity is CSS) removes the canvas-to-canvas copy and was verified in the browser.

## D24. Saving: read-free writes, and strokes are saved immediately
During page unload Chromium runs the first IndexedDB request but not a chain of read-then-write requests, and even a request issued in `pagehide` may not commit. So (1) autosave uses `putGlyphAndProject`, one transaction of two `put`s with counters computed from the in-memory state, and (2) a finished stroke is written on the next tick instead of after the 300 ms debounce (typing in a metric field still debounces). Measured: the stroke is in IndexedDB within tens of milliseconds and survives an immediate reload.

## D25. Contours are rebuilt synchronously at each commit
Union plus curve fit runs when a stroke ends, a path is applied, or on undo, redo, clear and delete. Measured in Chromium: a 600-point stroke commits in about 27 ms, and pointer-move handling has a p95 of 0.2 ms. A glyph with many dozens of strokes will take longer; moving this to a worker is on the M8 list.

## D26. Double-tap to fit works in the Select tool only
In the drawing tools a first tap already makes a dot, so a double-tap gesture would leave stray ink. Fit is always available from the Fit button, the `0` key, and as a side effect of the Select tool's double tap.

## D27. Brush colour and opacity are display only
They change how ink looks in the editor so a reference image can be seen through it. They are not stored in the font or the project. The panel states this.

## D28. A real-browser test lives in `e2e/` and is not part of CI
`npm run build:web && node e2e/editor.e2e.mjs` drives the built app in Chromium over CDP with real mouse, pen (with pressure) and touch events (33 checks). It needs a Chromium binary (`CHROMIUM_PATH`) or `puppeteer-core` plus `@sparticuz/chromium` resolvable from `E2E_MODULES`; neither is a repository dependency, to keep installs light. It found three defects that the jsdom suite could not (D23, D24, and `#app` having no height).

## D29. Own marching-squares tracer, not a Potrace WASM package
The plan allowed either. `src/scan/trace.ts` contours the 0..255 coverage field at an iso level, so edges are sub-pixel accurate (no stair-steps), links segments by grid-edge identity (loops always close exactly), resolves saddles with the centre value, then feeds the same curve fitter as hand-drawn strokes. No dependency, no WASM to precache, fully unit tested in Node. Ring nesting is decided by even-odd containment (`geometry/rings.ts`), and winding is normalised afterwards.

## D30. Imported artwork is a new layer, `Variant.traced`
A traced scan, a traced v3 bitmap, an SVG or a traced reference picture is stored as `Contour[]` (outer clockwise, holes counter-clockwise). It is raw input like strokes: it is unioned underneath pen paths and strokes, so the eraser can clean it up and Clear removes it. `contours` stays the derived export result. `EditState` carries `traced`; `SetTraced` makes imports undoable. Traced art is not individually selectable (undo, eraser or Clear remove it).

## D31. Scan geometry is a pure port of v3, with a defined glyph placement
No perspective correction was added (v3 had none: scale and offset per axis plus 90 degree turns). Cell to font mapping: for the FontCraft template the printed guide lines are the reference (baseline at 74% of the cell maps to 0, the cap line at 18% maps to the project's cap height, uniform scale); for a custom grid the cell height spans ascender to descender. The ink is shifted so it starts at the default left bearing and the advance is derived as ink width plus both default bearings (v3 kept the cell position). Original positions can be adjusted afterwards in the editor.

## D32. Heavy scan work runs in a worker behind one interface
`ScanEngine` has `WorkerEngine` (module worker; decode with `createImageBitmap` and `OffscreenCanvas`; pixel buffer transferred, not copied) and `DirectEngine` (same code in-process, used by tests and as a fallback). Images are capped at 5000 px on the long side. The UI never touches pixels. The real worker is exercised only by the browser suite.

## D33. The template PDF and the scanner share one layout function
`buildTemplatePdf` draws every cell from `scLayout`, so what is printed and what is read cannot drift. v3 printed the large pale guide letter with Helvetica, which cannot draw Bengali, so on Bengali templates it never rendered. Bengali guide letters and the Bengali instruction line are now rasterised through the bundled Noto Sans Bengali (`raster.ts`) and embedded as images (156 images in a Bengali template).

## D34. jsPDF optional dependencies are stubbed and its CDN URL removed
jsPDF can import html2canvas, canvg and dompurify (only for `doc.html()` and SVG images, never used here) and names a CDN script for its `pdfobjectnewwindow` output. `vite.config.ts` aliases the three libraries to `src/shared/empty-module.ts` and strips the URL, so `verify.mjs` stays strict ("no CDN host anywhere") and the offline precache stays near 1.1 MB. jsPDF itself (about 124 KB gzipped) is a lazy chunk loaded only when a template is made.

## D35. Cell sizes are small, medium and large (6, 4 and 3 columns)
As in v3. `standard` is treated as medium so data from the M2 builds still works.

## D36. Bitmap to vector conversion for v3 data
The mapping is v3's own exporter mapping (whole picture to x 0..advance, y ascender..descender); coverage is red channel times alpha with the iso level at v3's "red > 128" test. Verified in a real browser to land within 4 units of where v3 would have exported it. The original bitmap stays as a reference layer. It runs after the first-launch migration, after importing a project file, and from a button on the Export screen when bitmaps remain. It is idempotent.

## D37. Import policy for scanned glyphs
Into an empty glyph the art goes to variant 1 and sets the glyph widths. If the glyph already has a drawing the default is to add another variant (up to four, then the last is replaced); "replace the first version" is the alternative. Only variant 1 sets the glyph widths. "Import all" skips cells already imported in the session.

## D38. Browser-test lessons (so they are not rediscovered)
- File choosers need a real mouse click (puppeteer `ElementHandle.click`), not `element.click()` from script.
- Chromium allows one automatic download per page: use a fresh page for a second download, and wait for the finished `.pdf`, not the `.crdownload`.
- When asserting geometry measure the sampled curves, not Bezier anchor points: the tip of a round cap lies between anchors.
- A jsdom pass is not evidence for canvas, worker, layout or unload behaviour. Three real bugs in M3 and one verifier hit in M4 were found only by running the built app in Chromium.
