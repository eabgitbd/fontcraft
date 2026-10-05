// Command history. Commands are small deltas, never full snapshots. Capped at 200.
import type { Contour, PathNode, PenPath, Stroke } from '@/storage/types';

export type EditState = { readonly strokes: readonly Stroke[]; readonly paths: readonly PenPath[]; readonly traced: readonly Contour[] };
export const EMPTY_STATE: EditState = { strokes: [], paths: [], traced: [] };

export interface Command {
  readonly label: string;
  apply(s: EditState): EditState;
  revert(s: EditState): EditState;
}

const without = <T>(arr: readonly T[], i: number): T[] => arr.filter((_, j) => j !== i);
const insert = <T>(arr: readonly T[], i: number, v: T): T[] => [...arr.slice(0, i), v, ...arr.slice(i)];

export class AddStroke implements Command {
  readonly label: string = 'AddStroke';
  constructor(readonly stroke: Stroke) {}
  apply(s: EditState): EditState {
    return { ...s, strokes: [...s.strokes, this.stroke] };
  }
  revert(s: EditState): EditState {
    return { ...s, strokes: s.strokes.slice(0, -1) };
  }
}

/** An erase is an AddStroke with `erase: true`; kept as its own command so history labels read clearly. */
export class EraseStroke extends AddStroke {
  override readonly label = 'EraseStroke';
  constructor(stroke: Stroke) {
    super({ ...stroke, erase: true });
  }
}

export class AddPath implements Command {
  readonly label = 'AddPath';
  constructor(readonly path: PenPath) {}
  apply(s: EditState): EditState {
    return { ...s, paths: [...s.paths, this.path] };
  }
  revert(s: EditState): EditState {
    return { ...s, paths: s.paths.slice(0, -1) };
  }
}

export class MoveNode implements Command {
  readonly label = 'MoveNode';
  constructor(
    readonly pathIndex: number,
    readonly nodeIndex: number,
    readonly before: PathNode,
    readonly after: PathNode,
  ) {}
  private set(s: EditState, node: PathNode): EditState {
    const path = s.paths[this.pathIndex];
    if (!path || !path.nodes[this.nodeIndex]) return s;
    const nodes = path.nodes.map((n, i) => (i === this.nodeIndex ? node : n));
    return { ...s, paths: s.paths.map((p, i) => (i === this.pathIndex ? { ...p, nodes } : p)) };
  }
  apply(s: EditState): EditState {
    return this.set(s, this.after);
  }
  revert(s: EditState): EditState {
    return this.set(s, this.before);
  }
}

export class DeleteObject implements Command {
  readonly label = 'DeleteObject';
  constructor(
    readonly kind: 'stroke' | 'path',
    readonly index: number,
    readonly object: Stroke | PenPath,
  ) {}
  apply(s: EditState): EditState {
    return this.kind === 'stroke' ? { ...s, strokes: without(s.strokes, this.index) } : { ...s, paths: without(s.paths, this.index) };
  }
  revert(s: EditState): EditState {
    return this.kind === 'stroke'
      ? { ...s, strokes: insert(s.strokes, this.index, this.object as Stroke) }
      : { ...s, paths: insert(s.paths, this.index, this.object as PenPath) };
  }
}

/** Replaces the imported-artwork layer (SVG import, reference tracing). Undoable like any edit. */
export class SetTraced implements Command {
  constructor(
    readonly previous: readonly Contour[],
    readonly next: readonly Contour[],
    readonly label = 'SetTraced',
  ) {}
  apply(s: EditState): EditState {
    return { ...s, traced: this.next };
  }
  revert(s: EditState): EditState {
    return { ...s, traced: this.previous };
  }
}

export class ClearAll implements Command {
  readonly label = 'Clear';
  constructor(readonly previous: EditState) {}
  apply(): EditState {
    return EMPTY_STATE;
  }
  revert(): EditState {
    return this.previous;
  }
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(private readonly max = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get size(): number {
    return this.undoStack.length;
  }

  /** Applies `cmd` and records it. A new command discards the redo stack. */
  run(cmd: Command, state: EditState): EditState {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
    return cmd.apply(state);
  }

  undo(state: EditState): EditState | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    this.redoStack.push(cmd);
    return cmd.revert(state);
  }

  redo(state: EditState): EditState | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.undoStack.push(cmd);
    return cmd.apply(state);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
