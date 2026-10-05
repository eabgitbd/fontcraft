#!/usr/bin/env node
// FontCraft build verifier. Usage: node scripts/verify.mjs <web|android>
// Exits 1 with a clear message if any check fails.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (mode !== 'web' && mode !== 'android') {
  console.error('Usage: node scripts/verify.mjs <web|android>');
  process.exit(2);
}

const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  ok  ${msg}`);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const TEXT_EXT = /\.(html|js|mjs|css|json|webmanifest|svg|txt|map)$/i;
const isText = (p) => TEXT_EXT.test(p);

const outDir = resolve(root, mode === 'web' ? 'dist' : 'dist-android');
if (!existsSync(outDir)) {
  console.error(`Output folder not found: ${relative(root, outDir)}. Run the build first.`);
  process.exit(1);
}
const rel = (p) => relative(root, p).split(sep).join('/');
const files = walk(outDir);

// ---- 1. Forbidden strings in the output (both modes) ------------------------------------------
// The service-worker helper (workbox) legitimately contains none of these; scan everything anyway.
const FORBIDDEN_OUTPUT = ['debugger', 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net'];
// `debugger` as a bare word can appear in prose inside libraries; only flag the statement form.
const DEBUGGER_STMT = /(^|[;{}\s])debugger\s*(;|\}|$)/m;
for (const f of files.filter(isText)) {
  const txt = readFileSync(f, 'utf8');
  for (const bad of FORBIDDEN_OUTPUT) {
    if (bad === 'debugger') {
      if (DEBUGGER_STMT.test(txt)) fail(`${rel(f)} contains a debugger statement`);
    } else if (txt.includes(bad)) {
      fail(`${rel(f)} references forbidden host "${bad}" (no runtime network dependencies allowed)`);
    }
  }
}
ok('no forbidden strings in output');

// ---- 2. Forbidden strings in src/ (hostile code must never creep back) -------------------------
const srcFiles = walk(resolve(root, 'src')).filter((p) => /\.(ts|js|svelte|css|html)$/.test(p));
for (const f of srcFiles) {
  const txt = readFileSync(f, 'utf8');
  if (/\bdebugger\b/.test(txt)) fail(`${rel(f)} contains "debugger"`);
  if (txt.includes('outerWidth - window.innerWidth')) fail(`${rel(f)} contains a window-size devtools check`);
  if (/contextmenu[\s\S]{0,160}preventDefault/.test(txt)) fail(`${rel(f)} blocks the context menu`);
}
ok('src/ is free of anti-devtools code');

// ---- 3. HTML reference checks ----------------------------------------------------------------
function htmlRefs(html) {
  const refs = [];
  const re = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  return refs;
}
const isExternal = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(u);

function checkHtml(htmlPath, { base, isRelativeBuild }) {
  const html = readFileSync(htmlPath, 'utf8');
  const dir = dirname(htmlPath);
  for (const ref of htmlRefs(html)) {
    if (isExternal(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    let target;
    if (clean.startsWith('/')) {
      if (isRelativeBuild) {
        fail(`${rel(htmlPath)} uses absolute-root URL "${ref}" but the build must use relative paths`);
        continue;
      }
      if (!clean.startsWith(base)) {
        fail(`${rel(htmlPath)} reference "${ref}" does not start with BASE_PATH "${base}"`);
        continue;
      }
      target = join(outDir, clean.slice(base.length));
    } else {
      target = resolve(dir, clean);
    }
    if (!existsSync(target)) fail(`${rel(htmlPath)} references missing file "${ref}"`);
  }
}

if (mode === 'web') {
  const base = process.env.BASE_PATH || '/';
  const landing = join(outDir, 'index.html');
  const studio = join(outDir, 'app', 'index.html');
  for (const p of [landing, studio]) if (!existsSync(p)) fail(`missing ${rel(p)}`);
  const hasManifest = files.some((f) => /\.(webmanifest)$/.test(f) || /manifest\.json$/.test(f));
  if (!hasManifest) fail('no web manifest found in dist/');
  const hasSw = files.some((f) => /(^|[\\/])sw\.js$/.test(f));
  if (!hasSw) fail('no service worker (sw.js) found in dist/');
  if (existsSync(landing)) {
    const size = statSync(landing).size;
    if (size >= 30 * 1024) fail(`landing page is ${size} bytes; must be under 30 KB`);
    else ok(`landing page is ${(size / 1024).toFixed(1)} KB (< 30 KB)`);
    checkHtml(landing, { base, isRelativeBuild: false });
  }
  if (existsSync(studio)) checkHtml(studio, { base, isRelativeBuild: false });
  // Landing must not carry an unreplaced token.
  if (existsSync(landing) && readFileSync(landing, 'utf8').includes('__REPO_URL__')) {
    fail('landing page still contains the unreplaced __REPO_URL__ token');
  }
  ok('web HTML references resolve');
} else {
  const index = join(outDir, 'index.html');
  if (!existsSync(index)) fail('missing dist-android/index.html');
  else checkHtml(index, { base: '/', isRelativeBuild: true });
  for (const f of files.filter(isText)) {
    if (readFileSync(f, 'utf8').includes('serviceWorker.register')) {
      fail(`${rel(f)} registers a service worker; the Android build must not`);
    }
  }
  if (files.some((f) => /(^|[\\/])sw\.js$/.test(f))) fail('dist-android contains a service worker file');
  ok('android assets check complete');
}

if (failures.length) {
  console.error(`\nVERIFY FAILED (${mode}) — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nVERIFY PASSED (${mode})`);
