#!/usr/bin/env node
// Renders assets/icon.svg into every PNG the app, PWA and @capacitor/assets need.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'assets');
const pub = resolve(root, 'web/app/public');
mkdirSync(assets, { recursive: true });
mkdirSync(pub, { recursive: true });

const BG = '#0a0a0b';
const svg = readFileSync(resolve(assets, 'icon.svg'));

// The master SVG is a rounded dark tile with the mark inside. Pull the mark out for the
// adaptive foreground (transparent) and splash (centred on solid background).
const mark = (size, scale) => {
  const inner = svg.toString().replace(/<rect width="1024" height="1024"[^>]*\/>/, '');
  const s = scale;
  const off = (1024 - 1024 * s) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">` +
      `<g transform="translate(${off} ${off}) scale(${s})">${inner.replace(/<\/?svg[^>]*>/g, '')}</g></svg>`,
  );
};

const png = (buf, size, out, opts = {}) => {
  let img = sharp(buf, { density: 384 }).resize(size, size, { fit: 'contain', background: opts.bg ?? { r: 0, g: 0, b: 0, alpha: 0 } });
  if (opts.flatten) img = img.flatten({ background: opts.flatten });
  return img.png().toFile(out);
};

const jobs = [];
// Launcher and store icons
jobs.push(png(svg, 1024, resolve(assets, 'icon-only.png')));
// Adaptive foreground: logo inside the safe zone (about 62% of the canvas), transparent
jobs.push(png(mark(1024, 0.62), 1024, resolve(assets, 'icon-foreground.png')));
// Adaptive background: solid colour
jobs.push(
  sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } }).png().toFile(resolve(assets, 'icon-background.png')),
);
// Splash screens 2732x2732, logo centred on solid background
for (const name of ['splash.png', 'splash-dark.png']) {
  jobs.push(
    sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
      .composite([{ input: await sharp(mark(1024, 1), { density: 384 }).resize(720, 720).png().toBuffer(), gravity: 'centre' }])
      .png()
      .toFile(resolve(assets, name)),
  );
}
// PWA icons (any + maskable)
jobs.push(png(svg, 192, resolve(pub, 'icon-192.png')));
jobs.push(png(svg, 512, resolve(pub, 'icon-512.png')));
// Maskable: full-bleed dark background, mark inside the 80% safe circle
jobs.push(
  sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: await sharp(mark(1024, 1), { density: 384 }).resize(360, 360).png().toBuffer(), gravity: 'centre' }])
    .png()
    .toFile(resolve(pub, 'icon-maskable-512.png')),
);

await Promise.all(jobs);
console.log('Icons and splash images written to assets/ and web/app/public/');
