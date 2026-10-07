// Document actions. Each feature is implemented once here and invoked from
// menus, the thumbnail context menu, keyboard shortcuts and panels alike.
import { getContext, setContext, tick } from 'svelte';
import { bounds, describe, newAnnotationId, rectFromUpright, round, translate, type Annotation, type ImageAnnotation, type Point, type TextAnnotation } from './annotations';
import { baseName, loadFiles, newPageId, type EditorDocument, type PageRef } from './document.svelte';
import { confirmDiscard, promptText, showDialog } from './dialogs.svelte';
import { downloadBytes, downloadZip, pdfFileName } from './download';
import { readPdfFiles, type OpenFile } from './files';
import { askPassword } from './open-files.svelte';
import { deletePages, formatPageRange, insertPages, movePages, rotatePages } from './page-ops';
import { blankPdf } from './pdf/blank';
import { documentText, printDocument } from './print';
import { canvasToBlob, createRasterizer } from './rasterize';
import { addOcrText, analyzeSources, blankPdfInWorker, compressSources, estimateCompression, imagesToPdfInWorker, redactInWorker, writePdf, writePdfs } from './pdf/pdf-writer';
import type { Rect } from './annotations';
import { findMatchRects } from './search.svelte';
import { isMac } from './commands';
import { CONTENT_STRINGS, CROP_STRINGS, FLATTEN_STRINGS, IMAGE_STRINGS, NEW_PDF_STRINGS, OBJECT_STRINGS } from './strings';
import { addImageFile, storedImage, type StoredImage } from './image-store';
import { applyCropView, applyRatio, cropOf, cropPixels, enterCropFor, isFull, isPortrait, ratioValue, sameCrop, swapFrame, viewToCrop, type CropSession, type CropView, type RatioId } from './image-crop';
import { UnsupportedImageError } from './image-prepare';
import { defaultImageSize } from './image-geometry';
import { heicDecodes } from './landing/heic-probe';
import { viewportFor } from './pdf/render';
import { focusLost, focusObject, focusSink, settleFocusAfterRemoval } from './focus';
import { looksDigitallySigned } from './files';
import { friendlyError } from './friendly-error';
import type { ContentItem } from './content-editing.svelte';
import { FAMILY_FOR, FAMILY_LABEL, textBoxFromConversion } from './content-convert';
import { routeAt } from './content-route';
import { screenEnv } from './font-metrics-store.svelte';
import { loadFonts } from './fonts';
import { canMoveUnits, insertAboveUnit, LAYER_LABELS, moveUnits, type LayerMove } from './z-order';
import { fitIntoPage, placeInside } from './page-bounds';
import { copyWithNewIds, describeUnits, GROUP_PREFIX, groupUnits, isGroupId, membersOf, ungroupUnits, unionBounds, unitOf, unitsIn } from './object-selection';
import { styleAvailable } from './text-format';
import { ensureTextFont } from './font-metrics-store.svelte';
import { DEFAULT_TEXT_WIDTH, formatTextBox, layoutText, topLeftForCenter } from './text-layout';
import { dropPageLinks, paragraphsOf, toRich } from './text-rich';
import { applyListAction, canIndent, listActionLabel, sharedList, type ListAction } from './list-commands';

const STYLE_LABELS = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough' } as const;
import { groupMarks, padTextRect } from './redact-marks';
import type { OcrLanguage } from './ocr';
import { isWorthwhile, type CompressSettings } from './pdf/compress';
import type { ImagesToPdfOptions } from './pdf/images-to-pdf';
import { isImageFile, prepareImage } from './image-input';
import { setDocument } from './app-state.svelte';
import { openDocument } from './document.svelte';
import type { AnnotRef, Viewer } from './viewer.svelte';

let blankCounter = 0;

export const DEFAULT_IMAGE_OPTIONS: ImagesToPdfOptions = { pageSize: 'a4', margin: 28 };

/**
 * In-memory clipboard for annotations (never the system clipboard: nothing
 * leaves the tab), with the page it was copied from (or last pasted on).
 */
let annotClipboard: { members: readonly Annotation[]; pageId: string; topUnit: string } | null = null;

/** "page 5" or "pages 1-3,7" for file names. */
function pagesLabel(indexes: readonly number[]) {
  return `${indexes.length === 1 ? 'page' : 'pages'} ${formatPageRange(indexes).replace(/\s/g, '')}`;
}

export class Actions {
  constructor(
    private doc: EditorDocument,
    private viewer: Viewer,
  ) {}

  private ids(pages: readonly PageRef[]) {
    return new Set(pages.map((p) => p.id));
  }

  private plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  // --- Page operations --------------------------------------------------

  rotate(delta: 90 | -90, pages: readonly PageRef[] = this.viewer.targetPages()) {
    if (pages.length === 0) return;
    this.doc.edit(delta > 0 ? 'Rotate right' : 'Rotate left', rotatePages(this.doc.pages, this.ids(pages), delta));
  }

  canDelete(pages: readonly PageRef[] = this.viewer.targetPages()) {
    return pages.length > 0 && pages.length < this.doc.pages.length;
  }

  delete(pages: readonly PageRef[] = this.viewer.targetPages()) {
    if (pages.length === 0) return;
    if (!this.canDelete(pages)) {
      this.viewer.notify("A PDF needs at least one page, so you can't delete every page.");
      return;
    }
    const firstIndex = this.doc.pages.indexOf(pages[0]);
    const gone = this.ids(pages);
    // Links to the deleted pages go too (in the same undo step: undo brings both back).
    let removedLinks = 0;
    const next = deletePages(this.doc.pages, gone).map((p) => {
      if (!p.annots?.some((a) => a.type === 'text' && a.paragraphs)) return p;
      const annots = p.annots.map((a) => {
        if (a.type !== 'text') return a;
        const { annot, removed } = dropPageLinks(a, (id) => gone.has(id));
        removedLinks += removed;
        return annot;
      });
      return annots.some((a, i) => a !== p.annots![i]) ? { ...p, annots } : p;
    });
    this.doc.edit(`Delete ${this.plural(pages.length, 'page')}`, next);
    this.viewer.announce(pages.length === 1 ? 'Page deleted' : `${pages.length} pages deleted`);
    if (removedLinks) {
      this.viewer.notify(`Removed ${removedLinks === 1 ? 'a link' : `${removedLinks} links`} to the deleted ${pages.length === 1 ? 'page' : 'pages'}. Undo brings ${removedLinks === 1 ? 'it' : 'them'} back.`);
    }
    void tick().then(() => settleFocusAfterRemoval());
    this.viewer.clearSelection();
    this.viewer.syncAfterEdit();
    this.viewer.goToPage(Math.min(firstIndex, this.doc.pages.length - 1));
  }

  /** Move pages so they land before the page currently at `targetIndex`. */
  move(pages: readonly PageRef[], targetIndex: number) {
    const next = movePages(this.doc.pages, this.ids(pages), targetIndex);
    if (next === this.doc.pages) return;
    this.doc.edit(pages.length === 1 ? 'Move page' : `Move ${pages.length} pages`, next);
    this.viewer.goToPage(next.indexOf(pages[0]));
  }

  /**
   * A change to the pages (a crop) that may leave objects off a page: those
   * are brought back (shrunk first if bigger than the page), in the same undo
   * step as the change itself. Returns how many objects (or groups) moved.
   */
  editPagesKeepingObjects(label: string, next: readonly PageRef[]) {
    let moved = 0;
    const fixed = next.map((p) => {
      if (!p.annots?.length) return p;
      const page = this.doc.pageBounds(p);
      let changed = false;
      const annots = unitsIn(p.annots).flatMap((u) => {
        const r = fitIntoPage(membersOf(p.annots!, [u]), page);
        if (r.changed) {
          moved++;
          changed = true;
        }
        return r.members;
      });
      return changed ? { ...p, annots } : p;
    });
    this.doc.edit(label, fixed);
    if (moved) this.viewer.notify(OBJECT_STRINGS.movedBack(moved));
    return moved;
  }

  /** Index just after the last target page (where inserted pages go). */
  private insertionIndex() {
    const targets = this.viewer.targetPages();
    const last = targets.at(-1);
    return last ? this.doc.pages.indexOf(last) + 1 : this.doc.pages.length;
  }

  async insertBlank(at = this.insertionIndex()) {
    // Match the size and orientation of the page before it.
    const neighbour = this.doc.pages[Math.max(0, at - 1)];
    const size = neighbour ? this.doc.displaySize(neighbour) : { width: 612, height: 792 };
    const bytes = blankPdf(size.width, size.height);
    const file: OpenFile = { id: `blank-${++blankCounter}`, name: 'Blank page', size: bytes.length, bytes };
    const [page] = await this.doc.addSource(file, askPassword, 'blank');
    this.doc.edit('Insert blank page', insertPages(this.doc.pages, at, [page]));
    this.viewer.goToPage(at);
  }

