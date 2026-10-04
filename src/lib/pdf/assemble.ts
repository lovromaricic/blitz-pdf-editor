// Builds output PDFs from a page plan using pdf-lib. Runs in a Web Worker in
// the app and directly in Node for tests, so it must not touch the DOM.
import {
  degrees,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
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
import type { Annotation } from '../annotations';
import type { FieldValue } from '../forms';
import type { PageDecoration } from '../decorations';
import { addAnnotations, type FontProvider } from './write-annotations';
import { drawDecoration } from './write-decorations';
import { analyze, recompressImages, type Analysis, type CompressLevel } from './compress';
import { addInvisibleText, type OcrWord } from './ocr-text';

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
  /** Markup added in the editor, written as PDF annotations. */
  annots?: readonly Annotation[];
  /** Watermark and page number for this page. */
  deco?: PageDecoration;
}

export interface Encryption {
  password: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowEditing: boolean;
}

/**
 * - `preserve`: edit the first page's source in place, so document-level data
 *   (metadata, bookmarks, form fields, page labels) survives. Used for Save.
 * - `fresh`: a new document containing only the listed pages. Used for
 *   extract and split, where the output is a new file.
 */
export type AssembleMode = 'preserve' | 'fresh';

export class SourceOpenError extends Error {}

/** An error whose message is written for the person using the app. */
export class UserError extends Error {}

export interface AssembleOptions {
  /** Needed when the plan contains text, stamps or form values that need embedded fonts. */
  fonts?: FontProvider;
  /** Form values the user filled in, per source id. */
  forms?: Record<string, FieldValue[]>;
  /** Source ids whose form fields are flattened into page content. */
  flatten?: string[];
  /** Password-protect the output (AES-256). */
  encrypt?: Encryption;
}

export async function assemble(
  sources: readonly SourceInput[],
  plan: readonly PagePlan[],
  mode: AssembleMode,
  options: AssembleOptions = {},
): Promise<Uint8Array> {
  if (plan.length === 0) throw new UserError('A PDF needs at least one page.');
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cache = new Map<string, Promise<PDFDocument>>();
  const open = (id: string) => {
    let doc = cache.get(id);
    if (!doc) {
      const src = byId.get(id);
      if (!src) throw new Error(`Unknown source ${id}`);
      doc = openSource(src).then(async (d) => {
        await applyForm(d, options.forms?.[id] ?? [], !!options.flatten?.includes(id), options.fonts ?? noFonts);
        return d;
      });
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
    if (!p) throw new UserError(`Page ${plan[pos].index + 1} was not found in its file.`);
    return p;
  });

  for (let pos = 0; pos < plan.length; pos++) {
    const { rotation: extra, crop } = plan[pos];
    const page = finalPages[pos];
    if (extra % 360 !== 0) {
      page.setRotation(degrees((((page.getRotation().angle + extra) % 360) + 360) % 360));
    }
    if (plan[pos].annots?.length) {
      if (!options.fonts && plan[pos].annots!.some((a) => a.type === 'text' || a.type === 'stamp')) {
        throw new UserError('Fonts are required to save text and stamps.');
      }
      await addAnnotations(out, page, plan[pos].annots!, options.fonts ?? noFonts);
    }
    if (crop) {
      const box = page.getCropBox();
      const width = Math.max(1, box.width - crop.left - crop.right);
      const height = Math.max(1, box.height - crop.top - crop.bottom);
      page.setCropBox(box.x + crop.left, box.y + crop.bottom, width, height);
    }
    // After rotation and crop, so placement matches what the user sees.
    if (plan[pos].deco) await drawDecoration(out, page, plan[pos].deco!, options.fonts ?? noFonts);
  }

  if (baseId) {
    rebuildPageTree(out, finalPages);
    scrubRemovedPages(out, basePages, usedBase);
    pruneFormFields(out, finalPages);
    collectGarbage(out);
  } else {
    for (const p of finalPages) out.addPage(p);
  }

  if (options.encrypt) {
    const e = options.encrypt;
    out.encrypt({
      userPassword: e.password,
      // A random owner password: the restrictions can't be lifted by anyone who only knows the open password.
      ownerPassword: randomPassword(),
      permissions: {
        printing: e.allowPrinting ? 'highResolution' : false,
        copying: e.allowCopying,
        modifying: e.allowEditing,
        annotating: e.allowEditing,
        fillingForms: e.allowEditing,
        documentAssembly: e.allowEditing,
        contentAccessibility: true,
      },
    });
  }

  // Don't regenerate form field appearances: keep them exactly as the file had them.
  return out.save({ useObjectStreams: true, updateFieldAppearances: false });
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const noFonts: FontProvider = () => Promise.reject(new Error('No fonts available.'));

// Characters the standard 14 fonts can show (WinAnsiEncoding): Latin-1 plus a few extras.
const WIN_ANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)!));

export function isWinAnsi(text: string) {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const ok = cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
    if (!ok) return false;
  }
  return true;
}

