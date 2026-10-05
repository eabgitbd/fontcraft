#!/usr/bin/env node
// Real-browser test of the glyph editor (Chromium, real pointer / pen / touch events over CDP).
//   npm run build:web && node e2e/editor.e2e.mjs
// Needs a browser: set CHROMIUM_PATH to a Chrome/Chromium binary, or install `puppeteer-core`
// and `@sparticuz/chromium` somewhere resolvable. Not part of CI (the unit suite is).
import { start, wait } from './lib.mjs';

const { page, cdp, url, problems, check, shot, finish } = await start();

const clickButton = (re) => page.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll('button')].find((x) => r.test(x.textContent.trim())); b?.click(); return !!b; }, re.source);

/** Reads the stored glyph straight from IndexedDB, after the autosave debounce. */
async function stored(ch) {
  await wait(800);
  return page.evaluate((ch) => new Promise((resolve) => {
    const open = indexedDB.open('fontcraft');
    open.onsuccess = () => {
      const all = open.result.transaction('glyphs').objectStore('glyphs').getAll();
      all.onsuccess = () => resolve(all.result.find((g) => g.char === ch) ?? null);
    };
  }), ch);
}
/** Counts pixels of a colour on the ink layer (the ink colour is forced to pure red). */
const redPixels = () => page.evaluate(() => {
  const c = document.querySelectorAll('canvas')[1];
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] < 70 && d[i + 3] > 200) n++;
  return n;
});
const amberPixels = () => page.evaluate(() => {
  const c = document.querySelector('canvas.live');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 60 && d[i + 1] < 150 && d[i + 2] < 60 && d[i + 3] > 150) n++;
  return n;
});
const zoomText = () => page.$eval('.zoom', (e) => e.textContent);
const boxOf = async () => (await page.$('canvas.live')).boundingBox();

console.log('Setup');
await page.goto(url, { waitUntil: 'networkidle0' });
await clickButton(/New font/);
await page.waitForSelector('#np-name');
await page.type('#np-name', 'E2E Hand');
await clickButton(/^Create$/);
await page.waitForSelector('a.gc');
await page.evaluate(() => (location.hash = '#/editor/A'));
await page.waitForSelector('canvas.live');
await wait(300);
await page.$eval('#ink', (el) => { el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await wait(100);
let box = await boxOf();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
check('editor canvas fills the window below the toolbar', box.y + box.height > 740, `bottom=${Math.round(box.y + box.height)}`);
check('empty canvas has no ink', (await redPixels()) === 0);
await shot('01-empty');

console.log('Mouse');
const mouseStroke = async (pts, steps = 8) => { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps }); await page.mouse.up(); };
await mouseStroke([[cx - 110, cy + 150], [cx, cy - 150], [cx + 110, cy + 150]]);
await mouseStroke([[cx - 65, cy + 30], [cx + 65, cy + 30]]);
await wait(150);
const ink1 = await redPixels();
check('mouse strokes paint ink', ink1 > 1500, `${ink1}px`);
const g1 = await stored('A');
check('strokes are saved to IndexedDB', g1?.variants[0].strokes.length === 2);
check('strokes merge into one outline plus the counter hole of the A', g1?.variants[0].contours.length === 2, `${g1?.variants[0].contours.length} contour(s)`);
const nodes = g1?.variants[0].contours[0]?.nodes.length ?? 0;
check('curve fitting keeps the node count small', nodes > 3 && nodes < 60, `${nodes} nodes`);
await shot('02-mouse-A');

console.log('Outline preview');
await page.click('button[aria-label="Show exported outline"]');
await wait(150);
check('outline overlay is drawn', (await amberPixels()) > 200, `${await amberPixels()}px`);
await shot('03-outline');
await page.click('button[aria-label="Show exported outline"]');

console.log('Undo and redo');
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await wait(150);
check('Ctrl+Z removes the last stroke', (await redPixels()) < ink1 * 0.9);
await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
await wait(150);
// Chromium changes antialiasing after the first pixel readback, so allow a few percent.
check('Ctrl+Y restores it', Math.abs((await redPixels()) - ink1) < ink1 * 0.06, `${ink1} -> ${await redPixels()}`);