  async insertFromFiles(files: File[], at = this.insertionIndex()) {
    const images = files.filter((f) => isImageFile(f) && !/\.pdf$/i.test(f.name));
    if (images.length && images.length === files.length) return this.insertImages(images, DEFAULT_IMAGE_OPTIONS, at);
    if (images.length) this.viewer.notify('Images and PDFs were mixed: only the PDFs were added. Add the images separately.');
    files = files.filter((f) => !images.includes(f));
    await this.viewer.runTask('Adding pages…', async () => {
      const intake = await readPdfFiles(files);
      const { pages, rejected } = await loadFiles(this.doc, intake.accepted, askPassword);
      const problems = [...intake.rejected, ...rejected];
      if (problems.length) this.viewer.notify(`Not added: ${problems.map((r) => `${r.name} (${r.reason})`).join('; ')}`);
      if (pages.length === 0) return;
      this.doc.edit(`Insert ${this.plural(pages.length, 'page')}`, insertPages(this.doc.pages, at, pages));
      this.viewer.goToPage(at);
    });
  }

  /** Load files so they can be listed (e.g. in the Merge panel) before their pages are used. */
  async loadForMerge(files: File[]) {
    return this.viewer.runTask('Reading files…', async () => {
      const intake = await readPdfFiles(files);
      const result = await loadFiles(this.doc, intake.accepted, askPassword);
      const problems = [...intake.rejected, ...result.rejected];
      if (problems.length) this.viewer.notify(`Not added: ${problems.map((r) => `${r.name} (${r.reason})`).join('; ')}`);
      // Group the loaded pages back by file.
      const byFile = new Map<string, PageRef[]>();
      for (const p of result.pages) byFile.set(p.sourceId, [...(byFile.get(p.sourceId) ?? []), p]);
      return [...byFile.entries()].map(([sourceId, pages]) => ({
        sourceId,
        name: this.doc.sources.get(sourceId)!.name,
        pages,
      }));
    });
  }

  /** Replace the document's pages with the merged sequence (undoable). */
  merge(parts: { name: string; pages: readonly PageRef[] }[]) {
    // Fresh ids so the same file can appear twice.
    const pages = parts.flatMap((part) => part.pages.map((p) => ({ ...p, id: newPageId() })));
    if (pages.length === 0) return;
    this.doc.edit(`Merge ${this.plural(parts.length, 'file')}`, pages);
    this.doc.name = parts.length === 1 ? parts[0].name : `${parts[0].name} + ${parts.length - 1} more`;
    if (parts.length > 1) this.doc.fileName = `${baseName(parts[0].name)}-merged.pdf`;
    this.viewer.clearSelection();
    this.viewer.syncAfterEdit();
    this.viewer.goToPage(0);
    this.viewer.notify(`Merged ${this.plural(parts.length, 'file')} into ${this.plural(pages.length, 'page')}.`);
  }

  // --- Output -----------------------------------------------------------

  private passwordNote() {
    if (this.doc.settings.protection) return ' It is protected with a password.';
    return this.doc.hasPasswordSources ? ' It is not password-protected.' : '';
  }

  async save(fileName = this.doc.fileName, markSaved = true): Promise<boolean> {
    // A flattened form is never saved under the original name: offer a "-flattened" copy.
    if (this.doc.pages.some((p) => p.flattenForm) && fileName === this.doc.fileName && fileName !== this.flattenedFileName()) {
      return this.saveFlattenedCopy();
    }
    if (!(await this.checkPendingRedactions())) return false;
    const notes: string[] = [];
    const bytes = await this.viewer.runTask('Saving…', () => writePdf(this.doc, this.doc.pages, 'preserve', (t) => notes.push(t)));
    if (!bytes) return false;
    downloadBytes(bytes, fileName);
    if (markSaved) this.doc.markSaved();
    this.viewer.notify([`Saved ${fileName} to your downloads.${this.passwordNote()}`, ...notes].join(' '));
    return true;
  }

  /** Save the flattened form as a new copy (the normal Save a copy flow, with the suggested name). */
  private async saveFlattenedCopy(): Promise<boolean> {
    const suggested = this.flattenedFileName();
    const name = await promptText('Save a copy', 'File name', suggested, 'Save');
    if (name === null) return false;
    const fileName = pdfFileName(name, suggested);
    // From now on this document is the copy: further saves keep its name.
    const saved = await this.save(fileName, true);
    if (saved) this.doc.fileName = fileName;
    return saved;
  }

  async saveCopy() {
    const suggested = `${baseName(this.doc.fileName)} (copy).pdf`;
    const name = await promptText('Save a copy', 'File name', suggested, 'Save');
    if (name === null) return false;
    return this.save(pdfFileName(name, suggested), false);
  }

  /**
   * Before replacing the document with a new one: if it has unsaved changes,
   * offer to save a copy first. Returns false if the user cancels (or cancels
   * saving the copy).
   */
  async confirmReplace(): Promise<boolean> {
    if (!this.doc.dirty) return true;
    const r = await showDialog({
      title: NEW_PDF_STRINGS.unsavedTitle,
      message: NEW_PDF_STRINGS.unsavedMessage,
      buttons: [
        { value: 'cancel', label: NEW_PDF_STRINGS.cancel },
        { value: 'discard', label: NEW_PDF_STRINGS.discard, danger: true },
        { value: 'save', label: NEW_PDF_STRINGS.saveCopy, primary: true },
      ],
      cancelValue: 'cancel',
      initialFocus: 'save',
    });
    if (r.button === 'save') return this.saveCopy();
    return r.button === 'discard';
  }

  /** File › New blank PDF…: empty pages of the chosen size, opened as "Untitled.pdf" (nothing to save yet). */
  async newBlankPdf(width: number, height: number, pages: number) {
    if (!(await this.confirmReplace())) return false;
    const bytes = await this.viewer.runTask(NEW_PDF_STRINGS.creating, () => blankPdfInWorker(width, height, pages));
    if (!bytes) return false;
    const name = NEW_PDF_STRINGS.fileName;
    const { doc } = await openDocument([{ id: `new-${Date.now()}`, name, size: bytes.length, bytes }], async () => null);
    if (!doc) return false;
    doc.openedAnnouncement = NEW_PDF_STRINGS.created(pages);
    doc.startWithMargins = true;
    setDocument(doc);
    return true;
  }

  /** Before closing or replacing the document. Returns false if the user cancels. */
  async confirmLeave(action: string) {
    if (!this.doc.dirty) return true;
    const choice = await confirmDiscard(action);
    if (choice === 'cancel') return false;
    if (choice === 'save') return this.save();
    return true;
  }

  /** Download the given pages as a new PDF; optionally remove them afterwards. */
  async extract(pages: readonly PageRef[], removeAfter: boolean) {
    if (pages.length === 0) return;
    if (removeAfter && !this.canDelete(pages)) {
      this.viewer.notify("Can't remove every page from the document. Untick \"Delete\" or choose fewer pages.");
      return;
    }
    const indexes = pages.map((p) => this.doc.pages.indexOf(p));
    const fileName = `${baseName(this.doc.fileName)} (${pagesLabel(indexes)}).pdf`;
    const bytes = await this.viewer.runTask('Extracting…', () => writePdf(this.doc, pages, 'fresh', (t) => this.viewer.notify(t)));
    if (!bytes) return;
    downloadBytes(bytes, fileName);
    if (removeAfter) this.delete([...pages]);
    this.viewer.notify(`Saved ${fileName} to your downloads.`);
  }

  /** Download one PDF per chunk of page indexes (zipped when more than one). */
  async split(chunks: number[][]) {
    const groups = chunks.filter((c) => c.length > 0).map((c) => c.map((i) => this.doc.pages[i]));
    if (groups.length === 0) return;
    const base = baseName(this.doc.fileName);
    const files = await this.viewer.runTask('Splitting…', (progress) =>
      writePdfs(this.doc, groups, 'fresh', (done, total) => progress(done / total), (t) => this.viewer.notify(t)),
    );
    if (!files) return;
    const named = files.map((bytes, k) => ({
      name: `${base} (${pagesLabel(chunks[k])}).pdf`,
      bytes,
    }));
    if (named.length === 1) downloadBytes(named[0].bytes, named[0].name);
    else downloadZip(named, `${base} (split).zip`);
    this.viewer.notify(`Split into ${this.plural(named.length, 'file')}${named.length > 1 ? ', saved as a .zip' : ''}.`);
  }

  async print() {
    await this.viewer.runTask('Preparing to print…', (progress) => printDocument(this.doc, progress));
  }

