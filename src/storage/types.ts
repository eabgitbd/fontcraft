// Data model. All coordinates are in font units (UPM 1000), y-up.
import type { CharSetId } from '@/app/charsets';

export type Pt = { x: number; y: number };
export type PathNode = { p: Pt; hIn?: Pt; hOut?: Pt; kind: 'corner' | 'smooth' };
export type Contour = { nodes: PathNode[]; closed: boolean };
export type StrokePoint = { x: number; y: number; pressure: number };
export type Stroke = { pts: StrokePoint[]; size: number; erase?: boolean };

/** A Bezier path drawn with the pen tool. Closed paths are filled and outlined; open paths are stroked. */
export type PenPath = Contour & { size: number };

export type Variant = {
  /** Raw input, kept so the glyph stays editable. */
  strokes: Stroke[];
  /** Pen-tool paths (raw input, like strokes). Optional so older data stays valid. */
  paths?: PenPath[];
  /**
   * Imported vector artwork (a traced scan, a traced v3 bitmap, an SVG). Raw input like strokes: it sits
   * underneath them, so the eraser can clean it up and Clear removes it. Outer contours run clockwise
   * and holes counter-clockwise (y-up).
   */
  traced?: Contour[];
  /** Cached union/simplified result, rebuilt whenever strokes change. */
  contours: Contour[];
  /** v3 bitmap, kept as a reference layer after migration. */
  legacyPng?: Blob;
};

export const MAX_VARIANTS = 4;

export type Glyph = {
  char: string;
  advance: number;
  lsb: number;
  rsb: number;
  /** 1 to MAX_VARIANTS entries. */
  variants: Variant[];
};

/** Same fields v3 `saveSets` wrote, plus the new `schema`-4 ones already in the plan. */
export type FontSettings = {
  upm: number;
  ascender: number;
  descender: number;
  xheight: number;
  capheight: number;
  designer: string;
  license: string;
  subfamily: string;
  version: string;
  italic: number;
  tracking: number;
  defWidth: number;
  defLsb: number;
  defRsb: number;
  varMode: 'random' | 'cycle' | 'first';
};

/** v3 `saveLig`: { input, output, name }. */
export type Ligature = { input: string; output: string; name: string };
/** v3 `saveKP` / `saveKM`: { left, right, value }. */
export type KernPair = { left: string; right: string; value: number };

export const SCHEMA_VERSION = 4 as const;

export type ProjectStats = { total: number; drawn: number; withVariants: number };

export type Project = {
  id: string;
  schema: typeof SCHEMA_VERSION;
  name: string;
  set: CharSetId;
  cell: string;
  settings: FontSettings;
  ligatures: Ligature[];
  kerning: KernPair[];
  createdAt: number;
  updatedAt: number;
  /** Denormalised counters so the dashboard never has to read every glyph. */
  stats: ProjectStats;
};

export type GlyphRecord = Glyph & { projectId: string };

export type BlobRecord = { id: string; projectId: string; name: string; blob: Blob; createdAt: number };

export type BackupRecord = { id: string; projectId: string; projectName: string; createdAt: number; data: Blob; bytes: number };

export const DEFAULT_SETTINGS: Readonly<FontSettings> = {
  upm: 1000,
  ascender: 800,
  descender: -200,
  xheight: 500,
  capheight: 700,
  designer: '',
  license: 'Personal',
  subfamily: 'Regular',
  version: '1.000',
  italic: 0,
  tracking: 0,
  defWidth: 500,
  defLsb: 50,
  defRsb: 50,
  varMode: 'random',
};

export const emptyVariant = (): Variant => ({ strokes: [], contours: [] });

export const isVariantDrawn = (v: Variant | undefined): boolean =>
  !!v && (v.contours.length > 0 || v.strokes.some((s) => !s.erase) || (v.paths?.length ?? 0) > 0 || (v.traced?.length ?? 0) > 0 || !!v.legacyPng);

export const isGlyphDrawn = (g: Glyph): boolean => isVariantDrawn(g.variants[0]);
export const glyphHasVariants = (g: Glyph): boolean => g.variants.filter(isVariantDrawn).length > 1;