console.log('Zoom and pan');
const z0 = await zoomText();
await page.mouse.move(cx, cy);
await page.mouse.wheel({ deltaY: -400 });
await wait(150);
check('mouse wheel zooms in', parseInt(await zoomText()) > parseInt(z0), `${z0} -> ${await zoomText()}`);
await page.keyboard.press('0');
await wait(100);
check('0 fits to screen', (await zoomText()) === z0);
await page.click('button[aria-label^="Zoom in"]');
await wait(100);
check('zoom button zooms', parseInt(await zoomText()) > parseInt(z0));
await page.keyboard.press('0');

console.log('Regression: Clear must repaint');
await clickButton(/^Clear$/);
await mouseStroke([[cx - 110, cy + 150], [cx, cy - 150], [cx + 110, cy + 150]]);
await wait(150);
check('a V-shaped stroke paints', (await redPixels()) > 1000);
await clickButton(/^Clear$/);
await wait(300);
check('Clear removes it from the screen (ink layer is not stale)', (await redPixels()) === 0, `${await redPixels()}px left`);

console.log('Eraser (area eraser splits strokes)');
await clickButton(/^Clear$/);
await wait(150);
check('Clear empties the glyph', (await redPixels()) === 0);
await mouseStroke([[cx - 120, cy], [cx + 120, cy]]);
await wait(100);
const lineInk = await redPixels();
await page.keyboard.press('e');
await mouseStroke([[cx, cy - 60], [cx, cy + 60]], 10);
await wait(150);
const afterErase = await redPixels();
check('eraser removes ink', afterErase < lineInk * 0.92, `${lineInk} -> ${afterErase}`);
const ge = await stored('A');
check('erasing through a line leaves two separate shapes', ge?.variants[0].contours.length === 2, `${ge?.variants[0].contours.length}`);
await shot('04-erased');
await page.keyboard.press('d');

console.log('Bezier pen');
await clickButton(/^Clear$/);
await page.keyboard.press('b');
const tap = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); };
await tap(cx - 100, cy + 100); await tap(cx + 100, cy + 100);
// third point with a drag pulls curve handles
await page.mouse.move(cx, cy - 100); await page.mouse.down(); await page.mouse.move(cx + 70, cy - 100, { steps: 6 }); await page.mouse.up();
await wait(100);
await shot('05-pen-in-progress');
await clickButton(/Close path/);
await clickButton(/^Done$/);
await wait(200);
const pen = await stored('A');
const path = pen?.variants[0].paths?.[0];
check('pen path is stored as raw input', !!path && path.closed && path.nodes.length === 3, JSON.stringify(path?.nodes.map((n) => n.kind)));
check('dragging while placing a point created a smooth node with handles', path?.nodes[2]?.kind === 'smooth' && !!path.nodes[2].hOut);
check('pen path is filled', (await redPixels()) > 3000, `${await redPixels()}px`);
await shot('06-pen-done');
await page.keyboard.press('v');
await page.mouse.move(cx, cy + 40); await page.mouse.down(); await page.mouse.up();
await wait(100);
await shot('07-select-path');
await page.keyboard.press('Delete');
await wait(150);
check('select + Delete removes the pen path', (await redPixels()) === 0);
await page.keyboard.press('d');

console.log('Pen (stylus) pressure');
await clickButton(/^Clear$/);
const pen2 = async (pts, forceAt) => {
  const send = (type, [x, y], force) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force });
  await send('mouseMoved', pts[0], 0);
  await send('mousePressed', pts[0], forceAt(0));
  for (let i = 1; i < pts.length; i++) await send('mouseMoved', pts[i], forceAt(i / (pts.length - 1)));
  await send('mouseReleased', pts[pts.length - 1], 0);
};
const sline = Array.from({ length: 40 }, (_, i) => [cx - 140 + i * 7, cy + Math.sin(i / 6) * 40]);
await pen2(sline, (t) => 0.1 + 0.9 * t);
await wait(300);
const gp = await stored('A');
const pressures = gp?.variants[0].strokes[0]?.pts.map((p) => p.pressure) ?? [];
check('pen pressure is recorded', Math.max(...pressures) - Math.min(...pressures) > 0.5, `${Math.min(...pressures).toFixed(2)}..${Math.max(...pressures).toFixed(2)}`);
const ptsWidth = (from, to) => {
  const s = gp.variants[0].contours[0].nodes.filter((n) => n.p.x > from && n.p.x < to);
  return s.length;
};
check('a pressure stroke produces a contour', gp?.variants[0].contours.length >= 1);
await shot('08-pen-pressure');

