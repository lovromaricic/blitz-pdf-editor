// The rich text editor's document model (ProseMirror), restricted to what a
// text box can hold: paragraphs of text with run formats. There are no other
// node or mark types, and HTML from outside is never parsed (paste is plain
// text, see clipboard.ts), so nothing else can get in. No DOM needed: the
// conversions and formatting commands work (and are tested) without a view.
import { Fragment, Mark, Node, Schema, Slice, type MarkSpec } from 'prosemirror-model';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { sameRgb, type Rgb, type TextLink, type TextParagraph, type TextRun } from '../annotations';
import { linkStyle, unlinkStyle, type RunFormat } from '../text-rich';
import { trailingUrl } from '../links';

/** A mark carrying one attribute, written to (and only read back from) our own spans' data attributes. */
function valueMark(name: string, toStyle: (v: never) => string): MarkSpec {
  return {
    attrs: { value: {} },
    parseDOM: [{ tag: `span[data-${name}]`, getAttrs: (d) => ({ value: JSON.parse((d as HTMLElement).dataset[name]!) }) }],
    toDOM: (m) => ['span', { [`data-${name}`]: JSON.stringify(m.attrs.value), style: toStyle(m.attrs.value as never) }, 0],
  };
}

function flagMark(name: string, style: string): MarkSpec {
  return {
    parseDOM: [{ tag: `span[data-${name}]` }],
    toDOM: () => ['span', { [`data-${name}`]: '', style }, 0],
  };
}

/** Font family names for the editor's spans (set by the view; the model doesn't need fonts). */
export const cssFamilyHook = { family: (font: string) => font };

export const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      // The format of an empty paragraph (sets its line height, and is the typing style there).
      attrs: { empty: { default: null } },
      parseDOM: [{ tag: 'p', getAttrs: (d) => ({ empty: (d as HTMLElement).dataset.empty ? JSON.parse((d as HTMLElement).dataset.empty!) : null }) }],
      toDOM: (node) => {
        const empty = node.childCount === 0 ? (node.attrs.empty as RunFormat | null) : null;
        // A paragraph with text takes its height from its runs: its own line box (the
        // strut) is a 1px font's, which always sits inside theirs. An empty one takes its
        // height from its stored format, like the layout engine. (A zero-size strut,
        // font-size or line-height 0, breaks the browser's caret moves to line start/end.)
        const style = empty ? `font-size:calc(var(--s) * ${empty.size}px);font-family:${cssFamilyHook.family(empty.font)}` : '';
        return ['p', { style, ...(node.attrs.empty ? { 'data-empty': JSON.stringify(node.attrs.empty) } : {}) }, 0];
      },
    },
    text: {},
  },
  marks: {
    font: valueMark('font', (v: string) => `font-family:${cssFamilyHook.family(v)}`),
    size: valueMark('size', (v: number) => `font-size:calc(var(--s) * ${v}px)`),
    color: valueMark('color', (v: Rgb) => `color:rgb(${v.map((c) => Math.round(c * 255)).join(' ')})`),
    bold: flagMark('bold', 'font-weight:700'),
    italic: flagMark('italic', 'font-style:italic'),
    underline: flagMark('underline', ''),
    strike: flagMark('strike', ''),
    // A link doesn't spread to text typed right after it.
    link: { ...valueMark('link', () => ''), inclusive: false },
  },
});

export type FormatKey = keyof RunFormat;
const FLAGS = ['bold', 'italic', 'underline', 'strike'] as const;

// --- Runs <-> marks ------------------------------------------------------------------------

export function marksFor(f: RunFormat): Mark[] {
  const m = schema.marks;
  const marks = [m.font.create({ value: f.font }), m.size.create({ value: f.size }), m.color.create({ value: f.color })];
  for (const flag of FLAGS) if (f[flag]) marks.push(m[flag].create());
  if (f.link) marks.push(m.link.create({ value: f.link }));
  return marks;
}

export function formatOf(marks: readonly Mark[], fallback: RunFormat): RunFormat {
  const get = (name: string) => marks.find((m) => m.type.name === name);
  const f: RunFormat = {
    font: get('font')?.attrs.value ?? fallback.font,
    size: get('size')?.attrs.value ?? fallback.size,
    color: get('color')?.attrs.value ?? fallback.color,
  };
  for (const flag of FLAGS) if (get(flag)) f[flag] = true;
  const link = get('link')?.attrs.value as TextLink | undefined;
  if (link) f.link = link;
  return f;
}

