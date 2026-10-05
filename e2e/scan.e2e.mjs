#!/usr/bin/env node
// Real-browser test of the scanner, template PDF, v3 bitmap conversion, SVG import and reference tracing.
//   npm run build:web && node e2e/scan.e2e.mjs      (see e2e/lib.mjs for how a browser is found)
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { start, wait } from './lib.mjs';

const { page, cdp, url, problems, check, shot, finish, browser } = await start({ viewport: { width: 1200, height: 900, deviceScaleFactor: 1, hasTouch: false } });
const tmp = '/tmp/e2e-scan';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
let workers = 0;
page.on('workercreated', () => workers++);

const findButton = (re) => page.evaluateHandle((src) => { const r = new RegExp(src); return [...document.querySelectorAll('button, a.btn')].find((x) => r.test(x.textContent.trim())) ?? null; }, re.source);
/** Real mouse click (a programmatic one has no user activation, so the browser would refuse file dialogs). */
const realClick = async (re) => { const h = await findButton(re); const el = h.asElement(); if (!el) throw new Error('no button ' + re); await el.click(); };
const chooseFile = async (re, path) => { const [fc] = await Promise.all([page.waitForFileChooser(), realClick(re)]); await fc.accept([path]); };
const until = async (fn, what, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(100); } console.log('   (timed out waiting for ' + what + ')'); return false; };
const idbGlyph = (ch) => page.evaluate((ch) => new Promise((res) => { const o = indexedDB.open('fontcraft'); o.onsuccess = () => { const a = o.result.transaction('glyphs').objectStore('glyphs').getAll(); a.onsuccess = () => res(a.result.find((g) => g.char === ch) ?? null); }; }), ch);
/** Extent of the real curves (sampled), not just the anchor points: a round cap's tip lies between anchors. */
const bounds = (g, vi = 0) => {
  const xs = [], ys = [];
  for (const c of g.variants[vi].contours) {
    const n = c.nodes.length;
    for (let i = 0; i < n; i++) {
      const a = c.nodes[i], b = c.nodes[(i + 1) % n];
      const p0 = a.p, p1 = a.hOut ?? a.p, p2 = b.hIn ?? b.p, p3 = b.p;
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        xs.push(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x);
        ys.push(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y);
      }
    }
  }
  return { minY: Math.min(...ys), maxY: Math.max(...ys), minX: Math.min(...xs), maxX: Math.max(...xs) };
};

