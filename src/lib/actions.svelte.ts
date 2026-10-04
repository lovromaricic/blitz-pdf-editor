// Document actions. Each feature is implemented once here and invoked from
// menus, the thumbnail context menu, keyboard shortcuts and panels alike.
import { getContext, setContext } from 'svelte';
import { describe, newAnnotationId, translate, type Annotation } from './annotations';
import { baseName, loadFiles, newPageId, type EditorDocument, type PageRef } from './document.svelte';
import { confirmDiscard, promptText } from './dialogs.svelte';
import { downloadBytes, downloadZip, pdfFileName } from './download';
import { readPdfFiles, type OpenFile } from './files';
import { askPassword } from './open-files.svelte';
import { deletePages, formatPageRange, insertPages, movePages, rotatePages } from './page-ops';
import { blankPdf } from './pdf/blank';
import { documentText, printDocument } from './print';
import { canvasToBlob, createRasterizer } from './rasterize';
import { analyzeSources, compressSources, imagesToPdfInWorker, writePdf, writePdfs } from './pdf/pdf-writer';
import type { CompressLevel } from './pdf/compress';
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
    this.doc.edit(`Delete ${this.plural(pages.length, 'page')}`, deletePages(this.doc.pages, this.ids(pages)));
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

  async save(fileName = this.doc.fileName, markSaved = true) {
    const bytes = await this.viewer.runTask('Saving…', () => writePdf(this.doc, this.doc.pages, 'preserve'));
    if (!bytes) return false;
    downloadBytes(bytes, fileName);
    if (markSaved) this.doc.markSaved();
    this.viewer.notify(`Saved ${fileName} to your downloads.${this.passwordNote()}`);
    return true;
  }

  async saveCopy() {
    const suggested = `${baseName(this.doc.fileName)} (copy).pdf`;
    const name = await promptText('Save a copy', 'File name', suggested, 'Save');
    if (name === null) return false;
    return this.save(pdfFileName(name, suggested), false);
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
        ? `Saved ${fileName}, but no text was found. This looks like a scanned document; text recognition (OCR) comes in a later version.`
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

  /** Compress the document's files (undoable). Returns sizes before and after. */
  async compress(level: CompressLevel) {
    const ids = this.usedFileIds();
    const before = ids.reduce((n, id) => n + this.doc.sources.get(id)!.size, 0);
    return this.viewer.runTask('Compressing…', async (progress) => {
      const files = await compressSources(this.doc, ids, level, (done, total) => progress(done / total));
      const remap = new Map<string, string>();
      let after = 0;
      for (let i = 0; i < ids.length; i++) {
        const old = this.doc.sources.get(ids[i])!;
        // Keep the original where compression didn't help.
        if (files[i].length >= old.size) {
          after += old.size;
          continue;
        }
        remap.set(old.id, await this.doc.addReplacementSource(old, files[i], 'compressed'));
        after += files[i].length;
      }
      if (remap.size > 0) {
        this.doc.edit('Compress', this.doc.pages.map((p) => (remap.has(p.sourceId) ? { ...p, sourceId: remap.get(p.sourceId)! } : p)));
      }
      return { before, after };
    });
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

  // --- Forms ----------------------------------------------------------------

  canFlatten() {
    return this.doc.hasForms && this.doc.pages.some((p) => !p.flattenForm && this.doc.source(p).hasForm);
  }

  /** Mark form fields for flattening on save (undoable until then). */
  flattenForms() {
    if (!this.canFlatten()) return;
    this.doc.edit('Flatten form', this.doc.pages.map((p) => (p.flattenForm || !this.doc.source(p).hasForm ? p : { ...p, flattenForm: true })));
    this.viewer.notify('The form will be flattened when you save. Until then you can undo with Ctrl+Z.');
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

  /** Replace an annotation. Pass `coalesceKey` for continuous edits (sliders, nudges). */
  updateAnnotation(pageId: string, annot: Annotation, label = `Edit ${describe(annot).toLowerCase()}`, coalesceKey?: string) {
    this.editAnnots(pageId, label, (list) => list.map((a) => (a.id === annot.id ? annot : a)), coalesceKey);
  }

  deleteAnnotation(pageId: string, id: string) {
    const found = this.findAnnot(pageId, id);
    if (!found) return;
    this.editAnnots(pageId, `Delete ${describe(found.annot).toLowerCase()}`, (list) => list.filter((a) => a.id !== id));
    if (this.viewer.selectedAnnot?.id === id) this.viewer.selectedAnnot = null;
  }

  copyAnnotation() {
    const sel = this.selectedAnnot;
    if (sel) annotClipboard = sel.annot;
  }

  cutAnnotation() {
    const sel = this.selectedAnnot;
    if (!sel) return;
    annotClipboard = sel.annot;
    this.deleteAnnotation(sel.page.id, sel.annot.id);
  }

  canPaste() {
    return annotClipboard !== null && this.doc.pages.length > 0;
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
  }
}

const ACTIONS_KEY = Symbol('actions');

export function provideActions(a: Actions) {
  setContext(ACTIONS_KEY, a);
}

export function useActions(): Actions {
  return getContext<Actions>(ACTIONS_KEY);
}
