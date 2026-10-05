import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo, closeHistory } from 'prosemirror-history';
import type { TextParagraph, TextRun } from '../src/lib/annotations';
import type { RunFormat } from '../src/lib/text-rich';
import { normalize } from '../src/lib/text-rich';
import { applyListAction, canIndent, listActionLabel, listLinesOf, listPositions, sharedList } from '../src/lib/list-commands';
import { autoListBefore, caretListItem, docFromParagraphs, insertPlainText, listBackspace, listCommand, paragraphsFromDoc } from '../src/lib/rich-text/schema';

const BASE: RunFormat = { font: 'roboto', size: 12, color: [0, 0, 0] };
const run = (text: string, over: Partial<TextRun> = {}): TextRun => ({ ...BASE, text, ...over });
const p = (text: string, list?: 'bullet' | 'number', level = 0): TextParagraph => ({ runs: [run(text)], ...(list ? { list } : {}), ...(level ? { level } : {}) });
const stateOf = (ps: TextParagraph[]) => EditorState.create({ doc: docFromParagraphs(ps), plugins: [history()] });
const content = (s: EditorState) => normalize(paragraphsFromDoc(s.doc, BASE));
const lists = (s: EditorState) => content(s).map((x) => `${x.list ?? '-'}${x.level ?? 0}:${x.runs.map((r) => r.text).join('')}`);
/** Caret in paragraph `i` at offset `o`. */
function caret(s: EditorState, i: number, o: number) {
  let pos = 0;
  s.doc.forEach((node, offset, k) => k === i && (pos = offset + 1 + o));
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
}
function run_(s: EditorState, cmd: (st: EditorState, d: (tr: import('prosemirror-state').Transaction) => void) => boolean) {
  let next = s;
  cmd(s, (tr) => (next = s.apply(tr)));
  return next;
}

describe('list actions (one function for the panel, keys and autoformat)', () => {
  it('toggle: on, switch type keeping the level, off when all are that type', () => {
    const ps = [{}, { list: 'number' as const, level: 1 }];
    expect(applyListAction(ps, { type: 'toggle', kind: 'bullet' })).toEqual([{ list: 'bullet' }, { list: 'bullet', level: 1 }]);
    expect(applyListAction([{ list: 'bullet' }, { list: 'bullet', level: 2 }], { type: 'toggle', kind: 'bullet' })).toEqual([{}, {}]);
  });

  it('indent within 0..2, only list items; disabled at the limits', () => {
    expect(applyListAction([{ list: 'bullet', level: 2 }, {}, { list: 'number' }], { type: 'indent', delta: 1 })).toEqual([{ list: 'bullet', level: 2 }, {}, { list: 'number', level: 1 }]);
    expect(canIndent([{ list: 'bullet', level: 2 }], 1)).toBe(false);
    expect(canIndent([{ list: 'bullet' }], -1)).toBe(false);
    expect(canIndent([{}], 1)).toBe(false);
    expect(listActionLabel({ type: 'toggle', kind: 'bullet' })).toBe('Bulleted list');
    expect(listActionLabel({ type: 'indent', delta: 1 })).toBe('Increase indent');
  });

  it('shows Mixed when the paragraphs differ', () => {
    expect(sharedList([{ list: 'bullet' }, { list: 'bullet', level: 1 }])).toBe('bullet');
    expect(sharedList([{ list: 'bullet' }, {}])).toBe('mixed');
    expect(sharedList([{}, {}])).toBeNull();
  });

  it('item positions for screen readers', () => {
    expect(listPositions([{ list: 'bullet' }, { list: 'bullet', level: 1 }, { list: 'bullet' }, {}, { list: 'number' }])).toEqual([
      { index: 1, count: 2, level: 0 },
      { index: 1, count: 1, level: 1 },
      { index: 2, count: 2, level: 0 },
      null,
      { index: 1, count: 1, level: 0 },
    ]);
  });
});