/** Draws what a phone photo of the printed template looks like: shifted and scaled, handwriting, noise, JPEG. */
const makeScan = (opts) => page.evaluate((o) => {
  const ppm = 6, k = o.scale, dx = o.dx, dy = o.dy;
  const W = 210 * ppm, H = 297 * ppm;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const X = (mm) => (mm * k + dx) * ppm, Y = (mm) => (mm * k + dy) * ppm, S = (mm) => mm * k * ppm;
  x.fillStyle = '#0f0f11'; x.fillRect(0, 0, W, Y(24));
  const cols = 4, cw = 46, left = 12, gap = 2, top = 31;
  for (let r = 0; r < 5; r++) for (let cI = 0; cI < cols; cI++) {
    const cx = left + cI * (cw + gap), cy = top + r * (cw + gap);
    x.strokeStyle = 'rgb(175,175,195)'; x.lineWidth = Math.max(1, S(0.28)); x.strokeRect(X(cx), Y(cy), S(cw), S(cw));
    x.lineWidth = Math.max(1, S(0.15));
    for (const [f, col] of [[0.18, 'rgb(160,160,240)'], [0.4, 'rgb(140,190,240)'], [0.74, 'rgb(160,210,160)'], [0.88, 'rgb(240,160,160)']]) {
      x.strokeStyle = col; x.beginPath(); x.moveTo(X(cx + 1.5), Y(cy + cw * f)); x.lineTo(X(cx + cw - 1.5), Y(cy + cw * f)); x.stroke();
    }
  }
  // hand-drawn A, B, C, D in the first four boxes (cap line is 18% down the box, baseline 74%)
  x.strokeStyle = '#101015'; x.lineWidth = S(0.9); x.lineCap = 'round'; x.lineJoin = 'round';
  const box = (gi) => ({ x: left + (gi % cols) * (cw + gap), y: top + Math.floor(gi / cols) * (cw + gap) });
  const P = (b, fx, fy) => [X(b.x + fx * cw), Y(b.y + fy * cw)];
  const path = (pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p))); x.stroke(); };
  let b = box(0); path([P(b, 0.25, 0.74), P(b, 0.5, 0.19), P(b, 0.75, 0.74)]); path([P(b, 0.35, 0.5), P(b, 0.65, 0.5)]);
  b = box(1); path([P(b, 0.3, 0.19), P(b, 0.3, 0.74)]); x.beginPath(); x.moveTo(...P(b, 0.3, 0.19)); x.bezierCurveTo(...P(b, 0.75, 0.15), ...P(b, 0.75, 0.46), ...P(b, 0.3, 0.46)); x.bezierCurveTo(...P(b, 0.8, 0.46), ...P(b, 0.8, 0.78), ...P(b, 0.3, 0.74)); x.stroke();
  b = box(2); x.beginPath(); x.moveTo(...P(b, 0.72, 0.28)); x.bezierCurveTo(...P(b, 0.4, 0.1), ...P(b, 0.22, 0.4), ...P(b, 0.3, 0.55)); x.bezierCurveTo(...P(b, 0.4, 0.85), ...P(b, 0.65, 0.78), ...P(b, 0.74, 0.66)); x.stroke();
  b = box(3); path([P(b, 0.3, 0.19), P(b, 0.3, 0.74)]); x.beginPath(); x.moveTo(...P(b, 0.3, 0.19)); x.bezierCurveTo(...P(b, 0.85, 0.2), ...P(b, 0.85, 0.74), ...P(b, 0.3, 0.74)); x.stroke();
  // sensor noise
  const img = x.getImageData(0, 0, W, H); let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) { seed = (seed * 16807) % 2147483647; const n = ((seed / 2147483647) - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  let out = c;
  if (o.rotate) { out = document.createElement('canvas'); out.width = H; out.height = W; const y = out.getContext('2d'); y.translate(0, W); y.rotate(-Math.PI / 2); y.drawImage(c, 0, 0); } // lying on its side
  return out.toDataURL('image/jpeg', 0.85);
}, opts);
const save = (name, dataUrl) => { const p = join(tmp, name); writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64')); return p; };
const newProject = async (name, set = 'latin') => {
  await page.evaluate((s) => { location.hash = '#/'; }, set);
  await wait(200);
  await (await findButton(/New font/)).asElement().click();
  await page.waitForSelector('#np-name');
  await page.type('#np-name', name);
  await page.select('#np-set', set);
  await (await findButton(/^Create$/)).asElement().click();
  await page.waitForSelector('a.gc');
};

console.log('Setup');
await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate(() => { delete window.showSaveFilePicker; });
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp });
await newProject('Scan E2E');

console.log('Template PDF');
await realClick(/Template PDF/);
await until(() => readdirSync(tmp).some((f) => f.endsWith('.pdf')), 'PDF download');
await wait(300);
const pdfName = readdirSync(tmp).find((f) => f.endsWith('.pdf'));
const pdf = pdfName ? readFileSync(join(tmp, pdfName)) : Buffer.alloc(0);
check('a PDF file is downloaded', pdf.slice(0, 5).toString() === '%PDF-', pdfName);
check('it has three pages for the Latin set', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length === 3);
check('it names the font', pdf.toString('latin1').includes('Scan E2E - Handwriting Template'));