/** Write filled-in values into the form, regenerate their appearance, and optionally flatten. */
async function applyForm(doc: PDFDocument, values: FieldValue[], flatten: boolean, fonts: FontProvider) {
  if (values.length === 0 && !flatten) return;
  const form = doc.getForm();
  for (const v of values) {
    try {
      const field = form.getField(v.name);
      if (field instanceof PDFTextField && typeof v.value === 'string') {
        // Respect a field's maximum length rather than failing the whole save.
        const max = field.getMaxLength();
        field.setText(max !== undefined ? v.value.slice(0, max) : v.value);
      } else if (field instanceof PDFCheckBox) {
        if (v.value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup && typeof v.value === 'string') {
        field.select(v.value);
      } else if ((field instanceof PDFDropdown || field instanceof PDFOptionList) && (typeof v.value === 'string' || Array.isArray(v.value))) {
        field.select(v.value as string);
      }
    } catch {
      // A field we can't write (renamed, unusual type) keeps its old value.
    }
  }
  if (values.length > 0) {
    // Helvetica covers Western European text; anything else (č, ć, đ, Cyrillic…)
    // needs an embedded font. (pdf-lib silently writes "?" for characters Helvetica lacks.)
    const strings = values.flatMap((v) => (typeof v.value === 'string' ? [v.value] : Array.isArray(v.value) ? v.value : []));
    const font = strings.every(isWinAnsi) ? await doc.embedFont(StandardFonts.Helvetica) : await fonts(doc, 'sans');
    form.updateFieldAppearances(font);
  }
  if (flatten) form.flatten({ updateFieldAppearances: false });
}

async function openSource(src: SourceInput): Promise<PDFDocument> {
  const options = { updateMetadata: false, password: src.password };
  // pdf-lib sometimes "loads" a broken file and only fails later: check the basics now.
  const checked = (doc: PDFDocument) => {
    if (doc.getPageCount() < 1) throw new Error('no pages found');
    return doc;
  };
  try {
    return checked(await PDFDocument.load(src.bytes, options));
  } catch (e) {
    // Files with only an owner password (restrictions, no open password)
    // decrypt with the empty user password.
    if (src.password === undefined) {
      try {
        return checked(await PDFDocument.load(src.bytes, { ...options, password: '' }));
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

/** Compress one source file: re-encode images, keep typed form values, drop unused objects. */
export async function compressSource(
  src: SourceInput,
  level: CompressLevel,
  values: FieldValue[],
  fonts: FontProvider,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await openSource(src);
  await applyForm(doc, values, false, fonts);
  await recompressImages(doc, level, onProgress);
  collectGarbage(doc);
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

export async function analyzeSource(src: SourceInput): Promise<Analysis> {
  return analyze(await openSource(src), src.bytes.length);
}

/** Add recognised text (invisible) to pages of one source file. */
export async function addOcrToSource(
  src: SourceInput,
  wordsByPage: Record<number, OcrWord[]>,
  values: FieldValue[],
  fonts: FontProvider,
): Promise<Uint8Array> {
  const doc = await openSource(src);
  await applyForm(doc, values, false, fonts);
  for (const [index, words] of Object.entries(wordsByPage)) await addInvisibleText(doc, Number(index), words, fonts);
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

/** A page to redact: its replacement image (JPEG) and where it goes (the page's visible box). */
export interface RedactedPage {
  /** 0-based page index in the source. */
  index: number;
  jpeg: Uint8Array;
  /** [x0, y0, x1, y1] in PDF user space. */
  box: [number, number, number, number];
}

/** Page entries that can carry content or text of the old page. */
const PAGE_KEYS_TO_DROP = ['Contents', 'Resources', 'Annots', 'Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'B', 'AA', 'Group'];

/**
 * Replace the content of the given pages with images (already blacked out),
 * so nothing that was under the redaction boxes remains in the file: text,
 * images, vector art, annotations, form fields, thumbnails and tagged-text
 * alternates are all removed, and unreachable objects are dropped.
 */
export async function redactSource(
  src: SourceInput,
  pages: readonly RedactedPage[],
  values: FieldValue[],
  fonts: FontProvider,
  removeInfo: boolean,
): Promise<Uint8Array> {
  const doc = await openSource(src);
  await applyForm(doc, values, false, fonts);
  for (const r of pages) {
    const page = doc.getPage(r.index);
    for (const key of PAGE_KEYS_TO_DROP) page.node.delete(PDFName.of(key));
    // Own (empty) resources, so nothing is inherited from the page tree.
    page.node.set(PDFName.of('Resources'), doc.context.obj({}));
    const image = await doc.embedJpg(r.jpeg);
    const [x0, y0, x1, y1] = r.box;
    page.drawImage(image, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  if (pages.length) {
    // Form fields whose widgets were on redacted pages go too.
    pruneFormFields(doc, doc.getPages());
    // The structure tree can hold the original text (ActualText, Alt) of tagged PDFs.
    doc.catalog.delete(PDFName.of('StructTreeRoot'));
    doc.catalog.delete(PDFName.of('MarkInfo'));
  }
  if (removeInfo) {
    doc.catalog.delete(PDFName.of('Metadata'));
    const info = doc.context.trailerInfo.Info;
    if (info) doc.context.assign(info as PDFRef, doc.context.obj({}));
  }
  collectGarbage(doc);
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}
