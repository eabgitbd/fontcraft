import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver } from '@/storage/autosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Autosaver', () => {
  it('debounces: only the latest task for a key runs, after the delay', async () => {
    const saved = vi.fn();
    const a = new Autosaver({ onSaved: saved }, 500);
    const t1 = vi.fn(async () => {});
    const t2 = vi.fn(async () => {});
    a.schedule('glyph:A', t1);
    await vi.advanceTimersByTimeAsync(300);
    a.schedule('glyph:A', t2);
    await vi.advanceTimersByTimeAsync(499);
    expect(t2).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(t1).not.toHaveBeenCalled();
    expect(t2).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(a.pending).toBe(0);
  });

  it('a per-call delay of 0 writes on the next tick instead of waiting for the debounce', async () => {
    const a = new Autosaver({}, 500);
    const t = vi.fn(async () => {});
    a.schedule('now', t, 0);
    expect(t).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t).toHaveBeenCalledTimes(1);
  });

  it('keys are independent', async () => {
    const a = new Autosaver({}, 100);
    const x = vi.fn(async () => {});
    const y = vi.fn(async () => {});
    a.schedule('x', x);
    a.schedule('y', y);
    expect(a.pending).toBe(2);
    await vi.advanceTimersByTimeAsync(101);
    expect(x).toHaveBeenCalledTimes(1);
    expect(y).toHaveBeenCalledTimes(1);
  });

  it('flush() runs everything now and waits for slow writes', async () => {
    const a = new Autosaver({}, 10_000);
    let finished = false;
    a.schedule('slow', () => new Promise<void>((r) => setTimeout(() => ((finished = true), r()), 200)));
    const p = a.flush();
    await vi.advanceTimersByTimeAsync(250);
    await p;
    expect(finished).toBe(true);
    expect(a.pending).toBe(0);
  });

  it('routes quota errors and other errors to different callbacks', async () => {
    const onQuota = vi.fn();
    const onError = vi.fn();
    const a = new Autosaver({ onQuotaError: onQuota, onError }, 10);
    a.schedule('q', async () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    });
    a.schedule('e', async () => {
      throw new Error('other');
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(onQuota).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a failed write does not fire onSaved', async () => {
    const saved = vi.fn();
    const a = new Autosaver({ onSaved: saved, onError: () => {} }, 10);
    a.schedule('e', async () => {
      throw new Error('x');
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(saved).not.toHaveBeenCalled();
  });

  it('cancelAll() drops pending work', async () => {
    const a = new Autosaver({}, 100);
    const t = vi.fn(async () => {});
    a.schedule('k', t);
    a.cancelAll();
    await vi.advanceTimersByTimeAsync(500);
    expect(t).not.toHaveBeenCalled();
    expect(a.pending).toBe(0);
  });
});
