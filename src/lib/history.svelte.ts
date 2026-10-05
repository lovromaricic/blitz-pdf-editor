// Generic undo/redo over immutable snapshots, with "unsaved changes" tracking.

interface Entry<T> {
  label: string;
  state: T;
  version: number;
  /** Edits with the same key in quick succession share one undo step. */
  key?: string;
  time?: number;
}

const COALESCE_MS = 1500;

const LIMIT = 200;

export class History<T> {
  private past = $state.raw<Entry<T>[]>([]);
  private future = $state.raw<Entry<T>[]>([]);
  private version = $state(0);
  private savedVersion = $state(0);
  private nextVersion = 1;

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past.at(-1)?.label;
  }
  get redoLabel() {
    return this.future.at(-1)?.label;
  }
  get dirty() {
    return this.version !== this.savedVersion;
  }

  /**
   * Record `previous` (the state before an edit) under `label`. With a
   * `coalesceKey`, a burst of edits (e.g. dragging a slider) is one undo step.
   */
  push(label: string, previous: T, coalesceKey?: string) {
    const last = this.past.at(-1);
    const now = Date.now();
    if (coalesceKey && last?.key === coalesceKey && this.future.length === 0 && now - (last.time ?? 0) < COALESCE_MS) {
      last.time = now;
    } else {
      this.past = [...this.past, { label, state: previous, version: this.version, key: coalesceKey, time: now }].slice(-LIMIT);
    }
    this.future = [];
    this.version = this.nextVersion++;
  }

  /** Returns the state to restore, or undefined. `current` is kept for redo. */
  undo(current: T): T | undefined {
    const entry = this.past.at(-1);
    if (!entry) return undefined;
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, { label: entry.label, state: current, version: this.version }];
    this.version = entry.version;
    return entry.state;
  }

  redo(current: T): T | undefined {
    const entry = this.future.at(-1);
    if (!entry) return undefined;
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, { label: entry.label, state: current, version: this.version }];
    this.version = entry.version;
    return entry.state;
  }

  /** A change that belongs to the last step (it stays one undo step; the document counts as changed). */
  touch() {
    this.future = [];
    this.version = this.nextVersion++;
  }

  /** Forget what redo could bring back (an edit that was taken back as if it never happened). */
  dropRedo() {
    this.future = [];
  }

  /** Every state undo or redo can still go back to. */
  states(): T[] {
    return [...this.past, ...this.future].map((e) => e.state);
  }

  markSaved() {
    this.savedVersion = this.version;
  }
}
