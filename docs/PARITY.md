# v3 parity checklist

Every feature of `legacy/fontcraft-v3.html`, with its v4 status. `[x]` means done and tested. `[ ]` names the milestone that owns it.
The v3 function names are given so each line can be traced to the source.

## Projects and data
- [x] Create project: name, character set (`latin`, `bengali`, `bengali-ext`, `latin-ext`, `all`), template cell size (`createProject`)
- [x] Open project; delete with a confirmation dialog instead of `confirm()` (`openProj`, `delProj`)
- [x] Dashboard: project cards, progress bar, glyph counts, welcome card (`renderDash`)
- [x] Autosave with badge (`sched`, `showASV`). v4: debounced IndexedDB, one record per glyph, flushed on hide and on pause
- [x] Migration of `localStorage['fc3']` to IndexedDB, originals never modified. Glyphs arrive as bitmap reference layers; tracing them to vectors is **M4**
- [x] Import of v3 `*_fontcraft.json` backups (`impJSON`) and of `.fcproj`
- [x] Project backup as `.fcproj` (replaces `expJSON`; the v3 JSON export format is intentionally not written any more)
- [x] Auto-backup every 20 glyph saves, last 5 kept per project, restore as a new project

## Character map
- [x] Latin, Bengali, digits and punctuation tabs (`setScript`, `CS`). Only scripts present in the project are offered
- [x] Virtualised glyph grid with drawn and variant markers, completion pills (`renderCmap`), "only empty" filter, "next empty"
- [x] Open a glyph in the editor (`openEd`)
- [x] Bengali glyph names (`BN`) shown in the accessible label of each cell
- [x] Template PDF download (`dlTemplate`), from the Glyphs screen

## Glyph editor
- [x] Draw tool, D: pressure-sensitive outlines (perfect-freehand), stabiliser, coalesced and predicted points
- [x] Erase tool, E: an area eraser. It cuts through ink and can split a stroke in two (supersedes the M2 whole-stroke eraser)
- [x] Bezier pen, B: tap adds a corner point, drag pulls curve handles, tap a point toggles smooth and sharp, handles stay draggable, Enter or Done to finish, C or Close path (at least 3 points), Esc to cancel (`bz*`). Closed paths are filled, open paths stroked, as in v3. Optional snapping to guides with a haptic tick
- [x] Select tool, V: tap a stroke or path, Delete removes it; selected pen paths show points that can be dragged
- [x] Brush size (`onBrSz`), brush colour and opacity (`onBrCol`, `onBrOp`). Colour and opacity are **display only** because a font has no colour; the panel says so
- [x] Undo, redo, clear, Ctrl+Z, Ctrl+Y (`undoC`, `redoC`, `clearC`). Command based, 200 steps. Two-finger tap undoes, three-finger tap redoes
- [x] Zoom in, out, fit; `+`, `-`, `0`; mouse wheel; two-finger pinch and pan (`zIn`, `zOut`, `zFit`). Zoom is remembered per glyph while the app is open
- [x] Guides toggle, G: baseline, x-height, cap height, ascender, descender, advance, bearings (`drawGuides`, `togGuides`)
- [x] Smooth strokes (`smoothStrokes`), replaced by the Smoothing (stabiliser) slider
- [x] Save glyph, Ctrl+S (`saveGlyph`); every finished stroke is also saved immediately
- [x] Metrics: advance, left and right bearing (`loadMets`), plus auto side bearings. The v3 bearing preview bar is replaced by the bearing guides drawn on the canvas
- [x] Up to 4 variants with switcher, add, remove (`addVar`, `renderVP`)
- [x] Reference image with opacity, choose and remove (`loadRef`, `clearRef`, `setRefOp`). Stored per glyph in IndexedDB. **Not** included in `.fcproj` yet
- [x] Live outline: shows the unioned, curve-fitted contours that will be exported, over the raw ink
- [x] Palm rejection while a stylus is in use; a second finger cancels a half-drawn finger stroke so no stray dot is left
- [x] Keyboard shortcuts dialog (all keys above)
- [x] Threshold clean-up (`applyThresh`): reborn as "Convert reference to outline" with a brightness cut-off, producing editable vector art
- [x] SVG import (`importSVG`): paths (all commands incl. arcs), basic shapes, group transforms; fitted into the glyph box as editable outline
- [ ] Moving or transforming selected strokes (not in v3 either): not planned

