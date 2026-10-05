import { isQuotaError } from './db';

export type AutosaveEvents = {
  onSaved?: () => void;
  onQuotaError?: (err: unknown) => void;
  onError?: (err: unknown) => void;
};

/**
 * Debounced writer. `schedule(key, task)` keeps only the latest task per key and runs it after
 * `delayMs` of quiet. `flush()` runs everything now (used when the tab hides or the app pauses).
 */
export class Autosaver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private tasks = new Map<string, () => Promise<void>>();
  private inflight = new Set<Promise<void>>();

  constructor(
    private readonly events: AutosaveEvents = {},
    private readonly delayMs = 300,
  ) {}

  get pending(): number {
    return this.tasks.size;
  }

  /** `delay` overrides the default debounce for this call (0 = write on the next tick). */
  schedule(key: string, task: () => Promise<void>, delay?: number): void {
    this.tasks.set(key, task);
    const old = this.timers.get(key);
    if (old) clearTimeout(old);
    this.timers.set(
      key,
      setTimeout(() => void this.run(key), delay ?? this.delayMs),
    );
  }

  private run(key: string): Promise<void> {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const task = this.tasks.get(key);
    this.tasks.delete(key);
    if (!task) return Promise.resolve();
    const p = task().then(
      () => this.events.onSaved?.(),
      (err) => {
        if (isQuotaError(err)) this.events.onQuotaError?.(err);
        else this.events.onError?.(err);
      },
    );
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  /** Runs every scheduled task immediately and waits for all writes in flight. */
  async flush(): Promise<void> {
    await Promise.all([...this.tasks.keys()].map((k) => this.run(k)));
    await Promise.all([...this.inflight]);
  }

  cancelAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.tasks.clear();
  }
}
