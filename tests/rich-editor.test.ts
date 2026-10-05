import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo, redo } from 'prosemirror-history';
import type { TextParagraph, TextRun } from '../src/lib/annotations';
import type { RunFormat } from '../src/lib/text-rich';
import { normalize } from '../src/lib/text-rich';
import {
  applyFormat,
  autoLinkBefore,
  docFromParagraphs,
  insertPlainText,
  MIXED,
  paragraphsFromDoc,
  plainTextOf,
  removeLink,
  schema,
  selectedLink,
  setLink,
  selectionFormat,
  toggleFormat,
} from '../src/lib/rich-text/schema';
import { LINK_COLOR } from '../src/lib/annotations';
import { copiedSlice, markerFromHtml, markerHtml, rememberCopy } from '../src/lib/rich-text/clipboard';

const BASE: RunFormat = { font: 'roboto', size: 12, color: [0, 0, 0] };
const run = (text: string, over: Partial<TextRun> = {}): TextRun => ({ ...BASE, text, ...over });
const paras = (...ps: TextRun[][]): TextParagraph[] => ps.map((runs) => ({ runs }));

function stateOf(p: TextParagraph[]) {
  return EditorState.create({ doc: docFromParagraphs(p), plugins: [history()] });
}
/** Select from character `a` to `b` of the first paragraph (positions inside it start at 1). */
function select(state: EditorState, a: number, b = a) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + a, 1 + b)));
}
function run_(state: EditorState, cmd: (s: EditorState, d: (tr: import('prosemirror-state').Transaction) => void) => boolean) {
  let next = state;
  cmd(state, (tr) => (next = state.apply(tr)));
  return next;
}
const content = (state: EditorState) => normalize(paragraphsFromDoc(state.doc, BASE));

describe('rich text model', () => {
  it('round-trips paragraphs of runs, empty paragraphs included', () => {
    const p = paras([run('Plain '), run('bold', { bold: true, color: [1, 0, 0] }), run(' big', { size: 20, font: 'lora', italic: true, underline: true, strike: true })], [run('', { size: 30 })], [run('link', { link: { kind: 'url', href: 'https://example.com' } })]);
    expect(content(stateOf(p))).toEqual(p);
    expect(plainTextOf(docFromParagraphs(p))).toBe('Plain bold big\n\nlink');
  });

  it('has only paragraphs and text: no other node or mark can exist', () => {
    expect(Object.keys(schema.nodes)).toEqual(['doc', 'paragraph', 'text']);
    expect(Object.keys(schema.marks)).toEqual(['font', 'size', 'color', 'bold', 'italic', 'underline', 'strike', 'link']);
  });
});

describe('formatting a partial selection', () => {
  const start = stateOf(paras([run('Hello world')]));

  it('applies to the selected characters only', () => {
    const s = run_(select(start, 6, 11), applyFormat({ bold: true, color: [0, 0, 1] }, BASE));
    expect(content(s)).toEqual(paras([run('Hello '), run('world', { bold: true, color: [0, 0, 1] })]));
  });

  it('changes size and font inside a word', () => {
    const s = run_(select(start, 2, 4), applyFormat({ size: 24, font: 'lora' }, BASE));
    expect(content(s)).toEqual(paras([run('He'), run('ll', { size: 24, font: 'lora' }), run('o world')]));
  });

  it('toggles: on when any of the selection is off, off when all of it is on', () => {
    let s = run_(select(start, 0, 5), applyFormat({ underline: true }, BASE));
    s = run_(select(s, 0, 11), toggleFormat('underline', BASE)); // mixed → on everywhere
    expect(content(s)).toEqual(paras([run('Hello world', { underline: true })]));
    s = run_(s, toggleFormat('underline', BASE)); // all on → off
    expect(content(s)).toEqual(paras([run('Hello world')]));
  });
});

describe('mixed state', () => {
  it('shows each format the whole selection shares, and Mixed where it differs', () => {
    const s = select(stateOf(paras([run('aa', { bold: true, size: 10 }), run('bb', { size: 14, bold: true })])), 0, 4);
    const f = selectionFormat(s, BASE);
    expect(f.bold).toBe(true);
    expect(f.size).toBe(MIXED);
    expect(f.font).toBe('roboto');
    expect(f.underline).toBe(false);
  });

  it('for a caret, shows the text before it', () => {
    const s = select(stateOf(paras([run('aa', { italic: true }), run('bb')])), 1);
    expect(selectionFormat(s, BASE).italic).toBe(true);
  });
});

describe('typing style', () => {
  it('a format chosen at the caret applies to what is typed next', () => {
    let s = select(stateOf(paras([run('Hi')])), 2);
    s = run_(s, applyFormat({ bold: true, size: 18 }, BASE));
    expect(selectionFormat(s, BASE)).toMatchObject({ bold: true, size: 18 });
    s = s.apply(s.tr.insertText(' there'));
    expect(content(s)).toEqual(paras([run('Hi'), run(' there', { bold: true, size: 18 })]));
  });

  it('an empty paragraph keeps its format (line height, and the style of new text)', () => {
    let s = stateOf(paras([run('', { size: 30, color: [1, 0, 0] })]));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1)));
    expect(selectionFormat(s, BASE)).toMatchObject({ size: 30 });
    s = run_(s, applyFormat({ italic: true }, BASE));
    expect(content(s)).toEqual(paras([run('', { size: 30, color: [1, 0, 0], italic: true })]));
  });
});

