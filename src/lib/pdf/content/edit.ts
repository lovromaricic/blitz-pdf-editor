// Editing a page's original content: what's on it (text blocks and images, as
// plain data for the editor) and deleting some of it for real. Deleting
// removes the operations from the content (text becomes a same-length move,
// so nothing else shifts) and the hidden copies of what was deleted: the
// /ActualText and /Alt of its marked content, its structure-tree elements,
// links over it, the page thumbnail and the XMP metadata. Images and fonts
// nothing uses any more are dropped when the file is written (garbage
// collection), and the file is always written whole, so earlier revisions go.
// Works on pdf-lib documents, in the content worker (and in tests).
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, type PDFDocument, type PDFObject, type PDFPage } from '@cantoo/pdf-lib';
import { interpretPage, pageContentBytes, streamData, type ImageItem, type MarkedContent, type OpRef, type PageContent, type Quad, type TextRun } from './interpret';
import { groupBlocks } from './blocks';
import { isDict, isName, writeOperand, type Op } from './lexer';
import { rewriteStream, textRemoval } from './rewrite';
import { fontLabel } from './fonts';

export interface ContentItem {
  /** Stable for this version of the file and page. */
  id: string;
  kind: 'text' | 'image';
  /** In PDF user space (unrotated), as drawn. */
  quad: Quad;
  /** Reading order (text first by its order, images after in drawing order). */
  order: number;
  /** Text blocks. */
  text?: string;
  font?: string;
  size?: number;
  color?: [number, number, number] | null;
  lines?: number;
  angle?: number;
  /** Images: pixel size. */
  width?: number;
  height?: number;
  /** The image covers (nearly) the whole page. */
  coversPage?: boolean;
  /** Why it can't be deleted cleanly (shown to the user), or undefined. */
  blocked?: string;
}

export interface PageAnalysis {
  /** 'unreadable': the content couldn't be analyzed; nothing is offered. */
  status: 'ok' | 'unreadable';
  items: ContentItem[];
  /** One image covering the page and no visible text. */
  scan: boolean;
}

export const BLOCKED = {
  repeated: 'This is part of a repeated element (drawn more than once) and can’t be deleted on its own.',
  nested: 'This content is nested too deeply in the page to be deleted cleanly.',
  vertical: 'Vertical text can’t be deleted cleanly.',
} as const;

interface Model {
  content: PageContent;
  items: ContentItem[];
  /** For each item: the text runs (indexes) or the image it stands for. */
  runs: Map<string, number[]>;
  images: Map<string, ImageItem>;
}

const key = (at: OpRef) => `${at.forms.join('>')}#${at.index}`;
const streamKey = (forms: string[]) => forms.join('/');

function model(doc: PDFDocument, pageIndex: number): Model {
  const page = doc.getPage(pageIndex);
  const content = interpretPage(page);
  const items: ContentItem[] = [];
  const runs = new Map<string, number[]>();
  const images = new Map<string, ImageItem>();
  const { width, height } = page.getSize();
  const box = page.getMediaBox();
  const area = width * height;

  const blockedAt = (at: OpRef): string | undefined => {
    if (at.forms.length > 1) return BLOCKED.nested;
    if (at.forms.length === 1 && (content.forms.get(at.forms[0]) ?? 0) > 1) return BLOCKED.repeated;
    return undefined;
  };

  const blocks = groupBlocks(content);
  for (const b of blocks) {
    const id = `t${key(content.text[b.runs[0]].at)}`;
    const reasons = b.runs.map((i) => content.text[i]).map((r) => (r.font.vertical ? BLOCKED.vertical : blockedAt(r.at))).filter(Boolean);
    const first = content.text[b.runs[0]];
    items.push({
      id,
      kind: 'text',
      quad: b.quad,
      order: b.order,
      text: b.text,
      font: fontLabel(first.font.name === b.font ? first.font : (content.text.find((r) => r.font.name === b.font)?.font ?? first.font)),
      size: Math.round(b.size * 10) / 10,
      color: b.color,
      lines: b.lines.length,
      angle: b.angle,
      blocked: reasons[0],
    });
    runs.set(id, b.runs);
  }
  content.images.forEach((im, k) => {
    const id = `i${key(im.at)}`;
    const xs = im.quad.map((p) => p[0]);
    const ys = im.quad.map((p) => p[1]);
    const w = Math.min(Math.max(...xs), box.x + box.width) - Math.max(Math.min(...xs), box.x);
    const h = Math.min(Math.max(...ys), box.y + box.height) - Math.max(Math.min(...ys), box.y);
    items.push({
      id,
      kind: 'image',
      quad: im.quad,
      order: blocks.length + k,
      width: im.width,
      height: im.height,
      coversPage: w > 0 && h > 0 && (w * h) / area > 0.9,
      blocked: blockedAt(im.at),
    });
    images.set(id, im);
  });
  return { content, items, runs, images };
}

