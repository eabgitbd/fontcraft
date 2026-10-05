import type { Contour, PenPath, Stroke } from '@/storage/types';
import { fitShapes, type FitOptions } from './fit';
import { buildShapes } from './union';

export type BuildOptions = FitOptions & { minArea?: number };

/** Strokes and pen paths to the final vector contours (what gets exported). */
export function buildContours(strokes: readonly Stroke[], paths: readonly PenPath[] = [], opts: BuildOptions = {}, traced: readonly Contour[] = []): Contour[] {
  return fitShapes(buildShapes(strokes, paths, opts.minArea, traced), opts);
}