describe('paste', () => {
  it('is plain text in the typing style; line breaks make paragraphs; links are not continued', () => {
    let s = select(stateOf(paras([run('Go '), run('here', { link: { kind: 'url', href: 'https://a.example' }, bold: true })])), 7);
    s = s.apply(insertPlainText(s, 'one\ntwo', BASE));
    expect(content(s)).toEqual(paras([run('Go '), run('here', { link: { kind: 'url', href: 'https://a.example' }, bold: true }), run('one', { bold: true })], [run('two', { bold: true })]));
  });

  it('keeps formatting between our own text boxes through the in-memory clipboard only', () => {
    const src = select(stateOf(paras([run('ab'), run('cd', { italic: true })])), 1, 3);
    const slice = src.selection.content();
    const marker = rememberCopy(slice, 'bc');
    expect(copiedSlice(marker, 'bc')).toBe(slice);
    // Something else was copied since (another app): plain text wins.
    expect(copiedSlice(marker, 'other text')).toBeNull();
    expect(copiedSlice(null, 'bc')).toBeNull();
    // The marker survives in the HTML flavour (browsers may drop custom types); HTML from elsewhere has none.
    expect(markerFromHtml(markerHtml(marker, 'b<c>'))).toBe(marker);
    expect(markerHtml(marker, '<script>')).not.toContain('<script>');
    expect(markerFromHtml('<b>Bold</b> <meta name="other" content="x">')).toBeNull();
    let dst = select(stateOf(paras([run('XY')])), 1);
    dst = dst.apply(dst.tr.replaceSelection(slice));
    expect(content(dst)).toEqual(paras([run('Xb'), run('c', { italic: true }), run('Y')]));
  });
});

describe('undo within an editing session', () => {
  it('undoes and redoes typing and formatting step by step', () => {
    let s = select(stateOf(paras([run('One')])), 3);
    s = s.apply(s.tr.insertText(' two'));
    s = run_(select(s, 0, 3), applyFormat({ bold: true }, BASE));
    expect(content(s)).toEqual(paras([run('One', { bold: true }), run(' two')]));
    s = run_(s, undo);
    expect(content(s)).toEqual(paras([run('One two')]));
    s = run_(s, undo);
    expect(content(s)).toEqual(paras([run('One')]));
    s = run_(s, redo);
    expect(content(s)).toEqual(paras([run('One two')]));
  });
});

describe('links', () => {
  const WEB = { kind: 'url', href: 'https://example.com/' } as const;
  const link = (text: string, over: Partial<TextRun> = {}) => run(text, { link: WEB, color: LINK_COLOR, underline: true, ...over });

  it('links the selection with the link look; the caret goes after it', () => {
    let s = select(stateOf(paras([run('Read the docs')])), 9, 13);
    s = run_(s, setLink({ from: 10, to: 14 }, WEB, null, BASE, false));
    expect(content(s)).toEqual(paras([run('Read the '), link('docs')]));
    expect(s.selection.from).toBe(14);
    // Typing after it isn't part of the link, and looks like the text around it.
    s = s.apply(s.tr.insertText('!'));
    expect(content(s)).toEqual(paras([run('Read the '), link('docs'), run('!')]));
  });

  it('with new text, inserts it as the link (at a caret) or replaces the selection', () => {
    let s = select(stateOf(paras([run('Mail ')])), 5);
    s = run_(s, setLink({ from: 6, to: 6 }, { kind: 'url', href: 'mailto:a@b.co' }, 'us', BASE, false));
    expect(content(s)).toEqual(paras([run('Mail '), run('us', { link: { kind: 'url', href: 'mailto:a@b.co' }, color: LINK_COLOR, underline: true })]));
  });

  it('changing where an existing link goes keeps how it looks', () => {
    let s = stateOf(paras([run('A '), link('site', { color: [1, 0, 0], bold: true })]));
    const range = selectedLink(select(s, 3))!;
    expect(range).toEqual({ from: 3, to: 7, link: WEB });
    s = run_(s, setLink(range, { kind: 'page', pageId: 'p2' }, null, BASE, true));
    expect(content(s)).toEqual(paras([run('A '), link('site', { color: [1, 0, 0], bold: true, link: { kind: 'page', pageId: 'p2' } })]));
  });

  it('finds the link the caret is in (not at its ends), or the one a selection is within', () => {
    const s = stateOf(paras([run('Go '), link('there'), run(' now')]));
    expect(selectedLink(select(s, 3))).toBeNull(); // at its start
    expect(selectedLink(select(s, 8))).toBeNull(); // at its end
    expect(selectedLink(select(s, 5))).toMatchObject({ from: 4, to: 9 });
    expect(selectedLink(select(s, 4, 6))).toMatchObject({ from: 4, to: 9 });
    expect(selectedLink(select(s, 2, 6))).toBeNull(); // reaches outside it
  });

  it('removing a link restores the text (unless recoloured)', () => {
    let s = stateOf(paras([run('Go '), link('there'), run(' now')]));
    s = run_(s, removeLink({ from: 4, to: 9 }, BASE));
    expect(content(s)).toEqual(paras([run('Go there now')]));
    s = stateOf(paras([link('red', { color: [1, 0, 0] })]));
    s = run_(s, removeLink({ from: 1, to: 4 }, BASE));
    expect(content(s)).toEqual(paras([run('red', { color: [1, 0, 0], underline: true })]));
  });

  it('finds an address typed just before the caret, unless it is already a link', () => {
    const s = stateOf(paras([run('See example.com/docs.')]));
    expect(autoLinkBefore(s, 22)).toEqual({ from: 5, to: 21, link: { kind: 'url', href: 'https://example.com/docs' } });
    expect(autoLinkBefore(stateOf(paras([run('See '), link('example.com')])), 16)).toBeNull();
    expect(autoLinkBefore(stateOf(paras([run('the file.txt')])), 13)).toBeNull();
  });
});
