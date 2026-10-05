import { BackStack } from './back';
import { safeFileName } from './files';
import type { Platform, SaveResult } from './types';

type PickerWindow = Window & {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function anchorDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function createWebPlatform(): Platform {
  const back = new BackStack();
  const pauseHandlers = new Set<() => void>();
  let wakeLock: { release(): Promise<void> } | null = null;

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') for (const h of pauseHandlers) h();
    });
    window.addEventListener('pagehide', () => {
      for (const h of pauseHandlers) h();
    });
  }

  async function saveFile(rawName: string, data: Blob, mime: string): Promise<SaveResult> {
    const name = safeFileName(rawName);
    const picker = (window as PickerWindow).showSaveFilePicker;
    if (picker) {
      try {
        const ext = extOf(name);
        const handle = await picker.call(window, {
          suggestedName: name,
          types: ext ? [{ accept: { [mime || 'application/octet-stream']: [ext] } }] : undefined,
        });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return 'saved';
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
        // Any other failure (permissions, unsupported type): fall through to a normal download.
      }
    }
    anchorDownload(name, data);
    return 'saved';
  }

  return {
    isNative: false,
    saveFile,
    saveToDocuments: saveFile,

    openFile(accept) {
      return new Promise<File | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept.join(',');
        input.style.display = 'none';
        input.addEventListener('change', () => {
          resolve(input.files?.[0] ?? null);
          input.remove();
        });
        input.addEventListener('cancel', () => {
          resolve(null);
          input.remove();
        });
        document.body.appendChild(input);
        input.click();
      });
    },

    async copyText(text) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('Copy is not available in this browser');
    },

    haptic(kind) {
      try {
        navigator.vibrate?.(kind === 'tick' ? 8 : kind === 'success' ? [12, 40, 12] : [30, 40, 30]);
      } catch {
        /* best effort */
      }
    },

    onBack: (handler) => back.push(handler),

    onPause(handler) {
      pauseHandlers.add(handler);
      return () => pauseHandlers.delete(handler);
    },

    keepAwake(on) {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (!on) {
        void wakeLock?.release().catch(() => {});
        wakeLock = null;
        return;
      }
      if (!wl || wakeLock) return;
      wl.request('screen').then(
        (lock) => {
          wakeLock = lock;
        },
        () => {
          /* best effort */
        },
      );
    },

    captureImage() {
      return new Promise<Blob | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
        input.style.display = 'none';
        input.addEventListener('change', () => {
          resolve(input.files?.[0] ?? null);
          input.remove();
        });
        input.addEventListener('cancel', () => {
          resolve(null);
          input.remove();
        });
        document.body.appendChild(input);
        input.click();
      });
    },
  };
}
