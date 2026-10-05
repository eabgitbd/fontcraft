export type SaveResult = 'saved' | 'shared' | 'cancelled';

export interface Platform {
  /** Saves or shares a file. Never uses `<a download>` on native. */
  saveFile(name: string, data: Blob, mime: string): Promise<SaveResult>;
  /** Native only: also copy into Documents/FontCraft. Web falls back to `saveFile`. */
  saveToDocuments(name: string, data: Blob, mime: string): Promise<SaveResult>;
  openFile(accept: string[]): Promise<File | null>;
  copyText(text: string): Promise<void>;
  haptic(kind: 'tick' | 'success' | 'warn'): void;
  /** Registers a back handler. Handlers run newest first; return true if handled. Returns an unsubscribe. */
  onBack(handler: () => boolean): () => void;
  /** Called when the tab is hidden or the native app is paused: flush pending writes here. */
  onPause(handler: () => void): () => void;
  keepAwake(on: boolean): void;
  /** Camera on native, a file input with `capture` on the web. */
  captureImage(): Promise<Blob | null>;
  isNative: boolean;
}
