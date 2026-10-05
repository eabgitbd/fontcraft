// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: Record<string, () => void> = {};
const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(async (o: { path: string }) => ({ uri: `file:///cache/${o.path}` })),
  share: vi.fn(async (_o: unknown) => ({})),
  clipWrite: vi.fn(async (_o: unknown) => {}),
  impact: vi.fn(async (_o: unknown) => {}),
  notification: vi.fn(async (_o: unknown) => {}),
  minimize: vi.fn(async () => {}),
  takePhoto: vi.fn(async (_o: unknown): Promise<{ uri?: string }> => ({ uri: '/data/photo.jpg' })),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, fn: () => void) => {
      listeners[name] = fn;
      return { remove: async () => {} };
    }),
    minimizeApp: mocks.minimize,
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { convertFileSrc: (u: string) => `https://localhost/_capacitor_file_${u}`, isNativePlatform: () => true } }));
vi.mock('@capacitor/camera', () => ({ Camera: { takePhoto: mocks.takePhoto } }));
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: mocks.clipWrite } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
  Filesystem: { writeFile: mocks.writeFile },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mocks.impact, notification: mocks.notification },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }));

import { createAndroidPlatform } from '@/platform/android';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(listeners)) delete listeners[k];
});

describe('android saveFile', () => {
  it('writes base64 to the private cache, then shares that file (never an <a download>)', async () => {
    const p = createAndroidPlatform();
    const res = await p.saveFile('My Font.otf', new Blob([new Uint8Array([1, 2, 3, 250])]), 'font/otf');
    expect(res).toBe('shared');
    const arg = mocks.writeFile.mock.calls[0]![0] as { path: string; data: string; directory: string; recursive: boolean };
    expect(arg.directory).toBe('CACHE');
    expect(arg.path).toBe('exports/My_Font.otf');
    expect(arg.recursive).toBe(true);
    expect(Uint8Array.from(atob(arg.data), (c) => c.charCodeAt(0))).toEqual(new Uint8Array([1, 2, 3, 250]));
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///cache/exports/My_Font.otf' }));
  });

  it('reports cancelled when the share sheet is dismissed', async () => {
    mocks.share.mockRejectedValueOnce(new Error('Share canceled'));
    expect(await createAndroidPlatform().saveFile('a.otf', new Blob(['x']), 'font/otf')).toBe('cancelled');
  });

  it('rethrows real share failures', async () => {
    mocks.share.mockRejectedValueOnce(new Error('No activity found'));
    await expect(createAndroidPlatform().saveFile('a.otf', new Blob(['x']), 'font/otf')).rejects.toThrow(/No activity/);
  });

  it('saveToDocuments writes into Documents/FontCraft', async () => {
    expect(await createAndroidPlatform().saveToDocuments('a.otf', new Blob(['x']), 'font/otf')).toBe('saved');
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'FontCraft/a.otf', directory: 'DOCUMENTS' }));
    expect(mocks.share).not.toHaveBeenCalled();
  });
});

describe('android back, pause and hardware features', () => {
  it('routes the hardware back button to the newest handler', () => {
    const p = createAndroidPlatform();
    const screen = vi.fn(() => true);
    const modal = vi.fn(() => true);
    p.onBack(screen);
    const off = p.onBack(modal);
    listeners.backButton!();
    expect(modal).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();
    off();
    listeners.backButton!();
    expect(screen).toHaveBeenCalledTimes(1);
    expect(mocks.minimize).not.toHaveBeenCalled();
  });

  it('minimises instead of killing the app when nothing handles back', () => {
    createAndroidPlatform().onBack(() => false);
    listeners.backButton!();
    expect(mocks.minimize).toHaveBeenCalledTimes(1);
  });

  it('forwards the native pause event to handlers', () => {
    const p = createAndroidPlatform();
    const h = vi.fn();
    const off = p.onPause(h);
    listeners.pause!();
    expect(h).toHaveBeenCalledTimes(1);
    off();
    listeners.pause!();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('copies through the native clipboard plugin', async () => {
    await createAndroidPlatform().copyText('হ্যালো');
    expect(mocks.clipWrite).toHaveBeenCalledWith({ string: 'হ্যালো' });
  });

  it('maps haptic kinds to the right native calls', () => {
    const p = createAndroidPlatform();
    p.haptic('tick');
    p.haptic('success');
    p.haptic('warn');
    expect(mocks.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(mocks.notification).toHaveBeenNthCalledWith(1, { type: 'SUCCESS' });
    expect(mocks.notification).toHaveBeenNthCalledWith(2, { type: 'WARNING' });
  });

  it('a failing haptic never throws into the caller', async () => {
    mocks.impact.mockRejectedValueOnce(new Error('no vibrator'));
    expect(() => createAndroidPlatform().haptic('tick')).not.toThrow();
    await Promise.resolve();
  });
});

describe('android captureImage', () => {
  it('turns the camera file URI into a blob via the WebView file URL', async () => {
    const blob = new Blob(['jpeg']);
    const fetchMock = vi.fn(async (_u: string) => ({ blob: async () => blob }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createAndroidPlatform().captureImage()).toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith('https://localhost/_capacitor_file_/data/photo.jpg');
    vi.unstubAllGlobals();
  });

  it('returns null when the user cancels', async () => {
    mocks.takePhoto.mockRejectedValueOnce(new Error('User cancelled photos app'));
    expect(await createAndroidPlatform().captureImage()).toBeNull();
  });

  it('returns null when no file came back', async () => {
    mocks.takePhoto.mockResolvedValueOnce({});
    expect(await createAndroidPlatform().captureImage()).toBeNull();
  });

  it('rethrows genuine camera errors such as denied permission', async () => {
    mocks.takePhoto.mockRejectedValueOnce(new Error('Camera permission denied'));
    await expect(createAndroidPlatform().captureImage()).rejects.toThrow(/permission/);
  });
});
