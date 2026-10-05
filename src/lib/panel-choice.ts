// Which properties panel shows for markup. Chosen from state (the selected
// object, the active tool, whether a text box is being typed in), never from
// which element has focus: typing in a text box or clicking in the panel must
// not change it.
import type { Annotation } from './annotations';
import { isGroupId } from './object-selection';

export type MarkupPanel = 'vector' | 'text' | 'stamp' | 'comment' | 'sign' | 'image' | 'form';

const BY_KIND: Record<string, MarkupPanel> = {
  highlight: 'vector',
  ink: 'vector',
  draw: 'vector',
  shape: 'vector',
  shapes: 'vector',
  text: 'text',
  stamp: 'stamp',
  note: 'comment',
  comment: 'comment',
  image: 'sign',
  sign: 'sign',
  form: 'form',
};

/**
 * The markup panel: Text while a text box is being typed in; else the selected
 * object's kind; else the active tool's. Null: no markup panel (then the
 * selected pages' panel or the document's).
 */
export function markupPanelFor(selected: Annotation | null | undefined, tool: string, editingText: boolean): MarkupPanel | null {
  if (editingText) return 'text';
  // Inserted images have their own panel; signatures stay with Sign.
  if (selected?.type === 'image' && selected.role === 'image') return 'image';
  return BY_KIND[selected?.type ?? tool] ?? null;
}

/**
 * Several objects or a group selected: "group" (its own panel: order and
 * delete), "multi-text" (all text boxes: the Text panel for all of them) or
 * "multi" (the controls every kind shares). Null for one plain object.
 */
export function panelForSelection(members: readonly Annotation[], ids: readonly string[]): 'group' | 'multi-text' | 'multi' | null {
  if (ids.length === 1 && isGroupId(ids[0])) return 'group';
  if (ids.length < 2) return null;
  return members.every((a) => a.type === 'text') ? 'multi-text' : 'multi';
}