describe('list keys while typing', () => {
  it('Enter in an empty item steps out: outdent, then a plain paragraph', () => {
    let s = caret(stateOf([p('One', 'bullet'), p('', 'bullet', 1)]), 1, 0);
    s = run_(s, listCommand({ type: 'step-out' }));
    expect(lists(s)).toEqual(['bullet0:One', 'bullet0:']);
    s = run_(s, listCommand({ type: 'step-out' }));
    expect(lists(s)).toEqual(['bullet0:One', '-0:']);
  });

  it('Backspace at the start of an item removes the marker first, then merges as usual', () => {
    let s = caret(stateOf([p('One'), p('Two', 'number', 1)]), 1, 0);
    expect(listBackspace(s)).toBe(true);
    s = run_(s, listBackspace);
    expect(lists(s)).toEqual(['-0:One', 'number0:Two']);
    s = run_(s, listBackspace);
    expect(lists(s)).toEqual(['-0:One', '-0:Two']);
    expect(listBackspace(s)).toBe(false); // now the usual Backspace joins the paragraphs
    // Not at the start: not ours.
    expect(listBackspace(caret(stateOf([p('Two', 'bullet')]), 0, 2))).toBe(false);
  });

  it('Tab and Shift+Tab only apply in a list item, within the limits', () => {
    const s = caret(stateOf([p('Item', 'bullet', 1), p('Plain')]), 0, 2);
    expect(caretListItem(s)).toEqual({ list: 'bullet', level: 1 });
    expect(lists(run_(s, listCommand({ type: 'indent', delta: 1 })))).toEqual(['bullet2:Item', '-0:Plain']);
    expect(caretListItem(caret(s, 1, 0))).toBeNull();
  });

  it('"- " at the start of an empty paragraph becomes a bullet item; one undo brings the characters back', () => {
    let s = caret(stateOf([p('-')]), 0, 1);
    expect(autoListBefore(s, s.selection.from)).toMatchObject({ kind: 'bullet' });
    // As the editor does it: the space typed (one step), then the list as its own step.
    s = s.apply(s.tr.insertText(' '));
    const item = autoListBefore(caret(stateOf([p('-')]), 0, 1), 2)!;
    const tr = s.tr.delete(item.from, item.to + 1);
    const at = tr.doc.resolve(item.from);
    const [f] = applyListAction([{}], { type: 'set', kind: item.kind });
    tr.setNodeMarkup(at.before(), undefined, { ...at.parent.attrs, list: f.list, level: 0 });
    s = s.apply(closeHistory(tr));
    expect(lists(s)).toEqual(['bullet0:']);
    s = run_(s, undo);
    expect(lists(s)).toEqual(['-0:- ']);
    expect(autoListBefore(caret(stateOf([p('1.')]), 0, 2), 3)).toMatchObject({ kind: 'number' });
    // Not when there's other text in the paragraph, or it already is an item.
    expect(autoListBefore(caret(stateOf([p('-x')]), 0, 1), 2)).toBeNull();
    expect(autoListBefore(caret(stateOf([p('-', 'bullet')]), 0, 1), 2)).toBeNull();
    expect(autoListBefore(caret(stateOf([p('2.')]), 0, 2), 3)).toBeNull();
  });
});

describe('pasting plain text', () => {
  it('into an empty paragraph: "- ", "* ", "• " and "1. " lines become list items (indent: levels)', () => {
    expect(listLinesOf('- a\n  - b\n1. c\nplain')).toEqual([{ text: 'a', list: 'bullet' }, { text: 'b', list: 'bullet', level: 1 }, { text: 'c', list: 'number' }, { text: 'plain' }]);
    expect(listLinesOf('no list here')).toBeNull();
    let s = caret(stateOf([p('Before'), p('')]), 1, 0);
    s = s.apply(insertPlainText(s, '• one\n• two\n\t• deeper', BASE));
    expect(lists(s)).toEqual(['-0:Before', 'bullet0:one', 'bullet0:two', 'bullet1:deeper']);
  });

  it('into a paragraph with text: plain text, markers kept as typed', () => {
    let s = caret(stateOf([p('Say: ')]), 0, 5);
    s = s.apply(insertPlainText(s, '- one\n- two', BASE));
    expect(lists(s)).toEqual(['-0:Say: - one', '-0:- two']);
  });

  it('our own copies keep the list structure (in-memory slice)', () => {
    const src = stateOf([p('a', 'number'), p('b', 'number', 1)]);
    const slice = src.doc.slice(0, src.doc.content.size);
    let dst = caret(stateOf([p('x')]), 0, 1);
    dst = dst.apply(dst.tr.replaceSelection(slice));
    expect(lists(dst).slice(-1)).toEqual(['number1:b']);
  });
});
