// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildTemplatePdf, hasBengali, templateFileName, type Rasterizer } from '@/scan/template-pdf';
import { cellsOf, scLayout } from '@/scan/scan-core';

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const text = async (b: Blob) => new TextDecoder('latin1').decode(await bytes(b));

describe('template PDF', () => {
  it('produces a real PDF with one page per layout page', async () => {
    const { blob, pages } = await buildTemplatePdf({ name: 'My Hand', set: 'latin', cell: 'medium' });
    const head = await bytes(blob);
    expect(String.fromCharCode(...head.slice(0, 5))).toBe('%PDF-');
    expect(pages).toBe(scLayout({ mode: 'template', project: { set: 'latin', cell: 'medium' } }).pages.length);
    expect(pages).toBe(3);
    expect(blob.type).toBe('application/pdf');
  });

  it('prints the title, the instructions, a cell number and code for every character', async () => {
    const { blob } = await buildTemplatePdf({ name: 'My Hand', set: 'latin', cell: 'medium' });
    const t = await text(blob);
    expect(t).toContain('My Hand - Handwriting Template');
    expect(t).toContain('Scan at 300dpi+');
    expect(t).toContain('U+0041'); // A
    expect(t).toContain('U+007A'); // z
    expect(t).toContain('(52)'); // 52nd cell number
    expect(t).toContain('baseline');
  });

  it('page count follows the cell size', async () => {
    const small = (await buildTemplatePdf({ name: 'S', set: 'latin', cell: 'small' })).pages;
    const large = (await buildTemplatePdf({ name: 'L', set: 'latin', cell: 'large' })).pages;
    expect(small).toBeLessThan(large);
  });

  it('draws exactly the cells the scanner will read (same layout function)', async () => {
    const proj = { name: 'X', set: 'bengali-ext', cell: 'small' };
    const L = scLayout({ mode: 'template', project: proj });
    const cells = L.pages.flatMap((_, i) => cellsOf(L, i + 1));
    expect(cells).toHaveLength(L.chars.length);
    const { pages } = await buildTemplatePdf(proj);
    expect(pages).toBe(L.pages.length);
  });

  it('Bengali: each distinct Bengali character is rendered once through the rasterizer; Latin is not', async () => {
    const calls: string[] = [];
    const rast: Rasterizer = async (t) => {
      calls.push(t);
      // a 1x1 transparent PNG
      return { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', aspect: 1 };
    };
    const { blob } = await buildTemplatePdf({ name: 'বাংলা', set: 'bengali-ext', cell: 'medium' }, rast);
    const letters = calls.filter((c) => hasBengali(c) && [...c].length <= 4);
    expect(new Set(letters).size).toBe(letters.length); // never twice
    expect(letters.length).toBeGreaterThan(60);
    expect(calls.some((c) => /^[0-9]$/.test(c))).toBe(false); // digits are plain text
    expect((await bytes(blob)).length).toBeGreaterThan(20000); // the images are really embedded
  });

  it('Bengali without a rasterizer still builds (guides omitted, English instruction used)', async () => {
    const { blob, pages } = await buildTemplatePdf({ name: 'B', set: 'bengali', cell: 'medium' });
    expect(pages).toBeGreaterThan(1);
    expect(await text(blob)).toContain('Write each character carefully');
  });

  it('a rasterizer that fails does not break the PDF', async () => {
    const { pages } = await buildTemplatePdf({ name: 'B', set: 'bengali', cell: 'medium' }, async () => null);
    expect(pages).toBeGreaterThan(0);
  });

  it('file names are safe and say Bengali when relevant', () => {
    expect(templateFileName({ name: 'My  Hand', set: 'latin', cell: 'medium' })).toBe('My_Hand_template.pdf');
    expect(templateFileName({ name: '', set: 'bengali', cell: 'medium' })).toBe('FontCraft_template_bengali.pdf');
  });
});
