// Layer order of the objects added to a page. A page's object list IS its
// stacking order, for every kind of object: the first is at the bottom (just
// above the PDF's own content, which never moves), the last on top. The editor
// draws them in that order, clicks hit the topmost, and saving writes them in
// that order. These functions only ever return a reordered copy (or the same
// list when nothing changes), so results go straight into undo history.

export type LayerMove = 'front' | 'forward' | 'backward' | 'back';

export const LAYER_LABELS: Record<LayerMove, string> = {
  front: 'Bring to front',
  forward: 'Bring forward',
  backward: 'Send backward',
  back: 'Send to back',
};

interface HasId {
  readonly id: string;
}

/** Can the object move this way? (Not further up when on top, not further down at the bottom.) */
export function canMoveLayer(list: readonly HasId[], id: string, move: LayerMove): boolean {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return false;
  return move === 'front' || move === 'forward' ? i < list.length - 1 : i > 0;
}

/**
 * The list with the object moved: to the top or bottom, or one step past the
 * next object above or below it. Returns `list` itself when it can't move.
 */
export function moveLayer<T extends HasId>(list: readonly T[], id: string, move: LayerMove): readonly T[] {
  if (!canMoveLayer(list, id, move)) return list;
  const i = list.findIndex((a) => a.id === id);
  const item = list[i];
  const rest = [...list.slice(0, i), ...list.slice(i + 1)];
  const at = move === 'front' ? rest.length : move === 'back' ? 0 : move === 'forward' ? i + 1 : i - 1;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/**
 * Add an object directly above another (a duplicate or a paste above its
 * original); on top when that one isn't in the list.
 */
export function insertAbove<T extends HasId>(list: readonly T[], aboveId: string | null, item: T): readonly T[] {
  const i = aboveId ? list.findIndex((a) => a.id === aboveId) : -1;
  if (i < 0) return [...list, item];
  return [...list.slice(0, i + 1), item, ...list.slice(i + 1)];
}

/** "Text, 3 of 5": an object's place in its page's order (1 at the bottom), for screen readers. */
export function layerPosition(list: readonly HasId[], id: string): { index: number; count: number } | null {
  const i = list.findIndex((a) => a.id === id);
  return i < 0 ? null : { index: i + 1, count: list.length };
}

/**
 * Tab / Shift+Tab through a page's objects in layer order (bottom first).
 * `current` is the selected object's index, or null when the page itself has
 * focus. Returns the index to select, or 'leave' to let focus go on (past the
 * last object) or 'page' (back before the first).
 */
export function stepThrough(count: number, current: number | null, back: boolean): number | 'leave' | 'page' {
  if (count === 0) return back ? 'page' : 'leave';
  if (current === null) return back ? 'page' : 0;
  const next = current + (back ? -1 : 1);
  if (next < 0) return 'page';
  if (next >= count) return 'leave';
  return next;
}

/**
 * Alt+click: the next object beneath at that point. `stack` lists the objects
 * under the pointer, topmost first; it continues from the selected one and
 * wraps around (from the topmost when the selected one isn't there).
 */
export function nextBeneath(stack: readonly string[], selectedId: string | null): string | null {
  if (!stack.length) return null;
  const i = selectedId ? stack.indexOf(selectedId) : -1;
  return stack[((i < 0 ? 0 : i) + 1) % stack.length];
}

// --- Several objects and groups as one block ----------------------------------------------

/**
 * The same moves for a selection of units (objects or whole groups, see
 * object-selection.ts): the selected units move as one block, keeping their
 * order among themselves. Forward and backward step past the next unselected
 * unit above (or below) the block.
 */
export function canMoveUnits<T extends { id: string; groups?: string[] }>(list: readonly T[], ids: readonly string[], move: LayerMove): boolean {
  const units = unitList(list);
  const sel = new Set(ids);
  const picked = units.map((u, i) => (sel.has(u) ? i : -1)).filter((i) => i >= 0);
  if (!picked.length) return false;
  const top = Math.max(...picked);
  const bottom = Math.min(...picked);
  const anyAbove = (i: number) => units.slice(i + 1).some((u) => !sel.has(u));
  const anyBelow = (i: number) => units.slice(0, i).some((u) => !sel.has(u));
  if (move === 'forward') return anyAbove(top);
  if (move === 'backward') return anyBelow(bottom);
  if (move === 'front') return picked.some(anyAbove);
  return picked.some(anyBelow);
}

export function moveUnits<T extends { id: string; groups?: string[] }>(list: readonly T[], ids: readonly string[], move: LayerMove): readonly T[] {
  if (!canMoveUnits(list, ids, move)) return list;
  const units = unitList(list);
  const sel = new Set(ids);
  const block = units.filter((u) => sel.has(u));
  const rest = units.filter((u) => !sel.has(u));
  let at: number;
  if (move === 'front') at = rest.length;
  else if (move === 'back') at = 0;
  else if (move === 'forward') {
    // Just above the first unselected unit above the block's top.
    const top = Math.max(...units.map((u, i) => (sel.has(u) ? i : -1)));
    const next = units.slice(top + 1).find((u) => !sel.has(u))!;
    at = rest.indexOf(next) + 1;
  } else {
    const bottom = Math.min(...units.map((u, i) => (sel.has(u) ? i : Infinity)));
    const prev = units.slice(0, bottom).filter((u) => !sel.has(u)).at(-1)!;
    at = rest.indexOf(prev);
  }
  const order = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return order.flatMap((u) => list.filter((a) => (a.groups?.[0] ?? a.id) === u));
}

/** Insert objects (a pasted block) directly above a unit, or on top when it isn't there. */
export function insertAboveUnit<T extends { id: string; groups?: string[] }>(list: readonly T[], unitId: string | null, items: readonly T[]): readonly T[] {
  let last = -1;
  if (unitId) list.forEach((a, i) => (a.groups?.[0] ?? a.id) === unitId && (last = i));
  if (last < 0) return [...list, ...items];
  return [...list.slice(0, last + 1), ...items, ...list.slice(last + 1)];
}

function unitList(list: readonly { id: string; groups?: string[] }[]): string[] {
  return [...new Set(list.map((a) => a.groups?.[0] ?? a.id))];
}
