// Document actions. Each feature is implemented once here and invoked from
// menus, the thumbnail context menu, keyboard shortcuts and panels alike.
import { getContext, setContext, tick } from 'svelte';
import { describe, newAnnotationId, round, translate, type Annotation, type ImageAnnotation, type Point } from './annotations';
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
import { FLATTEN_STRINGS, IMAGE_STRINGS, NEW_PDF_STRINGS } from './strings';
import { addImageFile, type StoredImage } from './image-store';
import { UnsupportedImageError } from './image-prepare';
import { defaultImageSize } from './image-geometry';
import { heicDecodes } from './landing/heic-probe';
import { viewportFor } from './pdf/render';
import { focusObject, settleFocusAfterRemoval } from './focus';
import { styleAvailable } from './text-format';
import { ensureTextFont } from './font-metrics-store.svelte';
import { formatTextBox } from './text-layout';
import { dropPageLinks } from './text-rich';

const STYLE_LABELS = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough' } as const;
import { groupMarks, padTextRect } from './redact-marks';
import type { OcrLanguage } from './ocr';
import { isWorthwhile, type CompressSettings } from './pdf/compress';
import type { ImagesToPdfOptions } from './pdf/images-to-pdf';
import { isImageFile, prepareImage } from './image-input';
import { setDocument } from './app-state.svelte';
import { openDocument } from './document.svelte';
import type { Viewer } from './viewer.svelte';

let blankCounter = 0;

export const DEFAULT_IMAGE_OPTIONS: ImagesToPdfOptions = { pageSize: 'a4', margin: 28 };

/** In-memory clipboard for annotations (never the system clipboard: nothing leaves the tab). */
let annotClipboard: Annotation | null = null;

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
    const bytes = await this.viewer.runTask('Saving…', () => writePdf(this.doc, this.doc.pages, 'preserve'));
    if (!bytes) return false;
    downloadBytes(bytes, fileName);
    if (markSaved) this.doc.markSaved();
    this.viewer.notify(`Saved ${fileName} to your downloads.${this.passwordNote()}`);
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
    const bytes = await this.viewer.runTask('Extracting…', () => writePdf(this.doc, pages, 'fresh'));
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
      writePdfs(this.doc, groups, 'fresh', (done, total) => progress(done / total)),
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
    this.editAnnots(page.id, label, (list) => [...list, ...placed]);
    this.viewer.setTool('select');
    const last = placed[placed.length - 1];
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

  addAnnotation(pageId: string, annot: Annotation) {
    this.editAnnots(pageId, `Add ${describe(annot).toLowerCase()}`, (list) => [...list, annot]);
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
    if (this.viewer.selectedAnnot?.id === id) this.viewer.selectedAnnot = null;
    this.viewer.announce(`${describe(found.annot)} ${announce}`);
    // Its element (which may have had focus) is gone: never leave focus on <body> or the canvas.
    void tick().then(() => settleFocusAfterRemoval());
  }

  copyAnnotation() {
    const sel = this.selectedAnnot;
    if (sel) annotClipboard = sel.annot;
  }

  cutAnnotation() {
    const sel = this.selectedAnnot;
    if (!sel) return;
    annotClipboard = sel.annot;
    this.deleteAnnotation(sel.page.id, sel.annot.id, 'cut');
  }

  canPaste() {
    return annotClipboard !== null && this.doc.pages.length > 0;
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

  /** A copy next to the selected object, on the same page (the clipboard is left alone). */
  duplicateAnnotation() {
    const sel = this.selectedAnnot;
    if (!sel) return;
    const copy = { ...translate(sel.annot, 12, -12), id: newAnnotationId() };
    this.editAnnots(sel.page.id, `Duplicate ${describe(copy).toLowerCase()}`, (list) => [...list, copy]);
    this.viewer.selectAnnot({ pageId: sel.page.id, id: copy.id });
    void tick().then(() => focusObject(copy.id));
  }

  /** Can the object move further to the front (or back) among the objects on its page? */
  canReorder(pageId: string, id: string, to: 'front' | 'back') {
    const list = this.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
    const i = list.findIndex((a) => a.id === id);
    return i >= 0 && (to === 'front' ? i < list.length - 1 : i > 0);
  }

  /** Stack the object above (or below) every other object on its page. */
  reorderAnnotation(pageId: string, id: string, to: 'front' | 'back') {
    const found = this.findAnnot(pageId, id);
    if (!found || !this.canReorder(pageId, id, to)) return;
    const what = describe(found.annot).toLowerCase();
    this.editAnnots(pageId, to === 'front' ? `Bring ${what} to front` : `Send ${what} to back`, (list) => {
      const rest = list.filter((a) => a.id !== id);
      return to === 'front' ? [...rest, found.annot] : [found.annot, ...rest];
    });
  }

  /** Paste onto the current page, offset so the copy is visible next to the original. */
  pasteAnnotation() {
    const page = this.doc.pages[this.viewer.currentIndex];
    if (!annotClipboard || !page) return;
    const copy = { ...translate(annotClipboard, 12, -12), id: newAnnotationId() };
    annotClipboard = copy;
    this.editAnnots(page.id, `Paste ${describe(copy).toLowerCase()}`, (list) => [...list, copy]);
    this.viewer.setTool('select');
    this.viewer.selectAnnot({ pageId: page.id, id: copy.id });
    // The new object is selected: focus goes to it, so arrow keys and Delete act on it.
    void tick().then(() => focusObject(copy.id));
  }
}

const ACTIONS_KEY = Symbol('actions');

export function provideActions(a: Actions) {
  setContext(ACTIONS_KEY, a);
}

export function useActions(): Actions {
  return getContext<Actions>(ACTIONS_KEY);
}
