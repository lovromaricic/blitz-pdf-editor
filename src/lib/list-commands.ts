// What a list command does to paragraphs: one function for the Text panel's
// buttons, the editor's keys (Enter, Backspace, Tab) and its autoformat ("- "),
// both while typing (the editor applies it to the paragraphs the selection
// touches) and on a selected box (all its paragraphs).
import { MAX_LIST_LEVEL, type ListKind, type TextParagraph } from './annotations';
import { listLevel } from './list-numbering';

export type ListFields = Pick<TextParagraph, 'list' | 'level'>;
export type ListAction =
  /** Bulleted / Numbered: off when they all are that kind already, else that kind (switching type keeps the level). */
  | { type: 'toggle'; kind: ListKind }
  /** Increase / decrease indent of list items (one level, within 0..2). */
  | { type: 'indent'; delta: 1 | -1 }
  /** Leave the list one step: outdent, or at level 0 become a plain paragraph (Enter in an empty item, Backspace at its start). */
  | { type: 'step-out' }
  /** Make list items of this kind at their current level (autoformat). */
  | { type: 'set'; kind: ListKind };

export const LIST_LABELS = {
  bullet: 'Bulleted list',
  number: 'Numbered list',
  increase: 'Increase indent',
  decrease: 'Decrease indent',
};

/** The undo label of an action ("Undo bulleted list"). */
export function listActionLabel(action: ListAction) {
  if (action.type === 'indent') return action.delta > 0 ? LIST_LABELS.increase : LIST_LABELS.decrease;
  if (action.type === 'step-out') return 'Remove from list';
  return LIST_LABELS[action.kind];
}

const fields = (list: ListKind | undefined, level: number): ListFields => (list ? (level ? { list, level } : { list }) : {});

/** The list fields of each paragraph after the action (the same object where nothing changes). */
export function applyListAction(ps: readonly ListFields[], action: ListAction): ListFields[] {
  if (action.type === 'toggle') {
    const off = ps.length > 0 && ps.every((p) => p.list === action.kind);
    return ps.map((p) => (off ? fields(undefined, 0) : fields(action.kind, p.list ? listLevel(p as TextParagraph) : 0)));
  }
  if (action.type === 'set') return ps.map((p) => fields(action.kind, p.list ? listLevel(p as TextParagraph) : 0));
  if (action.type === 'step-out') {
    return ps.map((p) => {
      if (!p.list) return p;
      const level = listLevel(p as TextParagraph);
      return level > 0 ? fields(p.list, level - 1) : fields(undefined, 0);
    });
  }
  return ps.map((p) => {
    if (!p.list) return p;
    const level = Math.max(0, Math.min(MAX_LIST_LEVEL, listLevel(p as TextParagraph) + action.delta));
    return fields(p.list, level);
  });
}

/** Can the indent change for any of these list items? */
export function canIndent(ps: readonly ListFields[], delta: 1 | -1) {
  return ps.some((p) => p.list && (delta > 0 ? listLevel(p as TextParagraph) < MAX_LIST_LEVEL : listLevel(p as TextParagraph) > 0));
}

/** The list kind they share: a kind, null (none of them is a list item), or 'mixed'. */
export function sharedList(ps: readonly ListFields[]): ListKind | null | 'mixed' {
  if (!ps.length) return null;
  const first = ps[0].list ?? null;
  return ps.every((p) => (p.list ?? null) === first) ? first : 'mixed';
}

/**
 * Plain text pasted into an empty paragraph or box: lines starting with "- ",
 * "* ", "• " or "1. " (any number) become list items (two spaces or a tab of
 * indent per level); other lines stay plain. Null when no line is a list item.
 */
export function listLinesOf(text: string): { text: string; list?: ListKind; level?: number }[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let any = false;
  const out = lines.map((line) => {
    const m = /^([ \t]*)([-*•]|\d+[.)])[ \t]+(.*)$/.exec(line);
    if (!m) return { text: line };
    any = true;
    const indent = m[1].replace(/\t/g, '  ').length;
    const level = Math.min(MAX_LIST_LEVEL, Math.floor(indent / 2));
    return { text: m[3], list: (/\d/.test(m[2]) ? 'number' : 'bullet') as ListKind, ...(level ? { level } : {}) };
  });
  return any ? out : null;
}

/**
 * Screen readers: each list item's place among its siblings (same kind and
 * level, until a plain paragraph or a shallower item ends the list).
 */
export function listPositions(ps: readonly ListFields[]): ({ index: number; count: number; level: number } | null)[] {
  const out: ({ index: number; count: number; level: number } | null)[] = ps.map(() => null);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.list || out[i]) continue;
    const level = listLevel(p as TextParagraph);
    const members: number[] = [];
    for (let k = i; k < ps.length; k++) {
      const q = ps[k];
      if (!q.list) break;
      const ql = listLevel(q as TextParagraph);
      if (ql < level) break;
      if (ql > level) continue;
      if (q.list !== p.list) break;
      members.push(k);
    }
    members.forEach((k, n) => (out[k] = { index: n + 1, count: members.length, level }));
  }
  return out;
}
