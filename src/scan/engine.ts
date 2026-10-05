// One interface, two implementations: the real one runs in a Web Worker so the UI never freezes;
// the direct one runs the same code in-process (tests, and browsers without module workers).
import type { Contour } from '@/storage/types';
import { autoAlign, detectPage, rotate90, scLayout, type AlignResult, type LayoutInput, type RGBA } from './scan-core';
import { analyzeCells, traceLegacyBitmap, traceReferenceImage, traceScanCell, type CellInfo, type ScanParams } from './scan-ops';
import { decodeToRGBA } from './decode';
import type { GlyphArt, Metrics } from './trace';

export type { CellInfo, ScanParams };

export interface ScanEngine {
  /** Hands the image to the engine (the pixel buffer is transferred, not copied). */
  load(img: RGBA): Promise<{ width: number; height: number }>;
  rotate(quarters: number): Promise<{ width: number; height: number }>;
  align(layout: LayoutInput, page: number): Promise<AlignResult>;
  detectPage(layout: LayoutInput): Promise<{ page: number; dark: boolean }>;
  analyze(p: ScanParams, only?: number[]): Promise<CellInfo[]>;
  traceCell(p: ScanParams, gi: number, m: Metrics): Promise<GlyphArt | null>;
  /** Traces a v3 glyph bitmap (decoded here so the main thread stays free). */
  traceLegacy(blob: Blob, advance: number, m: Metrics): Promise<Contour[]>;
  /** Traces a reference picture at a brightness threshold. */
  traceReference(blob: Blob, threshold: number, advance: number, m: Metrics): Promise<Contour[]>;
  dispose(): void;
}

export class DirectEngine implements ScanEngine {
  private img: RGBA | null = null;
  private need(): RGBA {
    if (!this.img) throw new Error('No scan loaded');
    return this.img;
  }
  async load(img: RGBA) {
    this.img = img;
    return { width: img.width, height: img.height };
  }
  async rotate(q: number) {
    this.img = rotate90(this.need(), q);
    return { width: this.img.width, height: this.img.height };
  }
  async align(layout: LayoutInput, page: number) {
    return autoAlign(this.need(), scLayout(layout), page);
  }
  async detectPage(layout: LayoutInput) {
    return detectPage(this.need(), scLayout(layout));
  }
  async analyze(p: ScanParams, only?: number[]) {
    return analyzeCells(this.need(), p, only);
  }
  async traceCell(p: ScanParams, gi: number, m: Metrics) {
    return traceScanCell(this.need(), p, gi, m);
  }
  async traceLegacy(blob: Blob, advance: number, m: Metrics) {
    return traceLegacyBitmap(await decodeToRGBA(blob), advance, m);
  }
  async traceReference(blob: Blob, threshold: number, advance: number, m: Metrics) {
    return traceReferenceImage(await decodeToRGBA(blob, 1400), threshold, advance, m);
  }
  dispose() {
    this.img = null;
  }
}

type Req = { id: number; op: keyof ScanEngine; args: unknown[] };
type Res = { id: number; ok: boolean; result?: unknown; error?: string };

class WorkerEngine implements ScanEngine {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  constructor() {
    this.worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Res>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result as never);
      else p.reject(new Error(e.data.error ?? 'Worker error'));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker failed'));
      this.pending.clear();
    };
  }
  private call<T>(op: keyof ScanEngine, args: unknown[], transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as never, reject });
      this.worker.postMessage({ id, op, args } satisfies Req, transfer);
    });
  }
  load(img: RGBA) {
    return this.call<{ width: number; height: number }>('load', [img], [img.data.buffer]);
  }
  rotate(q: number) { return this.call<{ width: number; height: number }>('rotate', [q]); }
  align(layout: LayoutInput, page: number) { return this.call<AlignResult>('align', [layout, page]); }
  detectPage(layout: LayoutInput) { return this.call<{ page: number; dark: boolean }>('detectPage', [layout]); }
  analyze(p: ScanParams, only?: number[]) { return this.call<CellInfo[]>('analyze', [p, only]); }
  traceCell(p: ScanParams, gi: number, m: Metrics) { return this.call<GlyphArt | null>('traceCell', [p, gi, m]); }
  traceLegacy(blob: Blob, advance: number, m: Metrics) { return this.call<Contour[]>('traceLegacy', [blob, advance, m]); }
  traceReference(blob: Blob, t: number, advance: number, m: Metrics) { return this.call<Contour[]>('traceReference', [blob, t, advance, m]); }
  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Scanner closed'));
    this.pending.clear();
  }
}

/** The worker needs `createImageBitmap` and `OffscreenCanvas` (all current Chrome and Android WebView). */
export function workersAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

export function createScanEngine(): ScanEngine {
  if (workersAvailable()) {
    try {
      return new WorkerEngine();
    } catch (e) {
      console.warn('FontCraft: scan worker unavailable, running on the main thread', e);
    }
  }
  return new DirectEngine();
}

export { type Req, type Res };