console.log('Scanning a photographed template');
await page.evaluate(() => (location.hash = '#/scan'));
await page.waitForFunction(() => document.body.textContent.includes('Bring in your handwriting'));
const scan1 = save('scan1.jpg', await makeScan({ scale: 1.03, dx: 4, dy: 3, rotate: false }));
await chooseFile(/Open scan or photo/, scan1);
await until(() => page.evaluate(() => document.querySelectorAll('button.cellbtn').length === 20), 'cells');
await until(() => page.evaluate(() => document.querySelectorAll('button.cellbtn.ink').length >= 4), 'ink flags');
await wait(300);
const flagged = await page.evaluate(() => [...document.querySelectorAll('button.cellbtn.ink')].map((b) => b.getAttribute('aria-label')[0]).join(''));
check('the scan is read by a Web Worker, not the UI thread', workers >= 1, `${workers} worker(s)`);
check('handwriting is found in exactly boxes A, B, C and D (JPEG noise ignored)', flagged === 'ABCD', flagged);
await shot('s1-scan-screen');
const canvasInk = await page.evaluate(() => { const c = document.querySelector('canvas[aria-label="Scanned page"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 90 && d[i] < 130 && d[i + 2] > 200) n++; return n; });
check('the grid overlay is drawn on the scan', canvasInk > 200, `${canvasInk} overlay px`);

await realClick(/Import all with handwriting/);
await until(() => page.evaluate(() => document.querySelectorAll('button.cellbtn.done').length === 4), 'imports', 30000);
const A = await idbGlyph('A');
await wait(800);
const A2 = await idbGlyph('A');
check('four glyphs are imported', (await page.evaluate(() => document.querySelectorAll('button.cellbtn.done').length)) === 4);
check('the traced A is stored as editable vector art', A2?.variants[0].traced?.length > 0 && A2.variants[0].contours.length > 0 && A2.variants[0].strokes.length === 0);
const bA = A2 ? bounds(A2) : null;
check('its top is near the cap height (700) and its foot near the baseline (0)', bA && bA.maxY > 640 && bA.maxY < 780 && bA.minY > -50 && bA.minY < 40, bA ? `${Math.round(bA.minY)}..${Math.round(bA.maxY)}` : '');
check('it is placed at the left bearing with a sensible advance', A2 && A2.lsb === 50 && A2.advance > 400 && A2.advance < 900, A2 ? `advance ${A2.advance}` : '');
check('the curve fitting keeps the outline small', A2 && A2.variants[0].contours[0].nodes.length < 60, A2 ? `${A2.variants[0].contours[0].nodes.length} nodes` : '');
const Bg = await idbGlyph('B');
check('B has a counter (two holes)', Bg && Bg.variants[0].contours.length >= 3, Bg ? `${Bg.variants[0].contours.length} contours` : '');
await shot('s2-imported');
await page.evaluate(() => (location.hash = '#/editor/A'));
await page.waitForSelector('canvas.live');
await wait(500);
await shot('s3-editor-imported-A');
const edInk = await page.evaluate(() => { const c = document.querySelectorAll('canvas')[1]; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
check('the imported glyph shows in the editor as ink you can draw on', edInk > 1500, `${edInk}px`);

console.log('A photo lying on its side');
await page.evaluate(() => (location.hash = '#/scan'));
await wait(300);
const scan2 = save('scan2.jpg', await makeScan({ scale: 1.0, dx: 0, dy: 0, rotate: true }));
await chooseFile(/Open scan or photo/, scan2);
await until(() => page.evaluate(() => document.querySelectorAll('button.cellbtn').length === 20), 'cells (rotated)');
await wait(900);
const before = await page.evaluate(() => document.querySelectorAll('button.cellbtn.ink').length);
await realClick(/Rotate 90/);
await until(() => page.evaluate(() => document.querySelectorAll('button.cellbtn.ink').length === 4), 'ink after rotating', 8000);

check('a sideways photo is not misread as A, B, C, D', before === 0 || before !== 4, `${before} flagged before rotating`);
check('after Rotate 90° the four boxes are found', (await page.evaluate(() => document.querySelectorAll('button.cellbtn.ink').length)) === 4);

console.log('v3 bitmaps become vectors');
const v3 = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 384; c.height = 384;
  const x = c.getContext('2d'); x.fillStyle = '#0f0f11'; x.fillRect(0, 0, 384, 384);
  x.strokeStyle = '#fff'; x.lineWidth = 34; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(120, 90); x.lineTo(120, 290); x.lineTo(270, 290); x.stroke(); // an "L" in the middle of the box
  return c.toDataURL('image/png');
});
await page.evaluate((png) => {
  localStorage.setItem('fc3', JSON.stringify([{ id: 'old1', name: 'Old Hand', set: 'latin', cell: 'medium', chars: { L: { variants: [png], advance: 600, lsb: 50, rsb: 50 }, M: { variants: [null], advance: 500, lsb: 50, rsb: 50 } }, ligatures: [], kerning: [], settings: {} }]));
  indexedDB.deleteDatabase('fontcraft');
}, v3);
await page.evaluate(() => { localStorage.removeItem('fc4.current'); });
await page.goto(url, { waitUntil: 'networkidle0' });
await until(async () => (await page.evaluate(() => document.body.textContent.includes('Old Hand'))), 'migrated project');
await until(async () => { const g = await idbGlyph('L'); return g?.variants[0].traced?.length > 0; }, 'bitmap converted to vectors', 20000);
const L = await idbGlyph('L');
check('the migrated bitmap was converted to vector art', L?.variants[0].traced?.length > 0 && L.variants[0].contours.length === 1);
check('the original picture is kept as a reference layer', L?.variants[0].legacyPng instanceof Blob || L?.variants[0].legacyPng !== undefined);
const bL = L ? bounds(L) : null;
// v3 mapped the whole 384px picture to x 0..600 and y 800..-200: the L spans px 103..287 x 73..307
const expX = [(103 / 384) * 600, (287 / 384) * 600], expY = [800 - (307 / 384) * 1000, 800 - (73 / 384) * 1000];
check('it sits exactly where v3 would have exported it (within 4 units)', bL && Math.abs(bL.minX - expX[0]) < 4 && Math.abs(bL.maxX - expX[1]) < 4 && Math.abs(bL.minY - expY[0]) < 4 && Math.abs(bL.maxY - expY[1]) < 4, bL ? JSON.stringify({ x: [Math.round(bL.minX), Math.round(bL.maxX)], y: [Math.round(bL.minY), Math.round(bL.maxY)], expX: expX.map(Math.round), expY: expY.map(Math.round) }) : '');
check('the original v3 data is untouched', await page.evaluate(() => JSON.parse(localStorage.getItem('fc3')).length === 1));

console.log('SVG import and reference tracing');
await page.evaluate(() => (location.hash = '#/'));
await page.waitForSelector('a.open');
await page.click('a.open');
await page.waitForSelector('a.gc');
await page.evaluate(() => (location.hash = '#/editor/M'));
await page.waitForSelector('canvas.live');
await wait(400);
const svgPath = join(tmp, 'star.svg');
writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L61 38 L96 38 L68 58 L79 92 L50 71 L21 92 L32 58 L4 38 L39 38 Z"/></svg>');
await chooseFile(/^Import SVG$/, svgPath);
await wait(700);
const M = await idbGlyph('M');
check('an SVG becomes editable outline in the glyph', M?.variants[0].traced?.length === 1 && M.variants[0].contours.length === 1);
const bM = M ? bounds(M) : null;
check('it is centred inside the glyph box', bM && bM.minY > -200 && bM.maxY < 800 && Math.abs((bM.minX + bM.maxX) / 2 - M.advance / 2) < 6, bM ? JSON.stringify({ y: [Math.round(bM.minY), Math.round(bM.maxY)] }) : '');
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await wait(600);
const M2 = await idbGlyph('M');
check('undo removes the imported art', !M2?.variants[0].traced?.length && M2.variants[0].contours.length === 0);
const ball = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#222'; x.beginPath(); x.arc(150, 150, 90, 0, 7); x.fill(); return c.toDataURL('image/png'); });
const ballPath = save('ball.png', ball);
await chooseFile(/Choose image/, ballPath);
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Convert reference to outline/.test(b.textContent)), { timeout: 8000 });
await realClick(/Convert reference to outline/);
await wait(1500);
const M3 = await idbGlyph('M');
check('a reference picture can be traced to an outline', M3?.variants[0].traced?.length === 1, M3 ? `${M3.variants[0].traced?.length} traced` : 'none');
await shot('s4-reference-traced');

console.log('Bengali template');
// Chromium allows only one automatic download per page, so use a fresh page for this one.
const p2 = await browser.newPage();
await p2.setViewport({ width: 1200, height: 900 });
p2.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
p2.on('pageerror', (e) => problems.push('PAGEERROR: ' + e.message));
await p2.goto(url, { waitUntil: 'networkidle0' });
await p2.evaluate(() => { delete window.showSaveFilePicker; });
await (await p2.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp });
const click2 = async (re) => { const h = await p2.evaluateHandle((src) => [...document.querySelectorAll('button, a.btn')].find((x) => new RegExp(src).test(x.textContent.trim())) ?? null, re.source); await h.asElement().click(); };
await click2(/New font/);
await p2.waitForSelector('#np-name');
await p2.type('#np-name', 'Bengali E2E');
await p2.select('#np-set', 'bengali');
await click2(/^Create$/);
await p2.waitForSelector('a.gc');
await click2(/Template PDF/);
await until(() => readdirSync(tmp).some((f) => f.includes('bengali') && f.endsWith('.pdf')), 'Bengali PDF', 30000);
await wait(300);
const bnName = readdirSync(tmp).find((f) => f.includes('bengali') && f.endsWith('.pdf'));
const bn = bnName ? readFileSync(join(tmp, bnName)) : Buffer.alloc(0);
const images = (bn.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
check('the Bengali guide letters are embedded as images (Helvetica cannot draw them)', images >= 60, `${images} images in ${bnName} (${bn.length} bytes)`);

console.log('Page health');
check('no console errors or warnings', problems.length === 0, problems.slice(0, 3).join(' | '));
await finish();