export function analyzePage(doc: PDFDocument, pageIndex: number): PageAnalysis {
  const m = model(doc, pageIndex);
  if (m.content.problems.some((p) => p.startsWith('content can'))) return { status: 'unreadable', items: [], scan: false };
  const visibleText = m.items.some((i) => i.kind === 'text');
  const scan = !visibleText && m.items.filter((i) => i.kind === 'image').length === 1 && !!m.items.find((i) => i.kind === 'image')?.coversPage;
  return { status: 'ok', items: m.items, scan };
}

export class ContentEditError extends Error {}

export interface DeleteResult {
  textBlocks: number;
  images: number;
  /** The XMP metadata was removed (it can repeat deleted text). */
  removedMetadata: boolean;
}

/**
 * Delete items (ids from analyzePage of this same document state). Changes
 * `doc`; save it afterwards (a full rewrite) and collect garbage first.
 */
export function deleteItems(doc: PDFDocument, pageIndex: number, ids: readonly string[]): DeleteResult {
  const m = model(doc, pageIndex);
  if (m.content.problems.some((p) => p.startsWith('content can'))) throw new ContentEditError('This page’s content can’t be edited.');
  const page = doc.getPage(pageIndex);
  const ctx = doc.context;
  const chosen = ids.map((id) => {
    const item = m.items.find((i) => i.id === id);
    if (!item) throw new ContentEditError('The content changed. Try again.');
    if (item.blocked) throw new ContentEditError(item.blocked);
    return item;
  });

  // Operations to replace, per stream ("" is the page's own content).
  const edits = new Map<string, Map<number, string>>();
  const editIn = (at: OpRef, text: string) => {
    const k = streamKey(at.forms);
    if (!edits.has(k)) edits.set(k, new Map());
    edits.get(k)!.set(at.index, text);
  };
  const removedRuns: TextRun[] = [];
  const removedImages: ImageItem[] = [];
  for (const item of chosen) {
    if (item.kind === 'text') {
      for (const i of m.runs.get(item.id)!) {
        const run = m.content.text[i];
        const ops = m.content.streams.get(streamKey(run.at.forms))!;
        editIn(run.at, textRemoval(ops[run.at.index], run));
        removedRuns.push(run);
      }
    } else {
      const im = m.images.get(item.id)!;
      editIn(im.at, '');
      removedImages.push(im);
      // A scan goes with the invisible text (OCR) drawn over it.
      if (item.coversPage) {
        for (const run of m.content.text) {
          if (!run.invisible || run.at.forms.length > 1) continue;
          const ops = m.content.streams.get(streamKey(run.at.forms))!;
          editIn(run.at, textRemoval(ops[run.at.index], run));
          removedRuns.push(run);
        }
      }
    }
  }

  // Marked content of what was deleted: its BDC loses /ActualText, /Alt and /E.
  const removedOps = new Set([...removedRuns, ...removedImages].map((x) => key(x.at)));
  const marks = new Map<string, MarkedContent>();
  for (const x of [...removedRuns, ...removedImages]) for (const mc of x.marked) marks.set(key(mc.at), mc);
  const resources = ownResources(page);
  for (const mc of marks.values()) {
    const ops = m.content.streams.get(streamKey(mc.at.forms))!;
    const op = ops[mc.at.index];
    if (op.op !== 'BDC') continue;
    const props = op.operands[1];
    if (isDict(props)) {
      const kept = new Map([...props.dict].filter(([k]) => !HIDDEN_KEYS.includes(k)));
      if (kept.size !== props.dict.size) editIn(mc.at, `${writeOperand(op.operands[0])} ${writeOperand({ dict: kept })} BDC`);
    } else if (isName(props) && mc.at.forms.length === 0) {
      const named = resources.lookup(PDFName.of('Properties'));
      const d = named instanceof PDFDict ? named.lookup(PDFName.of(props.name)) : undefined;
      if (d instanceof PDFDict) for (const k of HIDDEN_KEYS) d.delete(PDFName.of(k));
    }
  }
  const fullyRemoved = fullyRemovedMcids(m.content, removedOps);

  // Rewrite the streams: the page's own (one new stream), forms (copied for this page).
  for (const [k, map] of edits) {
    if (k === '') {
      const bytes = rewriteStream(pageContentBytes(page), m.content.streams.get('')!, map);
      page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(bytes)));
    } else {
      replaceForm(doc, page, resources, m.content, k, map);
    }
  }

  pruneStructure(doc, page, fullyRemoved);
  removeLinks(page, [...chosen.map((c) => c.quad)]);
  page.node.delete(PDFName.of('Thumb'));
  pruneResources(page, resources);
  const removedMetadata = doc.catalog.has(PDFName.of('Metadata'));
  doc.catalog.delete(PDFName.of('Metadata'));

  return { textBlocks: chosen.filter((c) => c.kind === 'text').length, images: chosen.filter((c) => c.kind === 'image').length, removedMetadata };
}