## Scanner
- [x] Template layout and pages (`scLayout`, `scPg`, `scCells`, `scCharOf`): `src/scan/scan-core.ts`, a pure port, shared with the PDF
- [x] Grid overlay with offsets, scale and 90 degree turns (`scUpdateGrid`, `scRot90`, `scParam`). v3 had no free rotation or perspective correction; none was invented
- [x] Page detection and auto-align (`scDetectPage`, `scAutoAlign`, `scResetGrid`)
- [x] Ink threshold, border trim, ignore the label strip (`scProcess`, `scAnalyze`, `scAnalyzeCell`), same defaults as v3 (128, 1 mm, on)
- [x] Zoomable, pannable view with pinch, wheel and fit (`scVP`, `scZoomAt`, `scFit`)
- [x] Cell strip with thumbnails, inspector, assign to another character, skip, nudge (`scStrip`, `scInspect`, `scAssign`, `scToggleSkip`, `scNudge`)
- [x] Import selected and import all (`scImportSel`, `importAll`), as **vector outlines** (v3 stored bitmaps)
- [x] Drag and drop, file chooser, camera (`platform.captureImage`)
- [x] Template mode versus custom grid mode (`scModeChange`)
- [x] Template PDF download (`dlTemplate`): now also draws Bengali guide letters (v3's Helvetica could not)
- [ ] Printed Bengali name labels (`BN` strings) on the template: not printed, only cell number and U+ code. Optional polish

## Ligatures and kerning
- [x] Ligature list, add, remove (`renderLigs`, `saveLig`, `delLig`); fields `input`, `output`, `name`; at least two characters required
- [x] Kerning list, add, update without duplicating, remove (`renderKern`, `saveKP`, `delKP`); fields `left`, `right`, `value`
- [x] Kerning visualiser (`kViz`)

## Preview
- [x] Live preview drawn from the project's own glyphs with kerning and tracking applied
- [x] Size, letter spacing, colour (`pvSz`, `pvLS`, `pvCol`), background cycling (`cycleBG`), copy text through the platform adapter (`copyPvTxt`)
- [x] Sample texts including the Bengali sentences (`PG`); missing glyphs are reported
- [ ] Line height and weight controls (`pvLH`, `pvFW`): **M5**, they only make sense once text is rendered by a real font
- [ ] Rendering with the exported font through `FontFace`: **M5**

## Export
- [x] Export readiness summary (`renderExp`)
- [ ] OTF, TTF, WOFF, WOFF2 (`expFont`): **M5**. The buttons are visible but disabled with the reason stated
- [ ] CSS `@font-face` snippet (`expCSS`): **M5**
- [ ] Specimen sheet (`expSheet`): **M5**

## Settings
- [x] Font name, style, designer, license, version (`loadSets`, `saveSets`)
- [x] UPM, ascender, descender, x-height, cap height, default advance and bearings, variant mode, italic angle, tracking
- [x] Language (English, বাংলা) and theme (new)

## Chrome
- [x] Toasts, modals, autosave badge (`toast`, `openM`, `closeM`, `showASV`)
- [x] Left rail on desktop, bottom navigation on phones
- [ ] Bottom sheet for editor panels, long-press labels instead of hover tooltips, haptic ticks on snapping: **M6**

## Deliberately not ported
- dropped (hostile code): right-click blocking, F12 and Ctrl+Shift+I/J/C/K and Ctrl+U blocking, the devtools window-size check and the `debugger` timer (v3 lines 1547–1563)
- dropped (fake format): renaming an OTF as `.woff2`
- dropped (network): CDN scripts and Google Fonts; everything is bundled
