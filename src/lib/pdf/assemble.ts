// Builds output PDFs from a page plan using pdf-lib. Runs in a Web Worker in
// the app and directly in Node for tests, so it must not touch the DOM.
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  type PDFObject,
} from '@cantoo/pdf-lib';

export interface SourceInput {
  id: string;
  bytes: Uint8Array;
  password?: string;
}

export interface PagePlan {
  sourceId: string;
  /** 0-based page index in the source. */
  index: number;
  /** Extra rotation in degrees, added to the page's own rotation. */
  rotation: number;
  /** Margins (points, PDF user space) to trim from the page's current crop box. */
  crop?: { top: number; right: number; bottom: number; left: number };
}

/**
 * - `preserve`: edit the first page's source in place, so document-level data
 *   (metadata, bookmarks, form fields, page labels) survives. Used for Save.
 * - `fresh`: a new document containing only the listed pages. Used for
 *   extract and split, where the output is a new file.
 */
export type AssembleMode = 'preserve' | 'fresh';

export class SourceOpenError extends Error {}

export async function assemble(
  sources: readonly SourceInput[],
  plan: readonly PagePlan[],
  mode: AssembleMode,
): Promise<Uint8Array> {
  if (plan.length === 0) throw new Error('A PDF needs at least one page.');
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cache = new Map<string, Promise<PDFDocument>>();
  const open = (id: string) => {
    let doc = cache.get(id);
    if (!doc) {
      const src = byId.get(id);
      if (!src) throw new Error(`Unknown source ${id}`);
      doc = openSource(src);
      cache.set(id, doc);
    }
    return doc;
  };

  const out = mode === 'preserve' ? await open(plan[0].sourceId) : await PDFDocument.create({ updateMetadata: false });
  const baseId = mode === 'preserve' ? plan[0].sourceId : null;

  // Pages of the base document that we reuse directly (each at most once).
  const basePages = baseId ? out.getPages() : [];
  if (baseId) basePages.forEach((p) => materializeInherited(p.node));
  const usedBase = new Set<number>();

  // Everything else is copied in, batched per source.
  const slots: (PDFPage | null)[] = plan.map((item) => {
    if (item.sourceId === baseId && !usedBase.has(item.index)) {
      usedBase.add(item.index);
      return basePages[item.index] ?? null;
    }
    return null;
  });
  const wanted = new Map<string, number[]>(); // sourceId -> plan positions
  plan.forEach((item, pos) => {
    if (slots[pos]) return;
    const list = wanted.get(item.sourceId) ?? [];
    list.push(pos);
    wanted.set(item.sourceId, list);
  });
  for (const [sourceId, positions] of wanted) {
    const src = await open(sourceId);
    const copied = await out.copyPages(
      src,
      positions.map((pos) => plan[pos].index),
    );
    positions.forEach((pos, k) => (slots[pos] = copied[k]));
  }

  const finalPages = slots.map((p, pos) => {
    if (!p) throw new Error(`Page ${plan[pos].index + 1} not found in its file.`);
    return p;
  });

  for (let pos = 0; pos < plan.length; pos++) {
    const { rotation: extra, crop } = plan[pos];
    const page = finalPages[pos];
    if (extra % 360 !== 0) {
      page.setRotation(degrees((((page.getRotation().angle + extra) % 360) + 360) % 360));
    }
    if (crop) {
      const box = page.getCropBox();
      const width = Math.max(1, box.width - crop.left - crop.right);
      const height = Math.max(1, box.height - crop.top - crop.bottom);
      page.setCropBox(box.x + crop.left, box.y + crop.bottom, width, height);
    }
  }

  if (baseId) {
    rebuildPageTree(out, finalPages);
    scrubRemovedPages(out, basePages, usedBase);
    pruneFormFields(out, finalPages);
    collectGarbage(out);
  } else {
    for (const p of finalPages) out.addPage(p);
  }

  // Don't regenerate form field appearances: keep them exactly as the file had them.
  return out.save({ useObjectStreams: true, updateFieldAppearances: false });
}

async function openSource(src: SourceInput): Promise<PDFDocument> {
  const options = { updateMetadata: false, password: src.password };
  try {
    return await PDFDocument.load(src.bytes, options);
  } catch (e) {
    // Files with only an owner password (restrictions, no open password)
    // decrypt with the empty user password.
    if (src.password === undefined) {
      try {
        return await PDFDocument.load(src.bytes, { ...options, password: '' });
      } catch {
        // Fall through to the original error.
      }
    }
    throw new SourceOpenError(e instanceof Error ? e.message : String(e));
  }
}

/** Copy inherited attributes onto the page so it can move to another parent safely. */
function materializeInherited(leaf: PDFPageLeaf) {
  for (const key of PDFPageLeaf.InheritableEntries) {
    const name = PDFName.of(key);
    if (leaf.get(name) !== undefined) continue;
    const value = leaf.getInheritableAttribute(name);
    if (value !== undefined) leaf.set(name, value);
  }
}

/**
 * Replace the page tree with one flat list in the final order. (pdf-lib's
 * removePage deletes the page object, so pages can't be removed and re-added.)
 * Old intermediate nodes become unreachable and are garbage collected.
 */
function rebuildPageTree(doc: PDFDocument, pages: PDFPage[]) {
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const root = doc.catalog.Pages();
  // Leaves carry their own inherited values now (base pages were materialized,
  // copied pages get them from the copier), so the root must not add any.
  for (const key of PDFPageLeaf.InheritableEntries) root.delete(PDFName.of(key));
  root.set(PDFName.of('Kids'), doc.context.obj(pages.map((p) => p.ref)));
  root.set(PDFName.of('Count'), doc.context.obj(pages.length));
  for (const p of pages) p.node.set(PDFName.of('Parent'), rootRef!);
}

/**
 * Deleted pages may still be referenced (bookmarks, form fields, structure
 * tree). Replace each with an empty dictionary so their content becomes
 * unreachable and is dropped, rather than lingering hidden in the file.
 */
function scrubRemovedPages(doc: PDFDocument, basePages: PDFPage[], used: Set<number>) {
  basePages.forEach((page, i) => {
    if (!used.has(i)) doc.context.assign(page.ref, doc.context.obj({}));
  });
}

/** Drop form fields whose widgets were all on deleted pages. */
function pruneFormFields(doc: PDFDocument, pages: PDFPage[]) {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!acroForm || !fields) return;

  const onPage = new Set<string>();
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.get(i);
      if (a instanceof PDFRef) onPage.add(a.toString());
    }
  }

  const keep = (obj: PDFObject): boolean => {
    if (!(obj instanceof PDFRef)) return true;
    const dict = doc.context.lookup(obj);
    if (!(dict instanceof PDFDict)) return false;
    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids && kids.size() > 0) {
      const kept = kids.asArray().filter(keep);
      if (kept.length === 0) return false;
      if (kept.length !== kids.size()) dict.set(PDFName.of('Kids'), doc.context.obj(kept));
      return true;
    }
    return onPage.has(obj.toString());
  };

  const kept = fields.asArray().filter(keep);
  if (kept.length !== fields.size()) acroForm.set(PDFName.of('Fields'), doc.context.obj(kept));
}

/** pdf-lib writes every object it holds, reachable or not. Remove the unreachable ones. */
function collectGarbage(doc: PDFDocument) {
  const { context } = doc;
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const o of [Root, Info, Encrypt]) if (o) stack.push(o);

  while (stack.length) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) stack.push(v);
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) context.delete(ref);
  }
}
