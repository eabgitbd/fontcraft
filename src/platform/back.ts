/** Stack of back-button handlers. The newest handler that returns true wins. */
export class BackStack {
  private handlers: Array<() => boolean> = [];

  push(handler: () => boolean): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.lastIndexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Returns true when some handler consumed the event. */
  dispatch(): boolean {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      const handler = this.handlers[i];
      if (handler && handler()) return true;
    }
    return false;
  }

  get size(): number {
    return this.handlers.length;
  }
}
