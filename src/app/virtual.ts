// Pure maths for the virtualised glyph grid, kept separate so it can be unit tested.

export type GridMetrics = { cols: number; cell: number; rowHeight: number; rows: number; totalHeight: number };

export function gridMetrics(width: number, count: number, minCell = 64, gap = 6): GridMetrics {
  const w = Math.max(0, width);
  const cols = Math.max(1, Math.floor((w + gap) / (minCell + gap)));
  const cell = Math.max(1, (w - gap * (cols - 1)) / cols);
  const rowHeight = cell + gap;
  const rows = Math.ceil(count / cols);
  return { cols, cell, rowHeight, rows, totalHeight: rows > 0 ? rows * rowHeight - gap : 0 };
}

/** Half-open range [start, end) of item indexes that must be mounted for the given scroll window. */
export function visibleRange(m: GridMetrics, count: number, scrollTop: number, viewportHeight: number, overscanRows = 2): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const firstRow = Math.max(0, Math.floor(Math.max(0, scrollTop) / m.rowHeight) - overscanRows);
  const lastRow = Math.min(m.rows - 1, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / m.rowHeight) + overscanRows);
  return { start: Math.min(count, firstRow * m.cols), end: Math.min(count, (lastRow + 1) * m.cols) };
}