  async exportText() {
    const text = await this.viewer.runTask('Extracting text…', (progress) => documentText(this.doc, progress));
    if (text === undefined) return;
    const fileName = `${baseName(this.doc.fileName)}.txt`;
    downloadBytes(new TextEncoder().encode(text), fileName, 'text/plain;charset=utf-8');
    const empty = text.replace(/--- Page \d+ ---/g, '').trim() === '';
    this.viewer.notify(
      empty
        ? `Saved ${fileName}, but no text was found. This looks like a scanned document: use Tools › Make text searchable (OCR) first.`
        : `Saved ${fileName} to your downloads.`,
    );
  }

  /** Save pages as JPG or PNG images (one file, or a .zip for several). */
  async exportImages(pages: readonly PageRef[], format: 'jpg' | 'png', dpi: number, quality: number) {
    if (pages.length === 0) return;
    const base = baseName(this.doc.fileName);
    const files = await this.viewer.runTask('Creating images…', async (progress) => {
      const raster = await createRasterizer(this.doc);
      const out: { name: string; bytes: Uint8Array }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const canvas = await raster.render(pages[i], dpi);
        const blob = await canvasToBlob(canvas, format === 'jpg' ? 'image/jpeg' : 'image/png', quality);
        canvas.width = canvas.height = 0;
        const n = this.doc.pages.indexOf(pages[i]) + 1;
        out.push({ name: `${base}-page-${String(n).padStart(String(this.doc.pages.length).length, '0')}.${format}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        progress((i + 1) / pages.length);
      }
      return out;
    });
    if (!files) return;
    if (files.length === 1) downloadBytes(files[0].bytes, files[0].name, format === 'jpg' ? 'image/jpeg' : 'image/png');
    else downloadZip(files, `${base} (images).zip`);
    this.viewer.notify(`Saved ${this.plural(files.length, 'image')}${files.length > 1 ? ' as a .zip' : ''} to your downloads.`);
  }

  // --- Compress -------------------------------------------------------------

  /** Ids of the files the current pages come from. */
  private usedFileIds() {
    return [...new Set(this.doc.pages.map((p) => p.sourceId))].filter((id) => this.doc.sources.get(id)?.kind === 'file');
  }

  analyzeCompression() {
    return analyzeSources(this.doc, this.usedFileIds());
  }

  /** Estimated sizes for each settings, computed in the worker. */
  estimateCompression(settings: CompressSettings[], onProgress: (p: number) => void, signal: AbortSignal) {
    return estimateCompression(this.doc, this.usedFileIds(), settings, (done, total) => onProgress(done / total), signal);
  }

  /**
   * Compress the document's files (undoable). Returns sizes before and after;
   * `applied` is false when the result wasn't worth it and the document was left unchanged.
   */
  async compress(settings: CompressSettings) {
    const ids = this.usedFileIds();
    const before = ids.reduce((n, id) => n + this.doc.sources.get(id)!.size, 0);
    return this.viewer.runTask(
      'Compressing…',
      async (progress, signal) => {
        const files = await compressSources(this.doc, ids, settings, (done, total) => progress(done / total), signal);
        // Per file, keep the original where compression didn't help.
        const better = ids.map((id, i) => files[i].length < this.doc.sources.get(id)!.size);
        const after = ids.reduce((n, id, i) => n + (better[i] ? files[i].length : this.doc.sources.get(id)!.size), 0);
        if (!isWorthwhile(before, after)) return { before, after, applied: false };
        const remap = new Map<string, string>();
        for (let i = 0; i < ids.length; i++) {
          if (!better[i]) continue;
          const old = this.doc.sources.get(ids[i])!;
          remap.set(old.id, await this.doc.addReplacementSource(old, files[i], 'compressed'));
        }
        this.doc.edit('Compress', this.doc.pages.map((p) => (remap.has(p.sourceId) ? { ...p, sourceId: remap.get(p.sourceId)! } : p)));
        return { before, after, applied: true };
      },
      { cancellable: true },
    );
  }

  // --- OCR ------------------------------------------------------------------

  /** Recognise text on scanned pages and add it as an invisible, searchable layer (undoable). */
  async ocr(pages: readonly PageRef[], languages: OcrLanguage[]) {
    if (pages.length === 0) return;
    const result = await this.viewer.runTask(
      `Recognizing text (${this.plural(pages.length, 'page')})…`,
      async (progress, signal) => {
        const { recognizePages } = await import('./ocr');
        const found = await recognizePages(this.doc, pages, languages, (p) => progress(p * 0.9), signal);
        // Write the words into each affected file, then point pages at the new version.
        const bySource = new Map<string, Record<number, NonNullable<ReturnType<typeof found.get>>>>();
        let words = 0;
        for (const [page, list] of found) {
          if (!list.length) continue;
          words += list.length;
          const entry = bySource.get(page.sourceId) ?? {};
          entry[page.sourceIndex] = list;
          bySource.set(page.sourceId, entry);
        }
        const remap = new Map<string, string>();
        for (const [sourceId, wordsByPage] of bySource) {
          signal.throwIfAborted();
          const bytes = await addOcrText(this.doc, sourceId, wordsByPage);
          remap.set(sourceId, await this.doc.addReplacementSource(this.doc.sources.get(sourceId)!, bytes, 'ocr'));
        }
        progress(1);
        if (remap.size) {
          this.doc.edit('Make text searchable', this.doc.pages.map((p) => (remap.has(p.sourceId) ? { ...p, sourceId: remap.get(p.sourceId)! } : p)));
        }
        return { words, pages: [...found.values()].filter((l) => l.length).length };
      },
      { cancellable: true },
    );
    if (!result) return;
    this.viewer.notify(
      result.words
        ? `Recognized ${result.words} words on ${this.plural(result.pages, 'page')}. Search and text selection now work there.`
        : 'No text was recognized. The pages may be blank, or the language setting may not match.',
    );
  }

  // --- Redaction ----------------------------------------------------------

  get redactionCount() {
    return this.doc.pages.reduce((n, p) => n + (p.redactions?.length ?? 0), 0);
  }

  private editRedactions(label: string, fn: (p: PageRef) => readonly Rect[] | undefined) {
    let changed = false;
    const next = this.doc.pages.map((p) => {
      const before = p.redactions ?? [];
      const after = fn(p) ?? [];
      if (after === before || (after.length === 0 && before.length === 0)) return p;
      changed = true;
      const { redactions: _, ...rest } = p;
      return after.length ? { ...rest, redactions: after } : rest;
    });
    if (changed) this.doc.edit(label, next);
  }

  markRedaction(pageId: string, rect: Rect) {
    this.editRedactions('Mark area for redaction', (p) => (p.id === pageId ? [...(p.redactions ?? []), rect] : p.redactions));
  }

  removeRedaction(pageId: string, index: number) {
    this.editRedactions('Remove redaction mark', (p) => (p.id === pageId ? p.redactions?.filter((_, k) => k !== index) : p.redactions));
  }

  clearRedactions() {
    this.editRedactions('Clear redaction marks', () => undefined);
  }

  /** Mark every occurrence of `query` in the document. Returns how many were found. */
  async markMatches(query: string) {
    const found = await this.viewer.runTask('Finding text…', () => findMatchRects(this.doc, this.doc.pages, query));
    if (!found?.length) return 0;
        const byPage = new Map(found.map((f) => [f.pageId, f.rects.map(padTextRect)]));
    const total = found.reduce((n, f) => n + f.rects.length, 0);
    this.editRedactions(`Mark ${this.plural(total, 'match')} for redaction`, (p) =>
      byPage.has(p.id) ? [...(p.redactions ?? []), ...byPage.get(p.id)!] : p.redactions,
    );
    this.viewer.goToPage(this.doc.pages.findIndex((p) => p.id === found[0].pageId));
    return total;
  }

  /**
   * Burn the marks in: affected pages are replaced by images with black boxes,
   * and their original content is removed from the file (undoable until saved).
   */
  async applyRedactions(removeInfo: boolean) {
    const { renderRedactedPage } = await import('./redact');
    const groups = groupMarks(this.doc.pages);
    const total = [...groups.values()].reduce((n, m) => n + m.size, 0);
    if (total === 0) return false;
    const done = await this.viewer.runTask(`Redacting ${this.plural(total, 'page')}…`, async (progress, signal) => {
      const remap = new Map<string, string>();
      let n = 0;
      for (const [sourceId, marks] of groups) {
        const rendered = [];
        for (const [index, rects] of marks) {
          signal.throwIfAborted();
          rendered.push(await renderRedactedPage(this.doc, sourceId, index, rects));
          progress((++n / total) * 0.8);
        }
        const bytes = await redactInWorker(this.doc, sourceId, rendered, removeInfo);
        signal.throwIfAborted();
        remap.set(sourceId, await this.doc.addReplacementSource(this.doc.sources.get(sourceId)!, bytes, 'redacted'));
      }
      progress(1);
      // Point every page of the affected files at the redacted version; marks are now applied.
      this.doc.edit(
        'Apply redaction',
        this.doc.pages.map((p) => {
          if (!remap.has(p.sourceId)) return p;
          const { redactions: _, ...rest } = p;
          return { ...rest, sourceId: remap.get(p.sourceId)! };
        }),
      );
      if (removeInfo) this.doc.info = { pdfVersion: this.doc.info.pdfVersion };
      return true;
    }, { cancellable: true });
    if (!done) return false;
    this.viewer.notify(
      `Redacted ${this.plural(total, 'page')}. The marked content is removed from the file; save to keep it that way. ` +
        'Redacted pages are now images: use Make text searchable to search them again.',
    );
    return true;
  }

  /** Before saving: marks that aren't applied would leave the content in the file. */
  private async checkPendingRedactions() {
    const n = this.redactionCount;
    if (n === 0) return true;
    const r = await showDialog({
      title: 'Redaction not applied',
      message: `${this.plural(n, 'area')} ${n === 1 ? 'is' : 'are'} marked for redaction but not applied yet, so the content underneath would still be in the saved file.`,
      buttons: [
        { value: 'cancel', label: 'Cancel' },
        { value: 'skip', label: 'Save without redacting' },
        { value: 'apply', label: 'Apply and save', primary: true },
      ],
      cancelValue: 'cancel',
    });
    if (r.button === 'cancel') return false;
    if (r.button === 'apply') return this.applyRedactions(this.viewer.redactRemoveInfo);
    return true;
  }

  // --- Images to PDF -------------------------------------------------------

  private async imagesToPdfBytes(files: File[], options: ImagesToPdfOptions, progress: (p: number) => void) {
    const images = [];
    for (let i = 0; i < files.length; i++) {
      images.push(await prepareImage(files[i]));
      progress(((i + 1) / files.length) * 0.5);
    }
    return imagesToPdfInWorker(images, options, (done, total) => progress(0.5 + (done / total) * 0.5));
  }

  /** Make a new document from images (replaces the open one, after asking about unsaved changes). */
  async createFromImages(files: File[], options: ImagesToPdfOptions) {
    if (files.length === 0 || !(await this.confirmLeave('create a new PDF'))) return;
    const bytes = await this.viewer.runTask('Creating PDF…', (progress) => this.imagesToPdfBytes(files, options, progress));
    if (!bytes) return;
    const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') + '.pdf' : 'images.pdf';
    const { doc } = await openDocument([{ id: `images-${Date.now()}`, name, size: bytes.length, bytes }], async () => null);
    if (!doc) return;
    doc.createdUnsaved = true;
    setDocument(doc);
  }

  /** Insert images as new pages after the current page. */
  async insertImages(files: File[], options: ImagesToPdfOptions, at = this.insertionIndex()) {
    const bytes = await this.viewer.runTask('Adding images…', (progress) => this.imagesToPdfBytes(files, options, progress));
    if (!bytes) return;
    const file: OpenFile = { id: `images-${Date.now()}`, name: files.length === 1 ? files[0].name : 'Images', size: bytes.length, bytes };
    const pages = await this.doc.addSource(file, askPassword);
    this.doc.edit(`Insert ${this.plural(pages.length, 'image')}`, insertPages(this.doc.pages, at, pages));
    this.viewer.goToPage(at);
  }

  // --- Insert image ---------------------------------------------------------

  /** Converts between a page's PDF space and points from its top-left as shown (rotation and crop applied). */
  async pagePoints(page: PageRef) {
    const pdfPage = await this.doc.source(page).pdf.getPage(page.sourceIndex + 1);
    const vp = viewportFor(pdfPage, 1, page.rotation);
    const crop = this.doc.displayedCrop(page);
    return {
      toShown: (p: Point): Point => {
        const [x, y] = vp.convertToViewportPoint(p[0], p[1]);
        return [x - crop.left, y - crop.top];
      },
      toPdf: (x: number, y: number): Point => {
        const [px, py] = vp.convertToPdfPoint(x + crop.left, y + crop.top);
        return [round(px), round(py)];
      },
      size: this.doc.displaySize(page),
      rotation: this.doc.totalRotation(page),
    };
  }

  /**
   * Place images on a page as movable objects, in one undo step. Without `drop`
   * they go on the current page (selected in the rail, else the one most in
   * view), centered in its visible part; with `drop`, centered where they were
   * dropped (points from the page's top-left as shown).
   */
  async insertImageFiles(files: readonly File[], drop?: { index: number; point: Point }) {
    if (files.length === 0) return;
    const heic = await heicDecodes();
    const result = await this.viewer.runTask(
      IMAGE_STRINGS.adding,
      async (progress) => {
        const images: StoredImage[] = [];
        let unsupported = 0;
        for (let i = 0; i < files.length; i++) {
          try {
            images.push(await addImageFile(files[i], heic));
          } catch (e) {
            if (!(e instanceof UnsupportedImageError)) throw e;
            unsupported++;
          }
          progress((i + 1) / files.length);
        }
        return { images, unsupported };
      },
      // Most images are ready at once: only show progress for slow ones.
      { delay: 1000 },
    );
    if (!result) return;
    const notes: string[] = [];
    if (result.unsupported) notes.push(IMAGE_STRINGS.unsupported);
    for (const img of result.images) {
      if (img.downscaledFrom) notes.push(IMAGE_STRINGS.downscaled(img.name, img.downscaledFrom, [img.width, img.height]));
    }
    if (result.images.length === 0) return this.viewer.notify(notes.join(' '));

    const index = drop?.index ?? this.viewer.activePageIndex();
    const page = this.doc.pages[index];
    if (!page) return;
    // Bring the page into view if it isn't.
    if (!drop && !this.viewer.visiblePageArea(index)) {
      this.viewer.goToPage(index);
      await tick();
    }
    const view = await this.pagePoints(page);
    const { width, height } = view.size;
    const area = this.viewer.visiblePageArea(index) ?? [0, 0, width, height];
    const center = drop?.point ?? [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2];
    // Several images: each a little further down and right, so none hides another.
    const step = 16 / this.viewer.scale;
    const placed: ImageAnnotation[] = result.images.map((img, k) => {
      const [w, h] = defaultImageSize([img.width, img.height], [width, height]);
      const cx = Math.min(width, Math.max(0, center[0] + k * step));
      const cy = Math.min(height, Math.max(0, center[1] + k * step));
      const [px, py] = view.toPdf(cx, cy);
      const [rw, rh] = view.rotation % 180 === 0 ? [w, h] : [h, w];
      return {
        id: newAnnotationId(),
        type: 'image',
        role: 'image',
        color: [0, 0, 0],
        opacity: 1,
        dataUrl: img.url,
        imageKey: img.key,
        rotate: view.rotation,
        angle: 0,
        rect: [round(px - rw / 2), round(py - rh / 2), round(px + rw / 2), round(py + rh / 2)],
      };
    });
    const label = placed.length === 1 ? IMAGE_STRINGS.undoOne : IMAGE_STRINGS.undoMany(placed.length);
    // Each image on the page as a whole (a drop near the edge moves it just inside).
    const fitted = placed.flatMap((a) => this.onPage(page.id, [a]) as ImageAnnotation[]);
    this.editAnnots(page.id, label, (list) => [...list, ...fitted]);
    this.viewer.setTool('select');
    const last = fitted[fitted.length - 1];
    this.viewer.selectAnnot({ pageId: page.id, id: last.id });
    if (notes.length) this.viewer.notify(notes.join(' '));
    // Keyboard users can nudge it with the arrow keys right away.
    await tick();
    focusObject(last.id);
  }

  // --- Forms ----------------------------------------------------------------

  /** Pages whose form fields aren't flattened yet. */
  private unflattenedFormPages() {
    return this.doc.pages.filter((p) => !p.flattenForm && this.doc.source(p).hasForm);
  }

  /**
   * Flatten / lock form: after confirmation, mark the form fields to become page
   * content (one undo step). The result is saved as a new "-flattened" copy.
   */
  async flattenForms() {
    if (!this.doc.hasForms) {
      // Nothing to flatten: say so, change nothing, no undo step.
      this.viewer.notify(FLATTEN_STRINGS.noFields);
      return;
    }
    if (this.unflattenedFormPages().length === 0) {
      this.viewer.notify(FLATTEN_STRINGS.already);
      return;
    }
    const r = await showDialog({
      title: FLATTEN_STRINGS.title,
      message: FLATTEN_STRINGS.message,
      buttons: [
        { value: 'cancel', label: FLATTEN_STRINGS.cancel },
        { value: 'flatten', label: FLATTEN_STRINGS.confirm, primary: true },
      ],
      cancelValue: 'cancel',
      initialFocus: 'cancel',
    });
    if (r.button !== 'flatten') return;
    this.doc.edit(FLATTEN_STRINGS.undoLabel, this.doc.pages.map((p) => (p.flattenForm || !this.doc.source(p).hasForm ? p : { ...p, flattenForm: true })));
    this.viewer.notify(FLATTEN_STRINGS.done);
  }

  /** The name a flattened form is saved under: "<original>-flattened.pdf". */
  flattenedFileName() {
    const base = baseName(this.doc.fileName);
    return `${base.endsWith(FLATTEN_STRINGS.copySuffix) ? base : base + FLATTEN_STRINGS.copySuffix}.pdf`;
  }

  // --- Annotations --------------------------------------------------------

  findAnnot(pageId: string, id: string) {
    const page = this.doc.pages.find((p) => p.id === pageId);
    const annot = page?.annots?.find((a) => a.id === id);
    return page && annot ? { page, annot } : null;
  }

  get selectedAnnot() {
    const ref = this.viewer.selectedAnnot;
    return ref ? this.findAnnot(ref.pageId, ref.id) : null;
  }

  private editAnnots(pageId: string, label: string, fn: (list: readonly Annotation[]) => readonly Annotation[], coalesceKey?: string) {
    const next = this.doc.pages.map((p) => (p.id === pageId ? { ...p, annots: fn(p.annots ?? []) } : p));
    this.doc.edit(label, next, coalesceKey);
  }

  /** Objects (one block) placed just inside a page: added objects never leave it. */
  private onPage(pageId: string, members: readonly Annotation[]) {
    const page = this.doc.pages.find((p) => p.id === pageId);
    if (!page) return [...members];
    // New objects: within the page, or within the margins when that's the limit.
    const limit = this.viewer.limitFor(page);
    const r = placeInside(members, limit.rect);
    if (r.moved) this.viewer.limitHit(pageId, limit.kind);
    return r.members;
  }

  addAnnotation(pageId: string, annot: Annotation) {
    const [placed] = this.onPage(pageId, [annot]);
    this.editAnnots(pageId, `Add ${describe(placed).toLowerCase()}`, (list) => [...list, placed]);
  }

  /** Replace several annotations (on any pages) as one undo step. */
  updateAnnotations(changed: readonly { pageId: string; annot: Annotation }[], label: string, coalesceKey?: string) {
    if (changed.length === 0) return;
    const byPage = new Map<string, Map<string, Annotation>>();
    for (const c of changed) byPage.set(c.pageId, (byPage.get(c.pageId) ?? new Map()).set(c.annot.id, c.annot));
    const next = this.doc.pages.map((p) => {
      const repl = byPage.get(p.id);
      return repl ? { ...p, annots: (p.annots ?? []).map((a) => repl.get(a.id) ?? a) } : p;
    });
    this.doc.edit(label, next, coalesceKey);
  }

  /** Replace an annotation. Pass `coalesceKey` for continuous edits (sliders, nudges). */
  updateAnnotation(pageId: string, annot: Annotation, label = `Edit ${describe(annot).toLowerCase()}`, coalesceKey?: string) {
    this.editAnnots(pageId, label, (list) => list.map((a) => (a.id === annot.id ? annot : a)), coalesceKey);
  }

  deleteAnnotation(pageId: string, id: string, announce = 'deleted') {
    const found = this.findAnnot(pageId, id);
    if (!found) return;
    this.editAnnots(pageId, `Delete ${describe(found.annot).toLowerCase()}`, (list) => list.filter((a) => a.id !== id));
    if (this.viewer.selectedAnnot?.id === id) this.viewer.selectObjects(null);
    this.viewer.announce(`${describe(found.annot)} ${announce}`);
    // Its element (which may have had focus) is gone: never leave focus on <body> or the canvas.
    void tick().then(() => settleFocusAfterRemoval());
  }

  /** The selection: its page, units, and their objects (bottom first). */
  get selectedObjects() {
    const s = this.viewer.objectSelection;
    const page = s ? this.doc.pages.find((p) => p.id === s.pageId) : undefined;
    if (!s || !page) return null;
    const list = page.annots ?? [];
    const members = membersOf(list, s.ids);
    return members.length ? { page, ids: s.ids, members, list } : null;
  }

  /** Words for the selection: "text", "3 objects", "group (3 objects)". */
  describeSelection(capital = false) {
    const sel = this.selectedObjects;
    return sel ? describeUnits(sel.list, sel.ids, capital) : '';
  }

  /** Delete the selected objects (a group with all its objects): one undo step. */
  deleteSelection(announce = 'deleted') {
    const sel = this.selectedObjects;
    if (!sel) return;
    const gone = new Set(sel.members.map((a) => a.id));
    const what = describeUnits(sel.list, sel.ids);
    this.editAnnots(sel.page.id, `Delete ${what}`, (list) => list.filter((a) => !gone.has(a.id)));
    this.viewer.selectObjects(null);
    this.viewer.announce(`${what[0].toUpperCase()}${what.slice(1)} ${announce}`);
    // Their elements (one may have had focus) are gone: never leave focus on <body> or the canvas.
    void tick().then(() => settleFocusAfterRemoval());
  }

  /** Copy the selection into the app's own clipboard (never the system's: nothing leaves the tab). */
  copyAnnotation() {
    const sel = this.selectedObjects;
    if (sel) annotClipboard = { members: sel.members, pageId: sel.page.id, topUnit: unitOf(sel.members[sel.members.length - 1]) };
  }

  cutAnnotation() {
    if (!this.selectedObjects) return;
    this.copyAnnotation();
    this.deleteSelection('cut');
  }

  canPaste() {
    return annotClipboard !== null && this.doc.pages.length > 0;
  }

  /**
   * Text copied in another app, pasted onto the page: one new text box with it,
   * in the current text style, in the middle of what's visible. One undo step.
   */
  async pasteText(text: string) {
    const clean = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (!clean.trim()) return;
    const index = this.viewer.activePageIndex();
    const page = this.doc.pages[index];
    if (!page) return;
    const t = $state.snapshot(this.viewer.toolProps.text);
    await ensureTextFont(t.font);
    const view = await this.pagePoints(page);
    const { width, height } = view.size;
    const area = this.viewer.visiblePageArea(index) ?? [0, 0, width, height];
    const center = view.toPdf((area[0] + area[2]) / 2, (area[1] + area[3]) / 2);
    const box: TextAnnotation = {
      id: newAnnotationId(),
      type: 'text',
      color: t.color,
      opacity: t.opacity,
      font: t.font,
      bold: t.bold,
      italic: t.italic,
      underline: t.underline,
      strike: t.strike,
      align: t.align,
      lineSpacing: t.lineSpacing,
      background: t.background,
      size: t.size,
      text: clean,
      rotate: view.rotation,
      rect: rectFromUpright(topLeftForCenter(center, DEFAULT_TEXT_WIDTH, t.size, view.rotation), DEFAULT_TEXT_WIDTH, t.size, view.rotation),
    };
    const [laid] = this.onPage(page.id, [layoutText(box)]) as TextAnnotation[];
    this.editAnnots(page.id, 'Paste text', (list) => [...list, laid]);
    this.viewer.setTool('select');
    this.viewer.selectAnnot({ pageId: page.id, id: laid.id });
    await tick();
    focusObject(laid.id);
  }

  /** Can a style shortcut act now? (A text box is being edited or is selected.) */
  canStyleText() {
    return !!this.viewer.textEditor || this.selectedAnnot?.annot.type === 'text';
  }

  /** Bold / italic / underline / strikethrough on the text box being edited or selected: one undo step. */
  async toggleTextStyle(style: 'bold' | 'italic' | 'underline' | 'strike') {
    if (this.viewer.textEditor) return this.viewer.textEditor.toggle(style);
    const sel = this.selectedAnnot;
    if (!sel || sel.annot.type !== 'text') return;
    const a = sel.annot;
    if ((style === 'bold' || style === 'italic') && !styleAvailable(a.font, style)) {
      this.viewer.notify(`This font has no ${style}.`);
      return;
    }
    await ensureTextFont(a.font);
    const next = formatTextBox(a, { [style]: !a[style] });
    (this.viewer.toolProps.text as Record<string, unknown>)[style] = next[style];
    this.updateAnnotation(sel.page.id, next, STYLE_LABELS[style]);
  }

  /** Copies of the selection next to it, on the same page, directly above it (the clipboard is left alone). */
  duplicateAnnotation() {
    const sel = this.selectedObjects;
    if (!sel) return;
    const copies = this.onPage(sel.page.id, copyWithNewIds(sel.members, newAnnotationId).map((a) => translate(a, 12, -12)));
    const above = unitOf(sel.members[sel.members.length - 1]);
    this.editAnnots(sel.page.id, `Duplicate ${describeUnits(sel.list, sel.ids)}`, (list) => insertAboveUnit(list, above, copies));
    this.selectNew(sel.page.id, copies);
  }

  /** Select objects just added (their units) and give the top one focus, so keys act on them. */
  private selectNew(pageId: string, added: readonly Annotation[]) {
    const ids = unitsIn(added);
    this.viewer.selectObjects({ pageId, ids });
    if (ids.length > 1) this.viewer.announce(`${describeUnits(added, ids, true)} selected`);
    void tick().then(() => focusObject(added[added.length - 1].id));
  }

  /** Can the object move this way in its page's layer order? */
  canMoveLayer(pageId: string, id: string, move: LayerMove) {
    const list = this.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
    const a = list.find((x) => x.id === id);
    return !!a && canMoveUnits(list, [unitOf(a)], move);
  }

  /** The selection, if it can move this way (for menus, shortcuts and the panel). */
  canMoveSelected(move: LayerMove) {
    const sel = this.selectedObjects;
    return !!sel && canMoveUnits(sel.list, sel.ids, move);
  }

  /** Move one object (with its group, if it's in one) in the layer order. */
  moveLayer(pageId: string, id: string, move: LayerMove) {
    const list = this.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
    const a = list.find((x) => x.id === id);
    if (a) this.moveUnitsLayer(pageId, [unitOf(a)], move);
  }

  /**
   * Move the selection in its page's layer order, as one block: to the front or
   * back, or one step. One undo step ("Bring to front"). Every entry point
   * (Edit menu, context menu, shortcut, panel) calls this.
   */
  moveSelectedLayer(move: LayerMove) {
    const sel = this.selectedObjects;
    if (sel) this.moveUnitsLayer(sel.page.id, sel.ids, move);
  }

  private moveUnitsLayer(pageId: string, ids: readonly string[], move: LayerMove) {
    const list = this.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
    if (!canMoveUnits(list, ids, move)) return;
    // Moving elements in the page takes focus off them: put it back.
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.annotId;
    const hadFocus = !!focused && membersOf(list, ids).some((a) => a.id === focused);
    this.editAnnots(pageId, LAYER_LABELS[move], (l) => moveUnits(l, ids, move));
    const after = this.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
    const what = describeUnits(after, ids, true);
    if (ids.length === 1) {
      const units = unitsIn(after);
      this.viewer.announce(`${LAYER_LABELS[move]}: ${what}, ${units.indexOf(ids[0]) + 1} of ${units.length}`);
    } else this.viewer.announce(`${LAYER_LABELS[move]}: ${what}`);
    void tick().then(() => (hadFocus || focusLost()) && focused && focusObject(focused));
  }

  /** Move the selection by (dx, dy) in PDF space: one undo step for a run of nudges. */
  nudgeSelection(dx: number, dy: number) {
    const sel = this.selectedObjects;
    if (!sel) return;
    this.updateAnnotations(
      sel.members.map((a) => ({ pageId: sel.page.id, annot: translate(a, dx, dy) })),
      `Move ${describeUnits(sel.list, sel.ids)}`,
      `nudge:${sel.ids.join(',')}`,
    );
  }

  // --- Cropping images ------------------------------------------------------
  // One way in (startCrop) for the Image panel's Crop button, double-click and
  // the context menu. Nothing changes in the document until the crop is applied.

  /** Can this object be cropped? Inserted images (not signatures) that aren't in a group. */
  canCrop(ref: AnnotRef | null = this.viewer.selectedAnnot) {
    const found = ref && this.findAnnot(ref.pageId, ref.id);
    const a = found?.annot;
    return !!a && a.type === 'image' && a.role === 'image' && !!a.imageKey && !!storedImage(a.imageKey) && !a.groups?.length;
  }

  /** Enter crop mode for an image: the whole original shows, the current crop framed. */
  startCrop(ref: AnnotRef | null = this.viewer.selectedAnnot) {
    if (!ref || !this.canCrop(ref)) return;
    const cur = this.viewer.imageCrop;
    if (cur?.id === ref.id) return;
    if (cur) this.applyCrop();
    this.viewer.textEditor?.finish();
    this.viewer.selectAnnot(ref);
    const a = this.findAnnot(ref.pageId, ref.id)!.annot as ImageAnnotation;
    this.viewer.imageCrop = this.cropSession(ref.pageId, a, 'free');
    this.viewer.announce(CROP_STRINGS.started(isMac ? 'Option' : 'Alt'));
  }

  private cropSession(pageId: string, a: ImageAnnotation, ratio: RatioId): CropSession {
    const stored = storedImage(a.imageKey!)!;
    const view = enterCropFor(a);
    return { pageId, id: a.id, base: a, view, px: [stored.width, stored.height], ratio, portrait: isPortrait(view) };
  }

  private cropSizeTimer: ReturnType<typeof setTimeout> | undefined;

  /** The crop frame or image moved (drag, keys): announces the new size once things settle. */
  setCropView(view: CropView) {
    const c = this.viewer.imageCrop;
    if (!c) return;
    this.viewer.imageCrop = { ...c, view };
    clearTimeout(this.cropSizeTimer);
    this.cropSizeTimer = setTimeout(() => {
      const now = this.viewer.imageCrop;
      if (now) this.viewer.announce(CROP_STRINGS.size(...cropPixels(viewToCrop(now.view, now.base.flipX, now.base.flipY), now.px)));
    }, 250);
  }

  /** The ratio of the crop frame (the largest frame of it inside the current one). */
  setCropRatio(ratio: RatioId) {
    const c = this.viewer.imageCrop;
    if (!c) return;
    const portrait = ratio === 'free' ? c.portrait : isPortrait(c.view);
    this.viewer.imageCrop = { ...c, ratio, portrait };
    this.setCropView(applyRatio(c.view, ratioValue(ratio, c.px, portrait)));
  }

  /** Portrait ⇄ landscape for the chosen ratio. */
  swapCropOrientation() {
    const c = this.viewer.imageCrop;
    if (!c || c.ratio === 'free' || c.ratio === '1:1') return;
    this.viewer.imageCrop = { ...c, portrait: !c.portrait };
    this.setCropView(swapFrame(c.view));
  }

  /** Leave crop mode, keeping the crop: one undo step ("Crop"), none when nothing changed. */
  applyCrop() {
    const c = this.viewer.imageCrop;
    if (!c) return;
    this.viewer.imageCrop = null;
    clearTimeout(this.cropSizeTimer);
    const found = this.findAnnot(c.pageId, c.id);
    if (!found || found.annot !== c.base) return;
    const next = applyCropView(c.base, c.view, c.px);
    if (sameCrop(next, c.base) && next.rect.every((v, i) => Math.abs(v - c.base.rect[i]) < 0.01)) {
      this.viewer.announce(CROP_STRINGS.unchanged);
    } else {
      const [placed] = this.onPage(c.pageId, [next]);
      this.updateAnnotation(c.pageId, placed, CROP_STRINGS.undo);
      this.viewer.announce(CROP_STRINGS.applied(...cropPixels(cropOf(next), c.px)));
    }
    void tick().then(() => focusObject(c.id));
  }

  /** Leave crop mode without changing anything. */
  cancelCrop() {
    const c = this.viewer.imageCrop;
    if (!c) return;
    this.viewer.imageCrop = null;
    clearTimeout(this.cropSizeTimer);
    this.viewer.announce(CROP_STRINGS.cancelled);
    void tick().then(() => focusObject(c.id));
  }

  /** Is the image cropped (or, in crop mode, framed smaller than the whole)? */
  canResetCrop(ref: AnnotRef | null = this.viewer.selectedAnnot) {
    const c = this.viewer.imageCrop;
    if (c && c.id === ref?.id) return !!c.base.crop || !isFull(viewToCrop(c.view, c.base.flipX, c.base.flipY));
    const a = ref && this.findAnnot(ref.pageId, ref.id)?.annot;
    return !!a && a.type === 'image' && !!a.crop && this.canCrop(ref);
  }

  /**
   * The whole image again, at the same scale, where it was: one undo step
   * ("Reset crop"). In crop mode, crop mode goes on from the whole image.
   */
  resetCrop(ref: AnnotRef | null = this.viewer.selectedAnnot) {
    if (!ref || !this.canResetCrop(ref)) return;
    const c = this.viewer.imageCrop?.id === ref.id ? this.viewer.imageCrop : null;
    const a = this.findAnnot(ref.pageId, ref.id)!.annot as ImageAnnotation;
    if (c && !a.crop) {
      // Not cropped yet: only the frame changes.
      this.setCropView({ image: c.view.image, frame: c.view.image });
      this.viewer.announce(CROP_STRINGS.resetDone);
      return;
    }
    const whole = enterCropFor(a).image;
    const [next] = this.onPage(ref.pageId, [applyCropView(a, { image: whole, frame: whole }, [storedImage(a.imageKey!)!.width, storedImage(a.imageKey!)!.height])]);
    this.updateAnnotation(ref.pageId, next, CROP_STRINGS.undoReset);
    if (c) this.viewer.imageCrop = this.cropSession(ref.pageId, next as ImageAnnotation, c.ratio);
    this.viewer.announce(CROP_STRINGS.resetDone);
  }

  // --- Original content (Edit content tool) -----------------------------------

  /** The selected original content: its page, version of the file, analysis and items. */
  private contentSelected() {
    const sel = this.viewer.contentSelection;
    const page = sel && this.doc.pages.find((p) => p.id === sel.pageId);
    if (!sel || !page) return null;
    const source = this.doc.source(page);
    const analysis = this.viewer.content.get(source, page.sourceIndex);
    if (!analysis || typeof analysis !== 'object') return null;
    const items = sel.ids.map((id) => analysis.items.find((i) => i.id === id)).filter((i): i is ContentItem => !!i);
    return items.length ? { page, source, analysis, items } : null;
  }

  describeContentSelection() {
    const s = this.contentSelected();
    if (!s) return '';
    const texts = s.items.filter((i) => i.kind === 'text').length;
    return CONTENT_STRINGS.describe(texts, s.items.length - texts);
  }

  canDeleteContent() {
    const s = this.contentSelected();
    return !!s && !s.items.some((i) => i.blocked) && !this.viewer.content.locked.get(s.source.id);
  }

  /** Files whose signature the user agreed to invalidate (by the original file). */
  private signedOk = new Set<string>();
  private metadataNoted = false;
  private contentVersion = 0;

  /**
   * Delete the selected original content from the PDF, for real: a new version
   * of the file without it (one undo step; undo goes back to the original).
   */
  async deleteContent() {
    const s = this.contentSelected();
    if (!s) return;
    const texts = s.items.filter((i) => i.kind === 'text').length;
    const label = s.items.length > 1 ? CONTENT_STRINGS.undoMany(s.items.length) : texts ? CONTENT_STRINGS.undoText : CONTENT_STRINGS.undoImage;
    if (!(await this.removeContent(s, label))) return;
    this.viewer.announce(CONTENT_STRINGS.deleted(CONTENT_STRINGS.describe(texts, s.items.length - texts).replace(/^./, (c) => c.toUpperCase())));
    await tick();
    focusSink();
  }

  /**
   * Remove the selected original content from the file (a new version of it)
   * as one undo step, adding `box` to the page in the same step when given.
   * Asks first where needed (signed file, a scan). True when it was done.
   */
  private async removeContent(s: NonNullable<ReturnType<Actions['contentSelected']>>, label: string, box?: TextAnnotation): Promise<boolean> {
    const { page, source, analysis, items } = s;
    const blocked = items.find((i) => i.blocked);
    if (blocked) {
      this.viewer.notify(blocked.blocked!);
      return false;
    }
    if (await this.viewer.content.checkLock(source)) {
      this.viewer.notify(CONTENT_STRINGS.restricted);
      return false;
    }
    const root = source.id.split('~')[0];
    if (looksDigitallySigned(source.bytes) && !this.signedOk.has(root)) {
      const r = await showDialog({
        title: CONTENT_STRINGS.signedTitle,
        message: CONTENT_STRINGS.signedMessage,
        buttons: [
          { value: 'cancel', label: CONTENT_STRINGS.cancel },
          { value: 'continue', label: CONTENT_STRINGS.continue, primary: true },
        ],
        cancelValue: 'cancel',
        initialFocus: 'cancel',
      });
      if (r.button !== 'continue') return false;
      this.signedOk.add(root);
    }
    if (!box && analysis.scan && items.some((i) => i.coversPage)) {
      const r = await showDialog({
        title: CONTENT_STRINGS.scanTitle,
        message: CONTENT_STRINGS.scanMessage,
        buttons: [
          { value: 'cancel', label: CONTENT_STRINGS.cancel },
          { value: 'delete', label: CONTENT_STRINGS.scanConfirm, danger: true },
        ],
        cancelValue: 'cancel',
        initialFocus: 'cancel',
      });
      if (r.button !== 'delete') return false;
    }
    const newId = `${root}~${++this.contentVersion}`;
    const done = await this.viewer.runTask(CONTENT_STRINGS.deleting, () => this.viewer.content.remove(source, page.sourceIndex, items.map((i) => i.id), newId), { delay: 1000 });
    if (!done) return false;
    try {
      await this.doc.addReplacementSource(source, done.bytes, 'edit', newId);
      // Values typed into form fields carry over (same fields, same ids).
      const typed = (source.pdf.annotationStorage.serializable as { map?: Map<string, object> }).map;
      const next = this.doc.sources.get(newId)!;
      if (typed) for (const [k, v] of typed) next.pdf.annotationStorage.setValue(k, v);
    } catch (e) {
      // Nothing changed: the new version is dropped.
      this.pruneSources();
      this.viewer.notify(friendlyError(e), { error: true });
      return false;
    }
    this.doc.edit(
      label,
      this.doc.pages.map((p) => {
        const moved = p.sourceId === source.id ? { ...p, sourceId: newId } : p;
        return box && p.id === page.id ? { ...moved, annots: [...(p.annots ?? []), box] } : moved;
      }),
    );
    this.viewer.contentSelection = null;
    if (done.result.removedMetadata && !this.metadataNoted) {
      this.metadataNoted = true;
      this.viewer.notify(CONTENT_STRINGS.metadata);
    }
    this.pruneSources();
    return true;
  }

  /**
   * The one way into Edit content: the toolbar and its shortcut (no target),
   * a double-click on a page with the Select tool (a point: what's there is
   * found, analyzing the page if needed), Enter on a block and the context
   * menu (an item). `edit`: text is turned into a text box right away, the
   * caret at `caret` (a point on screen).
   */
  async enterContentEditing(o: { pageId?: string; point?: Point; itemId?: string; caret?: [number, number]; edit?: boolean; byDoubleClick?: boolean } = {}) {
    const from = this.viewer.tool;
    const page = o.pageId ? this.doc.pages.find((p) => p.id === o.pageId) : undefined;
    if (!page) {
      if (from !== 'content') this.viewer.setTool('content');
      return;
    }
    const source = this.doc.source(page);
    let itemId = o.itemId;
    if (!itemId && o.point) {
      if (await this.viewer.content.checkLock(source)) return this.viewer.notify(CONTENT_STRINGS.restricted);
      const a = await this.viewer.content.whenReady(source, page.sourceIndex);
      const route = routeAt(o.point, false, a === 'failed' ? { status: 'unreadable', items: [], scan: false, shapes: [], page: [0, 0, 0, 0] } : a);
      if (route.kind === 'shape') return this.viewer.notify(CONTENT_STRINGS.shapes);
      if (route.kind === 'scan') return this.viewer.notify(CONTENT_STRINGS.scan);
      if (route.kind === 'unreadable') return this.viewer.notify(CONTENT_STRINGS.unreadable);
      if (route.kind !== 'text' && route.kind !== 'image') return;
      itemId = route.id;
    }
    if (from !== 'content') {
      this.viewer.setTool('content');
      this.viewer.contentReturn.enter(from, !!o.byDoubleClick);
      if (o.byDoubleClick) this.viewer.announce(CONTENT_STRINGS.entered);
    }
    if (!itemId) return;
    this.viewer.selectContent({ pageId: page.id, ids: [itemId] });
    const item = this.contentSelected()?.items[0];
    if (o.edit && item?.kind === 'text' && item.convert) return this.editContent(o.caret);
    await tick();
    document.querySelector<HTMLElement>(`[data-content-id="${CSS.escape(itemId)}"]`)?.focus({ preventScroll: true });
  }

  /** Can the selected original content be turned into a text box (one text block that converts faithfully)? */
  canEditContent() {
    const s = this.contentSelected();
    return !!s && s.items.length === 1 && !!s.items[0].convert && !s.items[0].blocked && !this.viewer.content.locked.get(s.source.id);
  }

  /** The text box made from original text, while its first editing session lasts. */
  private conversion: { pageId: string; id: string; itemId: string; pages: readonly PageRef[] } | null = null;
  private fontNoted = false;

  /**
   * Edit the selected text block: it becomes one of our text boxes (the same
   * words, lines and look, in the closest bundled font), the original text
   * leaves the file, and the editor opens on it (caret at `caret`, a point on
   * screen). One undo step together with the typing that follows.
   */
  async editContent(caret?: [number, number]) {
    const s = this.contentSelected();
    if (!s || s.items.length !== 1 || s.items[0].kind !== 'text') return;
    const item = s.items[0];
    if (!item.convert) return this.viewer.notify(item.blocked ?? item.noConvert ?? '');
    const c = item.convert;
    const families = [...new Set(c.lines.flatMap((l) => l.runs.map((r) => FAMILY_FOR[r.family])))];
    await Promise.all([loadFonts(), ...families.map((f) => ensureTextFont(f))]);
    const { box } = textBoxFromConversion(c, this.doc.pageBounds(s.page), screenEnv);
    if (!(await this.removeContent(s, CONTENT_STRINGS.undoEdit, box))) return;
    this.conversion = { pageId: s.page.id, id: box.id, itemId: item.id, pages: this.doc.pages };
    this.viewer.selectAnnot({ pageId: s.page.id, id: box.id });
    this.viewer.editRequest = { pageId: s.page.id, id: box.id, caret };
    this.viewer.announce(CONTENT_STRINGS.converted);
    if (!this.fontNoted) {
      this.fontNoted = true;
      this.viewer.notify(CONTENT_STRINGS.fontNote(FAMILY_LABEL[c.family], c.matched ? [] : [c.fontName]));
    }
  }

  /** Is this text box's first editing session (right after converting original text) still on? */
  isConverting(id: string) {
    return this.conversion?.id === id;
  }

  /**
   * The first editing session of converted text ended: unchanged, the original
   * text comes back as if nothing happened (no undo step); otherwise the result
   * becomes part of the conversion's undo step (null: the box was emptied).
   */
  endConversion(result: TextAnnotation | null | 'unchanged') {
    const c = this.conversion;
    if (!c) return;
    this.conversion = null;
    if (result === 'unchanged') {
      // Only if nothing else happened meanwhile.
      if (this.doc.pages !== c.pages) return;
      this.doc.undo();
      this.doc.history.dropRedo();
      this.pruneSources();
      this.viewer.selectContent({ pageId: c.pageId, ids: [c.itemId] });
      this.viewer.announce(CONTENT_STRINGS.restored);
      void tick().then(() => document.querySelector<HTMLElement>(`[data-content-id="${CSS.escape(c.itemId)}"]`)?.focus());
      return;
    }
    this.doc.amend(
      this.doc.pages.map((p) =>
        p.id !== c.pageId ? p : { ...p, annots: result ? (p.annots ?? []).map((a) => (a.id === c.id ? result : a)) : (p.annots ?? []).filter((a) => a.id !== c.id) },
      ),
    );
    if (!result) this.viewer.selectObjects(null);
  }

  /** Edited versions of files that neither the document nor undo/redo refer to any more. */
  pruneSources() {
    const used = new Set(this.doc.allPageLists().flatMap((list) => list.map((p) => p.sourceId)));
    for (const s of [...this.doc.sources.values()]) {
      if (used.has(s.id) || !s.id.includes('~')) continue;
      this.doc.sources.delete(s.id);
      this.viewer.content.forget(s.id);
      void s.pdf.loadingTask.destroy().catch(() => {});
    }
  }

  /** The selected text boxes (not being typed in), when only text boxes are selected. */
  private selectedTextBoxes() {
    const sel = this.selectedObjects;
    if (!sel || sel.ids.some(isGroupId) || !sel.members.every((a) => a.type === 'text')) return null;
    return { page: sel.page, boxes: sel.members as TextAnnotation[] };
  }

  /** The list state of all paragraphs of the selected text boxes (the panel, when no box is being typed in). */
  textBoxListState() {
    const t = this.selectedTextBoxes();
    const ps = t ? t.boxes.flatMap((a) => paragraphsOf(a)) : [];
    return { list: sharedList(ps), canIncrease: canIndent(ps, 1), canDecrease: canIndent(ps, -1), anyList: ps.some((p) => p.list) };
  }

  /** A list command on every paragraph of the selected text boxes: one undo step ("Bulleted list"). */
  listOnTextBoxes(action: ListAction) {
    const t = this.selectedTextBoxes();
    if (!t) return;
    // Every paragraph of every box is one list together (as if all were selected while typing).
    const all = t.boxes.map((a) => toRich(a).paragraphs!);
    const next = applyListAction(all.flat(), action);
    let k = 0;
    const changed = t.boxes.map((a, i) => {
      const paragraphs = all[i].map((p) => {
        const { list: _l, level: _v, ...rest } = p;
        return { ...rest, ...next[k++] };
      });
      return { pageId: t.page.id, annot: layoutText({ ...toRich(a), paragraphs }) };
    });
    this.updateAnnotations(changed, listActionLabel(action));
  }

  /** Group needs two or more units (objects or groups) selected. */
  canGroup() {
    const sel = this.selectedObjects;
    return !!sel && sel.ids.length >= 2;
  }

  /**
   * Group the selection: one new group (groups may hold groups), placed in the
   * layer order where the topmost of them was. One undo step ("Group 3
   * objects"); the new group is selected.
   */
  groupSelection() {
    const sel = this.selectedObjects;
    if (!sel || sel.ids.length < 2) return;
    const id = `${GROUP_PREFIX}${newAnnotationId()}`;
    const what = describeUnits(sel.list, sel.ids);
    this.editAnnots(sel.page.id, `Group ${what}`, (list) => groupUnits(list, sel.ids, id));
    this.viewer.selectObjects({ pageId: sel.page.id, ids: [id] });
    this.viewer.announce(`Grouped ${what}`);
  }

  /** Ungroup needs a group in the selection. */
  canUngroup() {
    return !!this.selectedObjects?.ids.some(isGroupId);
  }

  /**
   * Ungroup the selected groups by one level: their objects (and groups inside
   * them, which stay groups) are selected, in the same places and order.
   */
  ungroupSelection() {
    const sel = this.selectedObjects;
    if (!sel) return;
    const groups = sel.ids.filter(isGroupId);
    if (!groups.length) return;
    const { children } = ungroupUnits(sel.list, groups);
    this.editAnnots(sel.page.id, groups.length === 1 ? 'Ungroup' : `Ungroup ${groups.length} groups`, (list) => ungroupUnits(list, groups).list);
    const ids = [...sel.ids.filter((id) => !groups.includes(id)), ...children];
    this.viewer.selectObjects({ pageId: sel.page.id, ids });
    const after = this.doc.pages.find((p) => p.id === sel.page.id)?.annots ?? [];
    this.viewer.announce(`Ungrouped: ${describeUnits(after, ids)} selected`);
  }

  /** Select every object (unit) on a page. */
  selectAllObjects(pageId: string) {
    const list = this.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
    const ids = unitsIn(list);
    if (!ids.length) return false;
    this.viewer.selectObjects({ pageId, ids });
    this.viewer.announce(`${describeUnits(list, ids, true)} selected`);
    return true;
  }

  /**
   * Paste the app's clipboard: the same objects (groups included, as new
   * groups), keeping their positions relative to each other. One undo step. On
   * the page they were copied from they're offset so they're visible next to
   * the originals, and go directly above them; on another page they land in the
   * same position, on top. "Paste here" centers them on a point.
   */
  pasteAnnotation(at?: { pageId: string; point?: Point }) {
    const page = at ? this.doc.pages.find((p) => p.id === at.pageId) : this.doc.pages[this.viewer.currentIndex];
    if (!annotClipboard || !page) return;
    const { members, pageId, topUnit } = annotClipboard;
    const samePage = pageId === page.id;
    let copies = copyWithNewIds(members, newAnnotationId).map((a) => (samePage ? translate(a, 12, -12) : a));
    if (at?.point) {
      const r = unionBounds(copies)!;
      const [dx, dy] = [at.point[0] - (r[0] + r[2]) / 2, at.point[1] - (r[1] + r[3]) / 2];
      copies = copies.map((a) => translate(a, dx, dy));
    }
    // A paste that would land past the edge goes just inside.
    copies = this.onPage(page.id, copies);
    annotClipboard = { members: copies, pageId: page.id, topUnit: unitOf(copies[copies.length - 1]) };
    this.editAnnots(page.id, `Paste ${describeUnits(copies, unitsIn(copies))}`, (list) => insertAboveUnit(list, samePage ? topUnit : null, copies));
    this.viewer.setTool('select');
    this.selectNew(page.id, copies);
  }
}

const ACTIONS_KEY = Symbol('actions');

export function provideActions(a: Actions) {
  setContext(ACTIONS_KEY, a);
}

export function useActions(): Actions {
  return getContext<Actions>(ACTIONS_KEY);
}
