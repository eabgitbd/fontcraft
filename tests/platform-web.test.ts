// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '@/platform/web';

let created: string[] = [];
let clicked: Array<{ download: string; href: string }> = [];

beforeEach(() => {
  created = [];
  clicked = [];
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:mock/${created.length}`;
    created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
  delete (window as never as Record<string, unknown>).showSaveFilePicker;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('web saveFile', () => {
  it('falls back to a blob anchor download with a sanitised name', async () => {
    const p = createWebPlatform();
    const res = await p.saveFile('My Font: v1.otf', new Blob(['x']), 'font/otf');
    expect(res).toBe('saved');
    expect(clicked).toEqual([{ download: 'My_Font__v1.otf', href: 'blob:mock/0' }]);
    expect(document.querySelector('a[download]')).toBeNull(); // anchor removed again
  });

  it('uses the File System Access picker when present and writes the blob', async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    (window as never as Record<string, unknown>).showSaveFilePicker = picker;
    const blob = new Blob(['font-bytes']);
    const res = await createWebPlatform().saveFile('a.woff2', blob, 'font/woff2');
    expect(res).toBe('saved');
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'a.woff2' }));
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('reports cancelled when the user dismisses the picker, without downloading', async () => {
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    });
    expect(await createWebPlatform().saveFile('a.otf', new Blob(['x']), 'font/otf')).toBe('cancelled');
    expect(clicked).toHaveLength(0);
  });

  it('falls back to a download when the picker fails for another reason', async () => {
    (window as never as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('nope', 'SecurityError');
    });
    expect(await createWebPlatform().saveFile('a.otf', new Blob(['x']), 'font/otf')).toBe('saved');
    expect(clicked).toHaveLength(1);
  });

  it('revokes the object URL later so the download can start', async () => {
    vi.useFakeTimers();
    await createWebPlatform().saveFile('a.otf', new Blob(['x']), 'font/otf');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(31_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock/0');
  });
});

describe('web copyText', () => {
  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await createWebPlatform().copyText('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand and cleans up the textarea', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    (document as never as { execCommand: unknown }).execCommand = exec;
    await createWebPlatform().copyText('বাংলা');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('rejects when nothing can copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    (document as never as { execCommand: unknown }).execCommand = vi.fn(() => false);
    await expect(createWebPlatform().copyText('x')).rejects.toThrow(/copy/i);
  });
});

describe('web pause, back and misc', () => {
  it('runs pause handlers when the tab becomes hidden, and not after unsubscribe', () => {
    const p = createWebPlatform();
    const h = vi.fn();
    const off = p.onPause(h);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('haptics and keepAwake are safe no-ops without browser support', () => {
    const p = createWebPlatform();
    expect(() => {
      p.haptic('tick');
      p.haptic('success');
      p.haptic('warn');
      p.keepAwake(true);
      p.keepAwake(false);
    }).not.toThrow();
    expect(p.isNative).toBe(false);
  });

  it('openFile resolves the chosen file', async () => {
    const p = createWebPlatform();
    const file = new File(['{}'], 'p.fcproj');
    const promise = p.openFile(['.fcproj']);
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.accept).toBe('.fcproj');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(await promise).toBe(file);
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('openFile resolves null when the dialog is cancelled', async () => {
    const promise = createWebPlatform().openFile(['image/*']);
    document.querySelector('input[type=file]')!.dispatchEvent(new Event('cancel'));
    expect(await promise).toBeNull();
  });
});