export function docFromParagraphs(paragraphs: readonly TextParagraph[]): Node {
  return schema.node(
    'doc',
    null,
    paragraphs.map((p) => {
      const runs = p.runs.filter((r) => r.text);
      const last = p.runs[p.runs.length - 1];
      const { text: _t, ...emptyFormat } = last ?? ({} as TextRun);
      return schema.node('paragraph', { empty: runs.length ? null : emptyFormat }, runs.map(({ text, ...f }) => schema.text(text, marksFor(f))));
    }),
  );
}

/** Paragraph objects are kept per node, so unchanged paragraphs keep their identity (and their cached layout). */
const fromNode = new WeakMap<Node, TextParagraph>();

export function paragraphsFromDoc(doc: Node, fallback: RunFormat): TextParagraph[] {
  const out: TextParagraph[] = [];
  doc.forEach((p) => {
    let para = fromNode.get(p);
    if (!para) {
      const runs: TextRun[] = [];
      p.forEach((t) => runs.push({ ...formatOf(t.marks, fallback), text: t.text ?? '' }));
      para = { runs: runs.length ? runs : [{ ...((p.attrs.empty as RunFormat | null) ?? fallback), text: '' }] };
      fromNode.set(p, para);
    }
    out.push(para);
  });
  return out;
}

export function plainTextOf(doc: Node) {
  const lines: string[] = [];
  doc.forEach((p) => lines.push(p.textContent));
  return lines.join('\n');
}

// --- What the selection looks like ------------------------------------------------------------

export { MIXED, type Value } from './mixed';
import { MIXED, type Value } from './mixed';

export interface SelectionFormat {
  font: Value<string>;
  size: Value<number>;
  color: Value<Rgb>;
  bold: Value<boolean>;
  italic: Value<boolean>;
  underline: Value<boolean>;
  strike: Value<boolean>;
  link: Value<TextLink | null>;
}

/** Formats in the selection (or, for a caret, the typing style: stored marks, else the text before it). */
export function formatsInSelection(state: EditorState, fallback: RunFormat): RunFormat[] {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    const para = $from.parent;
    if (!marks.length && para.childCount === 0 && para.attrs.empty) return [para.attrs.empty as RunFormat];
    return [formatOf(marks, fallback)];
  }
  const out: RunFormat[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) out.push(formatOf(node.marks, fallback));
    else if (node.type.name === 'paragraph' && node.childCount === 0 && node.attrs.empty) out.push(node.attrs.empty as RunFormat);
  });
  return out.length ? out : [formatOf($from.marks(), fallback)];
}

function shared<T>(values: T[], same: (a: T, b: T) => boolean = Object.is): Value<T> {
  return values.every((v) => same(v, values[0])) ? values[0] : MIXED;
}

export function selectionFormat(state: EditorState, fallback: RunFormat): SelectionFormat {
  const fs = formatsInSelection(state, fallback);
  return {
    font: shared(fs.map((f) => f.font)),
    size: shared(fs.map((f) => f.size)),
    color: shared(
      fs.map((f) => f.color),
      (a, b) => sameRgb(a, b),
    ),
    bold: shared(fs.map((f) => !!f.bold)),
    italic: shared(fs.map((f) => !!f.italic)),
    underline: shared(fs.map((f) => !!f.underline)),
    strike: shared(fs.map((f) => !!f.strike)),
    link: shared(
      fs.map((f) => f.link ?? null),
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    ),
  };
}

// --- Formatting commands --------------------------------------------------------------------

function markFor(key: FormatKey, value: unknown): Mark | null {
  const type = schema.marks[key];
  if (key === 'bold' || key === 'italic' || key === 'underline' || key === 'strike') return value ? type.create() : null;
  if (value === undefined || value === null) return null;
  return type.create({ value });
}

/**
 * Set formats on the selected text, or (for a caret) on what will be typed
 * next. Empty paragraphs in the selection take the format too.
 */
