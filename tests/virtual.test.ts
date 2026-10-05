import { describe, expect, it } from 'vitest';
import { gridMetrics, visibleRange } from '@/app/virtual';

describe('gridMetrics', () => {
  it('fits columns and stretches cells to fill the width exactly', () => {
    const m = gridMetrics(400, 100, 64, 6);
    expect(m.cols).toBe(5); // 5*64 + 4*6 = 344 <= 400 < 6*64 + 5*6 = 414
    expect(m.cell * m.cols + 6 * (m.cols - 1)).toBeCloseTo(400, 6);
    expect(m.rows).toBe(20);
    expect(m.totalHeight).toBeCloseTo(20 * m.rowHeight - 6, 6);
  });
  it('never returns zero columns, even for tiny or zero width', () => {
    expect(gridMetrics(0, 10).cols).toBe(1);
    expect(gridMetrics(10, 10).cols).toBe(1);
    expect(gridMetrics(-5, 10).cols).toBe(1);
  });
  it('handles an empty list', () => {
    const m = gridMetrics(400, 0);
    expect(m.rows).toBe(0);
    expect(m.totalHeight).toBe(0);
  });
});

describe('visibleRange', () => {
  const m = gridMetrics(400, 500, 64, 6);
  it('starts at zero and never exceeds the item count', () => {
    const r = visibleRange(m, 500, 0, 600);
    expect(r.start).toBe(0);
    expect(r.end).toBeGreaterThan(0);
    expect(r.end).toBeLessThanOrEqual(500);
  });
  it('mounts only a small window out of a large list', () => {
    const r = visibleRange(m, 500, 3000, 600);
    expect(r.end - r.start).toBeLessThan(120);
    expect(r.start % m.cols).toBe(0); // always whole rows
  });
  it('always covers every row that is on screen', () => {
    for (const top of [0, 1, 250, 999, 2500, m.totalHeight]) {
      const r = visibleRange(m, 500, top, 600, 0);
      for (let i = 0; i < 500; i++) {
        const rowTop = Math.floor(i / m.cols) * m.rowHeight;
        const visible = rowTop + m.cell > top && rowTop < top + 600;
        if (visible) expect(i >= r.start && i < r.end, `item ${i} at scroll ${top}`).toBe(true);
      }
    }
  });
  it('is empty for no items and tolerates negative scroll', () => {
    expect(visibleRange(gridMetrics(400, 0), 0, 0, 600)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(m, 500, -50, 600).start).toBe(0);
  });
});
