#!/usr/bin/env node
// Applies FontCraft's Android customisations to the generated `android/` project.
// Idempotent: running it twice makes no further changes. Exits non-zero when an expected
// pattern is missing, so a Capacitor template change is noticed instead of silently ignored.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = resolve(root, 'android');
const BAR_COLOR = '#0a0a0b';
const VERSION_CODE = process.env.VERSION_CODE || '1';
const VERSION_NAME = process.env.VERSION_NAME || '1.0.0';

const summary = [];
const problems = [];

if (!existsSync(androidDir)) {
  console.error('android/ does not exist. Run `npx cap add android` first.');
  process.exit(1);
}
if (!/^\d+$/.test(VERSION_CODE)) {
  console.error(`VERSION_CODE must be an integer, got "${VERSION_CODE}"`);
  process.exit(1);
}
if (!/^[0-9A-Za-z._-]+$/.test(VERSION_NAME)) {
  console.error(`VERSION_NAME has unexpected characters: "${VERSION_NAME}"`);
  process.exit(1);
}

/** Reads a file, applies `fn`, writes it back only when the content changed. */
function edit(relPath, fn, { optional = false } = {}) {
  const file = resolve(androidDir, relPath);
  if (!existsSync(file)) {
    if (optional) return;
    problems.push(`${relPath}: file not found`);
    return;
  }
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(file, after);
    summary.push(`changed  ${relPath}`);
  } else {
    summary.push(`no-op    ${relPath}`);
  }
}

// ---- 1. build.gradle: version code and name --------------------------------------------------
edit('app/build.gradle', (src) => {
  let out = src;
  if (!/versionCode\s+\d+/.test(out)) problems.push('app/build.gradle: versionCode line not found');
  else out = out.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`);
  if (!/versionName\s+"[^"]*"/.test(out)) problems.push('app/build.gradle: versionName line not found');
  else out = out.replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);
  return out;
});

// ---- 2. AndroidManifest.xml ------------------------------------------------------------------
edit('app/src/main/AndroidManifest.xml', (src) => {
  let out = src;

  // <application ... android:usesCleartextTraffic="false">
  const appTag = out.match(/<application\b[^>]*>/);
  if (!appTag) {
    problems.push('AndroidManifest.xml: <application> tag not found');
  } else if (/android:usesCleartextTraffic="[^"]*"/.test(appTag[0])) {
    out = out.replace(appTag[0], appTag[0].replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"'));
  } else {
    out = out.replace(appTag[0], appTag[0].replace('<application', '<application\n        android:usesCleartextTraffic="false"'));
  }

  // MainActivity: adjustResize so the keyboard never covers focused inputs
  const actTag = out.match(/<activity\b[^>]*android:name="\.MainActivity"[^>]*>/);
  if (!actTag) {
    problems.push('AndroidManifest.xml: MainActivity <activity> tag not found');
  } else if (/android:windowSoftInputMode="[^"]*"/.test(actTag[0])) {
    out = out.replace(actTag[0], actTag[0].replace(/android:windowSoftInputMode="[^"]*"/, 'android:windowSoftInputMode="adjustResize"'));
  } else {
    out = out.replace(actTag[0], actTag[0].replace('<activity', '<activity\n            android:windowSoftInputMode="adjustResize"'));
  }

  // Remove permissions the app does not use. INTERNET stays (Capacitor's bridge needs it);
  // plugin manifests add their own (VIBRATE for haptics, CAMERA only if @capacitor/camera declares it).
  const ALLOWED = new Set(['android.permission.INTERNET']);
  out = out.replace(/[ \t]*<uses-permission\b[^>]*android:name="([^"]+)"[^>]*\/>\s*?\n/g, (match, name) => {
    return ALLOWED.has(name) ? match : '';
  });
  if (!out.includes('android.permission.INTERNET')) problems.push('AndroidManifest.xml: INTERNET permission missing');
  return out;
});

// ---- 3. Theme: status and navigation bar colours ----------------------------------------------
{
  const colorsPath = resolve(androidDir, 'app/src/main/res/values/colors.xml');
  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">${BAR_COLOR}</color>
    <color name="colorPrimaryDark">${BAR_COLOR}</color>
    <color name="colorAccent">#6c63ff</color>
    <color name="fontcraft_bar">${BAR_COLOR}</color>
</resources>
`;
  const existing = existsSync(colorsPath) ? readFileSync(colorsPath, 'utf8') : null;
  if (existing !== colorsXml) {
    writeFileSync(colorsPath, colorsXml);
    summary.push(`${existing === null ? 'created ' : 'changed '} app/src/main/res/values/colors.xml`);
  } else {
    summary.push('no-op    app/src/main/res/values/colors.xml');
  }
}

edit('app/src/main/res/values/styles.xml', (src) => {
  let out = src;
  const items = [
    ['android:statusBarColor', '@color/fontcraft_bar'],
    ['android:navigationBarColor', '@color/fontcraft_bar'],
    ['android:windowBackground', '@color/fontcraft_bar'],
  ];
  for (const styleName of ['AppTheme', 'AppTheme.NoActionBar']) {
    const re = new RegExp(`(<style\\s+name="${styleName.replace('.', '\\.')}"[^>]*>)([\\s\\S]*?)(</style>)`);
    const m = out.match(re);
    if (!m) {
      problems.push(`styles.xml: style "${styleName}" not found`);
      continue;
    }
    let body = m[2];
    for (const [key, value] of items) {
      const itemRe = new RegExp(`\\s*<item\\s+name="${key}">[^<]*</item>`);
      body = body.replace(itemRe, '');
      body = body.replace(/\s*$/, '') + `\n        <item name="${key}">${value}</item>\n    `;
    }
    out = out.replace(re, `${m[1]}${body}${m[3]}`);
  }
  return out;
});

// The launcher background colour (adaptive icon layer) matches the app background.
edit(
  'app/src/main/res/values/ic_launcher_background.xml',
  (src) => src.replace(/(<color name="ic_launcher_background">)[^<]*(<\/color>)/, `$1${BAR_COLOR}$2`),
  { optional: true },
);

// ---- Report ----------------------------------------------------------------------------------
console.log('patch-android summary:');
for (const line of summary) console.log(`  ${line}`);
console.log(`  versionCode=${VERSION_CODE} versionName=${VERSION_NAME}`);
if (problems.length) {
  console.error('\npatch-android FAILED. Expected patterns were not found (Capacitor template may have changed):');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('patch-android OK');