export function applyFormat(changes: Partial<RunFormat>, fallback: RunFormat): Command {
  return (state, dispatch) => {
    const keys = Object.keys(changes) as FormatKey[];
    const { from, to, empty, $from } = state.selection;
    const tr = state.tr;
    if (empty) {
      let marks = state.storedMarks ?? $from.marks();
      if (!marks.length && $from.parent.childCount === 0) marks = marksFor(($from.parent.attrs.empty as RunFormat | null) ?? fallback);
      for (const key of keys) {
        marks = schema.marks[key].removeFromSet(marks);
        const mark = markFor(key, changes[key]);
        if (mark) marks = mark.addToSet(marks);
      }
      tr.setStoredMarks(marks);
      if ($from.parent.childCount === 0) {
        const pos = $from.before();
        tr.setNodeMarkup(pos, undefined, { empty: { ...(($from.parent.attrs.empty as RunFormat | null) ?? fallback), ...changes } });
      }
    } else {
      for (const key of keys) {
        tr.removeMark(from, to, schema.marks[key]);
        const mark = markFor(key, changes[key]);
        if (mark) tr.addMark(from, to, mark);
      }
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'paragraph' && node.childCount === 0) {
          tr.setNodeMarkup(tr.mapping.map(pos), undefined, { empty: { ...((node.attrs.empty as RunFormat | null) ?? fallback), ...changes } });
        }
      });
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** B / I / U / S: on if any of the selection is off (or mixed), else off. */
export function toggleFormat(key: 'bold' | 'italic' | 'underline' | 'strike', fallback: RunFormat): Command {
  return (state, dispatch) => {
    const current = selectionFormat(state, fallback)[key];
    return applyFormat({ [key]: current === MIXED ? true : !current }, fallback)(state, dispatch);
  };
}

// --- Plain text in, with the typing style -------------------------------------------------------

/** Insert plain text (paste or drop) at the selection, in the current typing style. Line breaks make paragraphs. */
export function insertPlainText(state: EditorState, text: string, fallback: RunFormat): Transaction {
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const format = formatOf(marks.length ? marks : marksFor(formatsInSelection(state, fallback)[0]), fallback);
  const { link: _l, ...plain } = format; // pasted text doesn't become part of a link
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paras = lines.map((line) => schema.node('paragraph', { empty: line ? null : plain }, line ? [schema.text(line, marksFor(plain))] : []));
  const slice = new Slice(Fragment.from(paras), 1, 1);
  return state.tr.replaceSelection(slice).scrollIntoView();
}

/** A caret at the end of the document. */
export function selectEnd(state: EditorState) {
  return state.tr.setSelection(TextSelection.atEnd(state.doc));
}

// --- Links ------------------------------------------------------------------------------------

export interface LinkRange {
  from: number;
  to: number;
  link: TextLink;
}

const linkOf = (node: Node | null | undefined) => (node?.marks.find((m) => m.type === schema.marks.link)?.attrs.value as TextLink | undefined) ?? null;
const sameTarget = (a: TextLink | null, b: TextLink | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** The whole link around position `pos` (on either side of it), within its paragraph. */
export function linkRangeAt(doc: Node, pos: number, side: 'both' | 'inside' = 'both'): LinkRange | null {
  const $pos = doc.resolve(pos);
  const para = $pos.parent;
  if (!para.isTextblock) return null;
  const before = $pos.nodeBefore ? linkOf($pos.nodeBefore) : null;
  const after = $pos.nodeAfter ? linkOf($pos.nodeAfter) : null;
  // A caret is inside a link only with the link on both sides of it (its ends belong to the text around).
  const link = side === 'inside' ? (sameTarget(before, after) ? before : null) : (after ?? before);
  if (!link) return null;
  // Walk the paragraph's text nodes, collecting the stretch with this link that touches pos.
  const start = $pos.start();
  let from = -1;
  let to = -1;
  let offset = 0;
  let found: LinkRange | null = null;
  para.forEach((child) => {
    if (found) return;
    const a = start + offset;
    const b = a + child.nodeSize;
    offset += child.nodeSize;
    if (sameTarget(linkOf(child), link)) {
      if (from < 0) from = a;
      to = b;
    } else {
      if (from >= 0 && pos >= from && pos <= to) found = { from, to, link };
      from = -1;
    }
  });
  if (!found && from >= 0 && pos >= from && pos <= to) found = { from, to, link };
  return found;
}

/**
 * The link the selection is in: a caret inside a link, or a selection within
 * one link. Then the link popover edits that whole link.
 */
export function selectedLink(state: EditorState): LinkRange | null {
  const { from, to, empty } = state.selection;
  if (empty) return linkRangeAt(state.doc, from, 'inside');
  // At `from` the first selected character decides (the text after it).
  const range = linkRangeAt(state.doc, from, 'both');
  return range && range.from <= from && range.to >= to ? range : null;
}

/** Text of a range, paragraphs joined with a space (as one line in the popover's Text field). */
export function rangeText(doc: Node, from: number, to: number) {
  return doc.textBetween(from, to, ' ', ' ');
}

/** Set marks on every text node in [from, to): `f` maps each node's format to its new one. */
function remark(tr: Transaction, from: number, to: number, f: (format: RunFormat) => RunFormat, fallback: RunFormat) {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (a >= b) return;
    const next = marksFor(f(formatOf(node.marks, fallback)));
    for (const m of node.marks) tr.removeMark(a, b, m.type);
    for (const m of next) tr.addMark(a, b, m);
  });
}