console.log('Touch');
await clickButton(/^Clear$/);
await wait(100);
const touchDraw = async () => {
  const t = await page.touchscreen.touchStart(cx - 80, cy);
  for (let i = 1; i <= 8; i++) await t.move(cx - 80 + i * 20, cy + i * 8);
  await t.end();
};
await touchDraw();
await wait(150);
const touchInk = await redPixels();
check('one finger draws', touchInk > 500, `${touchInk}px`);
const zBefore = parseInt(await zoomText());
const strokesBefore = (await stored('A'))?.variants[0].strokes.length;
const f1 = await page.touchscreen.touchStart(cx - 60, cy);
const f2 = await page.touchscreen.touchStart(cx + 60, cy);
for (let i = 1; i <= 8; i++) { await f1.move(cx - 60 - i * 12, cy); await f2.move(cx + 60 + i * 12, cy); }
await f1.end(); await f2.end();
await wait(200);
check('two-finger pinch zooms in', parseInt(await zoomText()) > zBefore * 1.3, `${zBefore}% -> ${await zoomText()}`);
check('pinching leaves no stray stroke', (await stored('A'))?.variants[0].strokes.length === strokesBefore, `${strokesBefore} stroke(s) before and after`);
await shot('09-pinched');
await page.keyboard.press('0');
const beforeTap = await redPixels();
const t1 = await page.touchscreen.touchStart(cx - 150, cy - 120);
const t2 = await page.touchscreen.touchStart(cx - 100, cy - 120);
await wait(60);
await t1.end(); await t2.end();
await wait(250);
check('two-finger tap undoes the last stroke', (await redPixels()) < beforeTap * 0.2, `${beforeTap} -> ${await redPixels()}`);
const t3 = await page.touchscreen.touchStart(cx - 150, cy - 120);
const t4 = await page.touchscreen.touchStart(cx - 100, cy - 120);
const t5 = await page.touchscreen.touchStart(cx - 50, cy - 120);
await wait(60);
await t3.end(); await t4.end(); await t5.end();
await wait(250);
check('three-finger tap redoes it', (await redPixels()) > beforeTap * 0.8, `${await redPixels()}`);

console.log('Palm rejection');
await clickButton(/^Clear$/);
const penDown = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 });
const penUp = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
await penDown(cx - 100, cy - 80);
const palm = await page.touchscreen.touchStart(cx + 100, cy + 100);
await palm.move(cx + 140, cy + 140); await palm.end();
await penUp(cx - 100, cy - 80);
await wait(200);
const gpalm = await stored('A');
check('a palm touch while the pen is down adds no stroke', gpalm?.variants[0].strokes.length === 1, `${gpalm?.variants[0].strokes.length} stroke(s)`);

console.log('Performance (pointer event handling)');
await clickButton(/^Clear$/);
const perf = await page.evaluate(async () => {
  const el = document.querySelector('canvas.live');
  const r = el.getBoundingClientRect();
  const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 7, pointerType: 'pen', pressure: 0.6, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
  fire('pointerdown', 100, 200);
  const times = [];
  for (let i = 0; i < 600; i++) {
    const t0 = performance.now();
    fire('pointermove', 100 + i * 0.9, 200 + Math.sin(i / 20) * 80);
    times.push(performance.now() - t0);
    if (i % 4 === 0) await new Promise((res) => requestAnimationFrame(res));
  }
  const t0 = performance.now();
  fire('pointerup', 640, 200);
  const commit = performance.now() - t0;
  times.sort((a, b) => a - b);
  return { median: times[300], p95: times[570], max: times[599], commit };
});
check('pointermove handling stays well under a 16 ms frame (p95)', perf.p95 < 8, `median ${perf.median.toFixed(2)} ms, p95 ${perf.p95.toFixed(2)} ms, max ${perf.max.toFixed(1)} ms`);
check('committing a 600-point stroke (union + curve fit) is fast', perf.commit < 150, `${perf.commit.toFixed(0)} ms`);

console.log('Persistence');
await page.keyboard.press('0');
// The stroke above was committed less than a moment ago: reload immediately, before the 500 ms autosave fires.
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => (location.hash = '#/glyphs'));
await wait(700);
const early = await page.evaluate(() => !!document.querySelector('a.gc.drawn svg path'));
check('a stroke committed a moment before a reload survives it', early);
await shot('10-glyph-map');

console.log('Page health');
check('no console errors or warnings', problems.length === 0, problems.slice(0, 3).join(' | '));

await finish();
