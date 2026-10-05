// The printable handwriting template. Positions come from `scLayout`, the same function the scanner
// uses to find cells, so what is printed and what is read can never disagree.
import { cellsOf, scLayout, templateChars } from './scan-core';

export type RasterResult = { dataUrl: string; aspect: number };
/** Renders text to a transparent PNG (for scripts the PDF's built-in fonts cannot draw, such as Bengali). */
export type Rasterizer = (text: string, px: number, rgb: [number, number, number]) => Promise<RasterResult | null>;

export type TemplateProject = { name: string; set: string; cell: string };

export const hasBengali = (s: string) => /[\u0980-\u09FF]/.test(s);

export const templateFileName = (p: TemplateProject) => `${(p.name || 'FontCraft').trim().replace(/\s+/g, '_')}_template${p.set.includes('bengali') ? '_bengali' : ''}.pdf`;

const LEGEND: Array<{ c: [number, number, number]; t: string }> = [
  { c: [160, 160, 240], t: 'cap' },
  { c: [140, 190, 240], t: 'x-height' },
  { c: [160, 210, 160], t: 'baseline' },
  { c: [240, 160, 160], t: 'descender' },
];

export async function buildTemplatePdf(project: TemplateProject, rasterize?: Rasterizer): Promise<{ blob: Blob; pages: number }> {
  const { jsPDF } = await import('jspdf');
  const L = scLayout({ mode: 'template', project });
  const isBn = project.set.includes('bengali');
  const chars = templateChars(project.set);
  const fontName = project.name || 'FontCraft';
  const margin = L.left;

  // Pre-render every Bengali character once; the PDF itself is built synchronously after that.
  const raster = new Map<string, RasterResult>();
  const need = async (key: string, px: number, rgb: [number, number, number]) => {
    if (!rasterize || raster.has(key)) return;
    const r = await rasterize(key, px, rgb);
    if (r) raster.set(key, r);
  };
  const GUIDE_RGB: [number, number, number] = [225, 225, 240];
  for (const ch of new Set(chars)) if (hasBengali(ch)) await need(ch, 160, GUIDE_RGB);
  const bnSub = 'বাংলা';
  const bnLine = 'প্রতিটি বাক্সে সাবধানে অক্ষর লিখুন';
  if (isBn) {
    await need(bnSub, 64, [140, 140, 220]);
    await need(bnLine, 64, [140, 140, 220]);
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const image = (key: string, x: number, y: number, h: number, centre = false) => {
    const r = raster.get(key);
    if (!r) return;
    const w = h * r.aspect;
    doc.addImage(r.dataUrl, 'PNG', centre ? x - w / 2 : x, y, w, h, undefined, 'FAST');
  };

  // Header
  doc.setFillColor(15, 15, 17);
  doc.rect(0, 0, 210, 24, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`${fontName} - Handwriting Template`, margin, 15);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 160, 180);
  const sub = `${isBn ? 'Bengali' : 'Latin'} · ${chars.length} characters · ${L.cols} columns`;
  doc.text(sub, margin, 21);
  if (isBn) image(bnSub, margin + doc.getTextWidth(sub) + 2, 17.6, 4.2);
  if (isBn) {
    // The Bengali instruction is drawn as an image; without one, fall back to the English wording.
    if (raster.has(bnLine)) image(bnLine, margin, 24.6, 3.4);
    else {
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 220);
      doc.text('Write each character carefully inside the box', margin, 27);
    }
  }
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 120);
  doc.text('Fill each box. Scan at 300dpi+. Upload to FontCraft > Scan.', margin, isBn ? 31 : 27);

  let lastBottom = 0;
  L.pages.forEach((pg, pi) => {
    if (pi > 0) {
      doc.addPage();
      doc.setFillColor(15, 15, 17);
      doc.rect(0, 0, 210, 10, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(200, 200, 220);
      doc.text(`${fontName} - p.${pi + 1}`, margin, 7);
    }
    for (const cell of cellsOf(L, pi + 1)) {
      const ch = chars[cell.gi]!;
      const x = margin + cell.c * (L.cw + L.gap);
      const y = pg.top + cell.r * (L.ch + L.gap);
      const cw = L.cw;
      const baseY = y + cw * 0.74, xhY = y + cw * 0.4, capY = y + cw * 0.18, descY = y + cw * 0.88;
      doc.setDrawColor(175, 175, 195);
      doc.setLineWidth(0.28);
      doc.rect(x, y, cw, cw);
      doc.setLineWidth(0.15);
      doc.setDrawColor(160, 160, 240); doc.line(x + 1.5, capY, x + cw - 1.5, capY);
      doc.setDrawColor(140, 190, 240); doc.line(x + 1.5, xhY, x + cw - 1.5, xhY);
      doc.setDrawColor(160, 210, 160); doc.line(x + 1.5, baseY, x + cw - 1.5, baseY);
      doc.setDrawColor(240, 160, 160); doc.line(x + 1.5, descY, x + cw - 1.5, descY);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 170);
      doc.text(String(cell.gi + 1), x + 1.5, y + cw - 1);
      doc.text('U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'), x + cw - 10, y + cw - 1);
      // The pale guide letter: text for Latin, a rendered image for Bengali (Helvetica has no Bengali glyphs).
      if (hasBengali(ch)) {
        const h = cw * 0.62;
        image(ch, x + cw / 2, baseY - h * 0.8, h, true);
      } else {
        doc.setFontSize(cw * 2.4);
        doc.setTextColor(225, 225, 240);
        try {
          doc.text(ch, x + cw / 2, baseY, { align: 'center' });
        } catch {
          /* a glyph the built-in font cannot draw: leave the guide out */
        }
      }
      lastBottom = y + cw;
    }
  });

  // Legend, under the last row
  const ly = Math.min(lastBottom + 5, 297 - 14);
  LEGEND.forEach((it, i) => {
    const lx = margin + i * 46;
    doc.setDrawColor(...it.c);
    doc.setLineWidth(1.2);
    doc.line(lx, ly + 3, lx + 8, ly + 3);
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 130);
    doc.text(it.t, lx + 10, ly + 4.5);
  });

  return { blob: doc.output('blob'), pages: doc.getNumberOfPages() };
}
