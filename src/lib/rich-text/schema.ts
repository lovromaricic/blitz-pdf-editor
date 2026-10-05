// The rich text editor's document model (ProseMirror), restricted to what a
// text box can hold: paragraphs of text with run formats. There are no other
// node or mark types, and HTML from outside is never parsed (paste is plain
// text, see clipboard.ts), so nothing else can get in. No DOM needed: the
// conversions and formatting commands work (and are tested) without a view.
import { Fragment, Mark, Node, Schema, Slice, type MarkSpec } from 'prosemirror-model';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { sameRgb, type ListKind, type Rgb, type TextLink, type TextParagraph, type TextRun } from '../annotations';
import { LIST_INDENT_EM } from '../text-rich-layout';
import { listLevel } from '../list-numbering';
import { applyListAction, listLinesOf, type ListAction, type ListFields } from '../list-commands';
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
export const cssFamilyHook = { family: (font: string) => font, /** The box's base size (a paragraph with no size of its own). */ defaultSize: 12 };

/** The size of a paragraph's first run (its list indent is measured in it), as the layout engine takes it. */
function firstRunSize(node: Node) {
  const first = node.firstChild;
  const mark = first?.marks.find((m) => m.type.name === 'size');
  if (mark) return mark.attrs.value as number;
  return (node.attrs.empty as RunFormat | null)?.size ?? cssFamilyHook.defaultSize;
}

export const schema = new Schema({
  nodes: {
    // `box`: box settings changed while editing (alignment, spacing, background…). Kept in
    // the document so they're part of the editor's undo and redo, and of the one session step.
    doc: { content: 'paragraph+', attrs: { box: { default: null } } },
    paragraph: {
      content: 'text*',
      // The format of an empty paragraph (sets its line height, and is the typing style there).
      // `list` and `level`: a list item (bullet or number) and its indent level.
      attrs: { empty: { default: null }, list: { default: null }, level: { default: 0 } },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (d) => {
            const el = d as HTMLElement;
            return { empty: el.dataset.empty ? JSON.parse(el.dataset.empty) : null, list: el.dataset.list ?? null, level: Number(el.dataset.level ?? 0) };
          },
        },
      ],
      toDOM: (node) => {
        const empty = node.childCount === 0 ? (node.attrs.empty as RunFormat | null) : null;
        // A paragraph with text takes its height from its runs: its own line box (the
        // strut) is a 1px font's, which always sits inside theirs. An empty one takes its
        // height from its stored format, like the layout engine. (A zero-size strut,
        // font-size or line-height 0, breaks the browser's caret moves to line start/end.)
        let style = empty ? `font-size:calc(var(--s) * ${empty.size}px);font-family:${cssFamilyHook.family(empty.font)}` : '';
        // A list item: indented like the layout engine (its marker is drawn by the box underneath).
        const list = node.attrs.list as ListKind | null;
        const level = node.attrs.level as number;
        if (list) style += `;padding-left:calc(var(--s) * ${(level + 1) * LIST_INDENT_EM * firstRunSize(node)}px)`;
        return [
          'p',
          { style, ...(node.attrs.empty ? { 'data-empty': JSON.stringify(node.attrs.empty) } : {}), ...(list ? { 'data-list': list, 'data-level': String(level) } : {}) },
          0,
        ];
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
      return schema.node(
        'paragraph',
        { empty: runs.length ? null : emptyFormat, list: p.list ?? null, level: p.list ? listLevel(p) : 0 },
        runs.map(({ text, ...f }) => schema.text(text, marksFor(f))),
      );
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
      para = {
        runs: runs.length ? runs : [{ ...((p.attrs.empty as RunFormat | null) ?? fallback), text: '' }],
        ...(p.attrs.list ? { list: p.attrs.list as ListKind, ...(p.attrs.level ? { level: p.attrs.level as number } : {}) } : {}),
      };
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
  // Into an empty paragraph (or an empty box): "- item" and "1. item" lines become list items.
  const { empty, $from } = state.selection;
  const items = empty && $from.parent.content.size === 0 ? listLinesOf(text) : null;
  if (items) {
    const nodes = items.map((l) =>
      schema.node('paragraph', { empty: l.text ? null : plain, list: l.list ?? null, level: l.level ?? 0 }, l.text ? [schema.text(l.text, marksFor(plain))] : []),
    );
    const tr = state.tr.replaceWith($from.before(), $from.after(), nodes);
    return tr.setSelection(TextSelection.near(tr.doc.resolve($from.before() + nodes.reduce((n, x) => n + x.nodeSize, 0) - 1), -1)).scrollIntoView();
  }
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
    tr.setSelection(TextSelection.near(tr.doc.resolve(to), -1));
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

// --- Lists -------------------------------------------------------------------------------------

/** The paragraphs the selection touches (the caret's for a caret), with their positions. */
export function touchedParagraphs(state: EditorState): { node: Node; pos: number }[] {
  const { from, to, $from } = state.selection;
  const out: { node: Node; pos: number }[] = [];
  // A caret between paragraphs (at the document's level) touches none.
  if (from === to) return $from.parent.isTextblock ? [{ node: $from.parent, pos: $from.before() }] : [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph') out.push({ node, pos });
    return false;
  });
  return out;
}

const listFieldsOf = (node: Node): ListFields => (node.attrs.list ? { list: node.attrs.list, level: node.attrs.level } : {});

/** Apply a list action (list-commands.ts) to the paragraphs the selection touches. */
export function listCommand(action: ListAction, only?: { node: Node; pos: number }[]): Command {
  return (state, dispatch) => {
    const ps = only ?? touchedParagraphs(state);
    const next = applyListAction(ps.map((p) => listFieldsOf(p.node)), action);
    const tr = state.tr;
    ps.forEach((p, i) => {
      const f = next[i];
      if ((f.list ?? null) === (p.node.attrs.list ?? null) && (f.level ?? 0) === (p.node.attrs.level ?? 0)) return;
      tr.setNodeMarkup(p.pos, undefined, { ...p.node.attrs, list: f.list ?? null, level: f.list ? (f.level ?? 0) : 0 });
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr);
    return true;
  };
}

/** The caret is in a list item (where Tab and Shift+Tab change its level, within the limits). */
export function caretListItem(state: EditorState): { list: ListKind; level: number } | null {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.attrs.list) return null;
  return { list: $from.parent.attrs.list as ListKind, level: $from.parent.attrs.level as number };
}

/** Backspace at the very start of a list item: take it out of the list one step first (then it merges as usual). */
export const listBackspace: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  if (!empty || $from.parentOffset !== 0 || !$from.parent.attrs.list) return false;
  return listCommand({ type: 'step-out' }, [{ node: $from.parent, pos: $from.before() }])(state, dispatch);
};

/**
 * "- ", "* " or "1. " typed at the start of an empty paragraph: what it turns
 * into (the characters to remove and the list kind), or null.
 */
export function autoListBefore(state: EditorState, pos: number): { from: number; to: number; kind: ListKind } | null {
  const $pos = state.doc.resolve(pos);
  const para = $pos.parent;
  if (para.attrs.list || $pos.parentOffset !== para.content.size) return null;
  const text = para.textContent;
  const kind: ListKind | null = text === '-' || text === '*' ? 'bullet' : text === '1.' ? 'number' : null;
  return kind ? { from: $pos.start(), to: $pos.start() + text.length, kind } : null;
}

/** Every paragraph's list fields, in order. */
export function paragraphFields(doc: Node): ListFields[] {
  const out: ListFields[] = [];
  doc.forEach((p) => out.push(listFieldsOf(p)));
  return out;
}
