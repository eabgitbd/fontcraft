// Shared plumbing for the real-browser tests: a static server for dist/, a Chromium launch, and a tiny
// check/report helper. Browser packages are resolved from E2E_MODULES (a folder with node_modules) or the
// current directory, so they are not dependencies of this repository.
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function start({ viewport = { width: 1100, height: 760, deviceScaleFactor: 1, hasTouch: true }, shotsDir = process.env.E2E_SHOTS || '/tmp/e2e' } = {}) {
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'app', 'index.html'))) throw new Error('Run `npm run build:web` first (BASE_PATH must be "/").');
  mkdirSync(shotsDir, { recursive: true });
  const server = http.createServer((req, res) => {
    let f = join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return (res.writeHead(404), res.end());
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/app/`;

  const req = createRequire(join(process.env.E2E_MODULES || process.cwd(), 'noop.js'));
  const load = async (name) => (await import(pathToFileURL(req.resolve(name)).href)).default;
  let puppeteer, execPath, args = ['--no-sandbox'];
  try {
    puppeteer = await load('puppeteer-core');
    if (process.env.CHROMIUM_PATH) execPath = process.env.CHROMIUM_PATH;
    else {
      const chromium = await load('@sparticuz/chromium');
      execPath = await chromium.executablePath();
      args = [...chromium.args, '--no-sandbox'];
    }
  } catch (e) {
    console.error('Cannot start a browser:', e.message);
    process.exit(2);
  }
  const browser = await puppeteer.launch({ args, executablePath: execPath, headless: 'shell' });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const problems = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push('PAGEERROR: ' + e.message));
  const cdp = await page.createCDPSession();

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  };
  const shot = (n) => page.screenshot({ path: join(shotsDir, n + '.png') });
  const finish = async () => {
    await browser.close();
    server.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shotsDir}`);
    process.exit(failed.length ? 1 : 0);
  };
  return { browser, page, cdp, url, problems, check, shot, finish, wait };
}
