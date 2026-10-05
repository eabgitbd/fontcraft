import { describe, expect, it } from 'vitest';
import { BackStack } from '@/platform/back';
import { blobToBase64, safeFileName } from '@/platform/files';

describe('BackStack', () => {
  it('runs the newest handler first and stops when one handles it', () => {
    const calls: string[] = [];
    const s = new BackStack();
    s.push(() => (calls.push('screen'), true));
    s.push(() => (calls.push('modal'), true));
    expect(s.dispatch()).toBe(true);
    expect(calls).toEqual(['modal']);
  });

  it('falls through handlers that return false', () => {
    const calls: string[] = [];
    const s = new BackStack();
    s.push(() => (calls.push('screen'), true));
    s.push(() => (calls.push('sheet'), false));
    expect(s.dispatch()).toBe(true);
    expect(calls).toEqual(['sheet', 'screen']);
  });

  it('reports unhandled when the stack is empty or nobody consumes it', () => {
    const s = new BackStack();
    expect(s.dispatch()).toBe(false);
    s.push(() => false);
    expect(s.dispatch()).toBe(false);
  });

  it('unsubscribe removes only that handler', () => {
    const s = new BackStack();
    const off = s.push(() => true);
    s.push(() => false);
    off();
    expect(s.size).toBe(1);
    expect(s.dispatch()).toBe(false);
    off(); // second call is harmless
    expect(s.size).toBe(1);
  });
});

describe('files helpers', () => {
  it('base64-encodes bytes larger than one chunk without corruption', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const b64 = await blobToBase64(new Blob([bytes]));
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it('makes file names safe for Android and Windows', () => {
    expect(safeFileName('My Font: v1/final?.otf')).toBe('My_Font__v1_final_.otf');
    expect(safeFileName('   ')).toBe('_');
    expect(safeFileName('')).toBe('FontCraft_file');
    expect(safeFileName('...')).toBe('FontCraft_file');
    expect(safeFileName('হাতের লেখা.otf')).toBe('হাতের_লেখা.otf');
    expect(safeFileName('a'.repeat(300))).toHaveLength(120);
  });
});
