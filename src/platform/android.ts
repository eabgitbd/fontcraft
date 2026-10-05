import { App } from '@capacitor/app';
import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { BackStack } from './back';
import { blobToBase64, safeFileName } from './files';
import type { Platform, SaveResult } from './types';

const DOCS_FOLDER = 'FontCraft';

export function createAndroidPlatform(): Platform {
  const back = new BackStack();
  const pauseHandlers = new Set<() => void>();
  let wakeLock: { release(): Promise<void> } | null = null;

  void App.addListener('backButton', () => {
    if (back.dispatch()) return;
    // Nothing consumed it. The app registers a root handler that asks before exiting; if it
    // has not (early startup), leave the app in the background instead of killing it.
    void App.minimizeApp();
  });
  void App.addListener('pause', () => {
    for (const h of pauseHandlers) h();
  });

  async function saveFile(rawName: string, data: Blob): Promise<SaveResult> {
    const name = safeFileName(rawName);
    const base64 = await blobToBase64(data);
    // Cache is private to the app; Share hands the user Save to Files, Drive, WhatsApp and so on.
    const written = await Filesystem.writeFile({ path: `exports/${name}`, data: base64, directory: Directory.Cache, recursive: true });
    try {
      await Share.share({ title: name, url: written.uri, dialogTitle: `Save or share ${name}` });
      return 'shared';
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).toLowerCase();
      if (msg.includes('cancel')) return 'cancelled';
      throw err;
    }
  }

  async function saveToDocuments(rawName: string, data: Blob): Promise<SaveResult> {
    const name = safeFileName(rawName);
    const base64 = await blobToBase64(data);
    await Filesystem.writeFile({ path: `${DOCS_FOLDER}/${name}`, data: base64, directory: Directory.Documents, recursive: true });
    return 'saved';
  }

  return {
    isNative: true,
    saveFile,
    saveToDocuments,

    // Native file picking goes through the WebView's own <input type="file">.
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
      await Clipboard.write({ string: text });
    },

    haptic(kind) {
      const run =
        kind === 'tick'
          ? Haptics.impact({ style: ImpactStyle.Light })
          : Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Warning });
      void run.catch(() => {});
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

    async captureImage() {
      try {
        const photo = await Camera.takePhoto({ quality: 92, correctOrientation: true });
        if (!photo.uri) return null;
        const res = await fetch(Capacitor.convertFileSrc(photo.uri));
        return await res.blob();
      } catch (err) {
        const msg = String((err as Error)?.message ?? err).toLowerCase();
        if (msg.includes('cancel')) return null;
        throw err;
      }
    },
  };
}
