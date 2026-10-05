export type ToastKind = 'ok' | 'wn' | 'if';
export type ToastItem = { id: number; kind: ToastKind; message: string; action?: { label: string; run: () => void } };

let nextId = 1;

class ToastStore {
  items = $state<ToastItem[]>([]);
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  push(message: string, kind: ToastKind = 'if', action?: ToastItem['action']): number {
    const id = nextId++;
    this.items = [...this.items.slice(-3), { id, kind, message, action }];
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), action ? 9000 : 3600),
    );
    return id;
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new ToastStore();
export const toast = (message: string, kind: ToastKind = 'if', action?: ToastItem['action']) => toasts.push(message, kind, action);