/**
 * Make a link (or change one). `range` is the text it covers: an existing
 * link, the selection, or the caret. With `text`, that text replaces the
 * range (in the format at its start). A new link gets the link look (blue,
 * underlined); changing an existing link's target keeps how it looks.
 */
export function setLink(range: { from: number; to: number }, link: TextLink, text: string | null, fallback: RunFormat, existing: boolean): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    let { from, to } = range;
    const current = rangeText(state.doc, from, to);
    if (text !== null && text !== current) {
      const at = state.doc.resolve(from);
      const marks = from === to ? (state.storedMarks ?? at.marks()) : (at.nodeAfter?.marks ?? at.marks());
      const format = formatOf(marks.length ? marks : marksFor(formatsInSelection(state, fallback)[0]), fallback);
      tr.replaceRangeWith(from, to, schema.text(text, marksFor(format)));
      to = from + text.length;
    }
    markLink(tr, { from, to }, link, existing, fallback);
    // The caret goes after the link, where typing continues without it (and without its look).
    tr.setSelection(TextSelection.create(tr.doc, to));
    const last = tr.doc.resolve(to).nodeBefore;
    tr.setStoredMarks(last ? marksFor(unlinkStyle(formatOf(last.marks, fallback), fallback.color)) : null);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Put a link on [from, to): a new one with the link look; an existing one keeps how it looks. */
export function markLink(tr: Transaction, range: { from: number; to: number }, link: TextLink, existing: boolean, fallback: RunFormat) {
  remark(tr, range.from, range.to, (f) => (existing ? { ...f, link } : linkStyle(f, link)), fallback);
  return tr;
}

/** Remove a link: its text goes back to the box's color (unless recoloured) without the underline. */
export function removeLink(range: { from: number; to: number }, fallback: RunFormat): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    remark(tr, range.from, range.to, (f) => (f.link ? unlinkStyle(f, fallback.color) : f), fallback);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * An address typed just before `pos` (followed by a space or Enter): its
 * range and where it links, if it isn't a link already.
 */
export function autoLinkBefore(state: EditorState, pos: number): LinkRange | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  // Non-text nodes can't occur (the schema has none); textBetween keeps offsets aligned.
  const before = $pos.parent.textBetween(0, $pos.parentOffset);
  const hit = trailingUrl(before);
  if (!hit) return null;
  const from = $pos.start() + hit.from;
  const to = $pos.start() + hit.to;
  let linked = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && linkOf(node)) linked = true;
  });
  return linked ? null : { from, to, link: { kind: 'url', href: hit.href } };
}

/**
 * Right at either end of a link, typing would take the link's look (blue,
 * underlined) without the link. Returns the marks to type with instead: the
 * same format without the link look. Null when the caret isn't at a link's end
 * (or a typing style was already chosen).
 */
export function typingMarksAtLinkEdge(state: EditorState, fallback: RunFormat): readonly Mark[] | null {
  const { empty, $from } = state.selection;
  if (!empty || state.storedMarks) return null;
  const before = linkOf($from.nodeBefore);
  const after = linkOf($from.nodeAfter);
  if ((!before && !after) || sameTarget(before, after)) return null;
  const marks = $from.marks();
  if (marks.some((m) => m.type === schema.marks.link)) return null;
  const f = formatOf(marks, fallback);
  const plain = unlinkStyle(f, fallback.color);
  return sameFormatMarks(f, plain) ? null : marksFor(plain);
}

const sameFormatMarks = (a: RunFormat, b: RunFormat) => JSON.stringify(marksFor(a)) === JSON.stringify(marksFor(b));
