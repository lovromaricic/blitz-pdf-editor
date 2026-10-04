// Whole-window drop target: an enter/leave counter, so crossing child elements
// doesn't flicker, with a reset when the drag leaves the window or ends.
// Pure, so it can be unit tested.

export interface DragState {
  /** Nested dragenter count (0 = nothing over the window). */
  depth: number;
}

export type DragKind = 'enter' | 'leave' | 'drop' | 'end';

export interface DragInput {
  kind: DragKind;
  /** The drag carries files (dataTransfer.types includes "Files"). Text, links and images from pages don't. */
  files: boolean;
  /**
   * The pointer left the window: dragleave with no relatedTarget at the window's edge
   * (some browsers report clientX/Y as 0 there).
   */
  leftWindow?: boolean;
}

export const IDLE: DragState = { depth: 0 };

export function nextDrag(state: DragState, input: DragInput): DragState {
  if (input.kind === 'drop' || input.kind === 'end') return IDLE;
  if (!input.files) return state;
  if (input.kind === 'enter') return { depth: state.depth + 1 };
  // leave
  if (input.leftWindow) return IDLE;
  return { depth: Math.max(0, state.depth - 1) };
}

export const isOver = (s: DragState) => s.depth > 0;

export function carriesFiles(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!types) return false;
  return Array.prototype.indexOf.call(types, 'Files') >= 0;
}