const HIDDEN_KEYS = ['ActualText', 'Alt', 'E'];

/** The page's resources as its own dictionary (a copy when shared or inherited), so changing them touches no other page. */
function ownResources(page: PDFPage): PDFDict {
  const ctx = page.node.context;
  let res: PDFObject | undefined = page.node.get(PDFName.of('Resources'));
  if (res instanceof PDFRef) res = ctx.lookup(res);
  if (!(res instanceof PDFDict)) {
    // Inherited from the page tree.
    let node: PDFDict | undefined = page.node;
    while (node && !(res instanceof PDFDict)) {
      const parent: PDFObject | undefined = node.lookup(PDFName.of('Parent'));
      node = parent instanceof PDFDict ? parent : undefined;
      res = node?.lookup(PDFName.of('Resources'));
    }
  }
  const copy = res instanceof PDFDict ? res.clone(ctx) : ctx.obj({});
  for (const sub of ['XObject', 'Font', 'Properties']) {
    const d = copy.lookup(PDFName.of(sub));
    if (d instanceof PDFDict) copy.set(PDFName.of(sub), d.clone(ctx));
  }
  page.node.set(PDFName.of('Resources'), copy);
  return copy;
}

/** A form XObject drawn once on this page: replaced by an edited copy (other pages keep the original). */
function replaceForm(doc: PDFDocument, page: PDFPage, resources: PDFDict, content: PageContent, formKey: string, map: Map<number, string>) {
  const ctx = doc.context;
  const xo = resources.lookup(PDFName.of('XObject'));
  if (!(xo instanceof PDFDict)) throw new ContentEditError(BLOCKED.nested);
  const name = [...xo.entries()].find(([, v]) => v instanceof PDFRef && v.toString() === formKey)?.[0];
  const form = ctx.lookup(PDFRef.of(Number(formKey.split(' ')[0]), Number(formKey.split(' ')[1])));
  if (!name || !(form instanceof PDFStream)) throw new ContentEditError(BLOCKED.nested);
  const bytes = rewriteStream(streamData(form), content.streams.get(formKey)!, map);
  const copy = ctx.flateStream(bytes);
  for (const [k, v] of form.dict.entries()) if (!['Filter', 'DecodeParms', 'Length', 'DL'].includes(k.decodeText())) copy.dict.set(k, v);
  // Form-level marked content isn't in the page's structure tree: drop its link.
  copy.dict.delete(PDFName.of('StructParents'));
  xo.set(name, ctx.register(copy));
}

/** MCIDs (page content only) all of whose text and images were removed. */
function fullyRemovedMcids(content: PageContent, removed: Set<string>) {
  const total = new Map<number, number>();
  const gone = new Map<number, number>();
  for (const x of [...content.text, ...content.images]) {
    if (x.at.forms.length) continue;
    for (const mc of x.marked) {
      if (mc.mcid === undefined || mc.at.forms.length) continue;
      total.set(mc.mcid, (total.get(mc.mcid) ?? 0) + 1);
      if (removed.has(key(x.at))) gone.set(mc.mcid, (gone.get(mc.mcid) ?? 0) + 1);
    }
  }
  const partly = new Set([...gone.keys()].filter((id) => gone.get(id)! < total.get(id)!));
  return { full: new Set([...gone.keys()].filter((id) => !partly.has(id))), partly };
}

