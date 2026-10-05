/// <reference lib="webworker" />
import { DirectEngine, type Req, type Res } from './engine';

const engine = new DirectEngine();

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, op, args } = e.data;
  try {
    const fn = (engine as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[op];
    if (typeof fn !== 'function') throw new Error(`Unknown scan operation: ${String(op)}`);
    const result = await fn.apply(engine, args);
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies Res);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) } satisfies Res);
  }
};
