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