/** Structure elements of deleted content: gone (with their /Alt, /ActualText, /E); partly deleted ones lose those texts. */
function pruneStructure(doc: PDFDocument, page: PDFPage, ids: { full: Set<number>; partly: Set<number> }) {
  if (!ids.full.size && !ids.partly.size) return;
  const ctx = doc.context;
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'));
  const sp = page.node.lookup(PDFName.of('StructParents'));
  if (!(root instanceof PDFDict) || !(sp instanceof PDFNumber)) return;
  const tree = root.lookup(PDFName.of('ParentTree'));
  const slot = tree instanceof PDFDict ? numberTreeGet(tree, sp.asNumber()) : undefined;
  const arr = slot instanceof PDFRef ? ctx.lookup(slot) : slot;
  if (!(arr instanceof PDFArray)) return;
  for (const mcid of [...ids.full, ...ids.partly]) {
    const elRef = arr.get(mcid);
    const el = elRef instanceof PDFRef ? ctx.lookup(elRef) : elRef;
    if (!(el instanceof PDFDict)) continue;
    for (const k of [...HIDDEN_KEYS, 'T']) el.delete(PDFName.of(k));
    if (!ids.full.has(mcid)) continue;
    // Take the MCID out of the element's kids.
    const kids = el.lookup(PDFName.of('K'));
    const isThis = (k: PDFObject | undefined) => {
      const v = k instanceof PDFRef ? ctx.lookup(k) : k;
      if (v instanceof PDFNumber) return v.asNumber() === mcid;
      if (v instanceof PDFDict) return (v.lookup(PDFName.of('MCID')) as PDFNumber | undefined)?.asNumber?.() === mcid;
      return false;
    };
    let empty = false;
    if (kids instanceof PDFArray) {
      const kept = kids.asArray().filter((k) => !isThis(k));
      el.set(PDFName.of('K'), ctx.obj(kept));
      empty = kept.length === 0;
    } else if (isThis(kids)) {
      el.delete(PDFName.of('K'));
      empty = true;
    }
    arr.set(mcid, ctx.obj(null));
    if (empty && elRef instanceof PDFRef) {
      // Out of its parent too.
      const parent = el.lookup(PDFName.of('P'));
      if (parent instanceof PDFDict) {
        const pk = parent.lookup(PDFName.of('K'));
        if (pk instanceof PDFArray) parent.set(PDFName.of('K'), ctx.obj(pk.asArray().filter((k) => !(k instanceof PDFRef && k.toString() === elRef.toString()))));
        else if (pk instanceof PDFDict && parent.get(PDFName.of('K'))?.toString() === elRef.toString()) parent.delete(PDFName.of('K'));
      }
    }
  }
}

function numberTreeGet(node: PDFDict, n: number, depth = 0): PDFObject | undefined {
  if (depth > 32) return undefined;
  const nums = node.lookup(PDFName.of('Nums'));
  if (nums instanceof PDFArray) {
    for (let i = 0; i + 1 < nums.size(); i += 2) if ((nums.lookup(i) as PDFNumber).asNumber?.() === n) return nums.get(i + 1);
  }
  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (!(kid instanceof PDFDict)) continue;
      const lim = kid.lookup(PDFName.of('Limits'));
      if (lim instanceof PDFArray) {
        const lo = (lim.lookup(0) as PDFNumber).asNumber();
        const hi = (lim.lookup(1) as PDFNumber).asNumber();
        if (n < lo || n > hi) continue;
      }
      const v = numberTreeGet(kid, n, depth + 1);
      if (v) return v;
    }
  }
  return undefined;
}

/** Link annotations lying (mostly) over deleted content go with it. */
function removeLinks(page: PDFPage, quads: Quad[]) {
  const annots = page.node.Annots();
  if (!annots || !quads.length) return;
  const boxes = quads.map((q) => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))]);
  const ctx = page.node.context;
  const kept = annots.asArray().filter((ref) => {
    const a = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
    if (!(a instanceof PDFDict) || a.lookup(PDFName.of('Subtype'))?.toString() !== '/Link') return true;
    const r = a.lookup(PDFName.of('Rect'));
    if (!(r instanceof PDFArray)) return true;
    const [x0, y0, x1, y1] = r.asArray().map((v) => (v as PDFNumber).asNumber?.() ?? 0);
    const area = Math.abs((x1 - x0) * (y1 - y0)) || 1;
    const covered = boxes.reduce((n, b) => n + Math.max(0, Math.min(Math.max(x0, x1), b[2]) - Math.max(Math.min(x0, x1), b[0])) * Math.max(0, Math.min(Math.max(y0, y1), b[3]) - Math.max(Math.min(y0, y1), b[1])), 0);
    return covered / area < 0.8;
  });
  if (kept.length !== annots.size()) page.node.set(PDFName.of('Annots'), ctx.obj(kept));
}

/** Fonts and XObjects the page's own content no longer uses leave its resources (and the file, if nothing else uses them). */
function pruneResources(page: PDFPage, resources: PDFDict) {
  // Names used anywhere on the page (forms without their own resources use the page's): keeping too many is harmless.
  const ops = [...interpretPage(page).streams.values()].flat();
  const used = (op: string) => new Set(ops.filter((o: Op) => o.op === op && isName(o.operands[0])).map((o) => (o.operands[0] as { name: string }).name));
  for (const [sub, op] of [['Font', 'Tf'], ['XObject', 'Do']] as const) {
    const d = resources.lookup(PDFName.of(sub));
    if (!(d instanceof PDFDict)) continue;
    const names = used(op);
    for (const k of [...d.keys()]) if (!names.has(k.decodeText())) d.delete(k);
  }
}
