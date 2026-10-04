// The open document. Pages are references into one or more source PDFs, so
// reordering, rotating, merging and inserting only touch this list; the
// actual PDF bytes are produced on save.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { SvelteMap } from 'svelte/reactivity';
import type { OpenFile, RejectedFile } from './files';
import { History } from './history.svelte';
import type { Annotation } from './annotations';
import { marginsToDisplayed, NO_MARGINS, type Margins } from './page-ops';
import { loadPdf, PdfLoadError } from './pdf/pdfjs';

export interface PageSize {
  width: number;
  height: number;
}

export class Source {
  /** Page sizes in points as the source displays them (its own /Rotate applied). */
  sizes = $state<PageSize[]>([]);
  /** Each page's own /Rotate, in degrees. */
  rotations = $state<number[]>([]);

  constructor(
    public id: string,
    public name: string,
    public size: number,
    /** Original file bytes, untouched. Used to write the edited PDF. */
    public bytes: Uint8Array,
    public pdf: PDFDocumentProxy,
    public password?: string,
    /** 'blank' sources are generated for inserted blank pages, not user files. */
    public kind: 'file' | 'blank' = 'file',
  ) {}
}

/**
 * One page of the document. Treated as immutable: edits replace objects,
 * which keeps undo snapshots cheap (they share unchanged pages).
 */
export interface PageRef {
  readonly id: string;
  readonly sourceId: string;
  /** 0-based page index inside the source. */
  readonly sourceIndex: number;
  /** Rotation added by the user, in degrees (0, 90, 180, 270), on top of the page's own /Rotate. */
  readonly rotation: number;
  /** Crop margins in points, in PDF user space (unrotated), relative to the page's crop box. */
  readonly crop?: Margins;
  /** Markup added in the editor, in PDF user space of the source page. */
  readonly annots?: readonly Annotation[];
}

export interface DocInfo {
  title?: string;
  author?: string;
  pdfVersion?: string;
}

/** Return null to cancel. `retry` is true after a wrong password. */
export type AskPassword = (fileName: string, retry: boolean) => Promise<string | null>;

let nextPageId = 0;
export function newPageId() {
  return `page-${++nextPageId}`;
}

export class EditorDocument {
  name = $state('');
  /** Suggested file name when saving. */
  fileName = $state('document.pdf');
  pages = $state.raw<readonly PageRef[]>([]);
  info = $state<DocInfo>({});
  readonly sources = new SvelteMap<string, Source>();
  readonly history = new History<readonly PageRef[]>();

  /** Files the user opened or inserted (not generated blank pages). */
  get files(): Source[] {
    return [...this.sources.values()].filter((s) => s.kind === 'file');
  }

  get totalSize() {
    return this.files.reduce((n, s) => n + s.size, 0);
  }

  get hasPasswordSources() {
    return this.files.some((s) => s.password !== undefined);
  }

  /** Unsaved changes since opening or the last save. */
  get dirty() {
    return this.history.dirty;
  }

  source(page: PageRef): Source {
    return this.sources.get(page.sourceId)!;
  }

  /** Total rotation shown on screen: the page's own /Rotate plus the user's. */
  totalRotation(page: PageRef) {
    return ((this.source(page).rotations[page.sourceIndex] ?? 0) + page.rotation) % 360;
  }

  /** Crop margins as they appear on screen (rotation applied), in points. */
  displayedCrop(page: PageRef): Margins {
    return page.crop ? marginsToDisplayed(page.crop, this.totalRotation(page)) : NO_MARGINS;
  }

  /** Displayed size in points before cropping, user rotation included. */
  fullDisplaySize(page: PageRef): PageSize {
    const s = this.source(page).sizes[page.sourceIndex] ?? { width: 612, height: 792 };
    return page.rotation % 180 === 0 ? s : { width: s.height, height: s.width };
  }

  /** Displayed size in points, user rotation and crop included. */
  displaySize(page: PageRef): PageSize {
    const full = this.fullDisplaySize(page);
    if (!page.crop) return full;
    const m = this.displayedCrop(page);
    return { width: Math.max(1, full.width - m.left - m.right), height: Math.max(1, full.height - m.top - m.bottom) };
  }

  /** Apply an undoable edit to the page list. */
  edit(label: string, next: readonly PageRef[], coalesceKey?: string) {
    if (next === this.pages) return;
    this.history.push(label, this.pages, coalesceKey);
    this.pages = next;
  }

  undo() {
    const prev = this.history.undo(this.pages);
    if (prev) this.pages = prev;
  }

  redo() {
    const next = this.history.redo(this.pages);
    if (next) this.pages = next;
  }

  markSaved() {
    this.history.markSaved();
  }

  /** Load a file as a new source and return refs to all its pages (not yet inserted). */
  async addSource(file: OpenFile, askPassword: AskPassword, kind: Source['kind'] = 'file'): Promise<PageRef[]> {
    const { pdf, password } = await openWithPassword(file, askPassword);
    const source = new Source(file.id, file.name, file.size, file.bytes, pdf, password, kind);
    this.sources.set(source.id, source);

    // Use page 1's size for every page so the layout can render immediately,
    // then fill in real sizes in the background.
    const firstPage = await pdf.getPage(1);
    const first = firstPage.getViewport({ scale: 1 });
    source.sizes = Array.from({ length: pdf.numPages }, () => ({ width: first.width, height: first.height }));
    source.rotations = Array.from({ length: pdf.numPages }, () => firstPage.rotate);
    void measureSource(source);

    return Array.from({ length: pdf.numPages }, (_, i) => ({
      id: newPageId(),
      sourceId: source.id,
      sourceIndex: i,
      rotation: 0,
    }));
  }

  async loadInfo() {
    const first = this.sources.values().next().value;
    if (!first) return;
    try {
      const meta = await first.pdf.getMetadata();
      const raw = meta.info as Record<string, unknown>;
      this.info = {
        title: typeof raw.Title === 'string' && raw.Title.trim() ? raw.Title : undefined,
        author: typeof raw.Author === 'string' && raw.Author.trim() ? raw.Author : undefined,
        pdfVersion: typeof raw.PDFFormatVersion === 'string' ? raw.PDFFormatVersion : undefined,
      };
    } catch {
      this.info = {};
    }
  }

  async destroy() {
    for (const s of this.sources.values()) await s.pdf.loadingTask.destroy().catch(() => {});
    this.sources.clear();
  }
}

async function measureSource(source: Source) {
  const BATCH = 50;
  const n = source.pdf.numPages;
  for (let start = 1; start < n; start += BATCH) {
    const indexes = Array.from({ length: Math.min(BATCH, n - start) }, (_, k) => start + k);
    try {
      const measured = await Promise.all(
        indexes.map(async (i) => {
          const page = await source.pdf.getPage(i + 1);
          const vp = page.getViewport({ scale: 1 });
          return { width: vp.width, height: vp.height, rotate: page.rotate };
        }),
      );
      const sizes = source.sizes.slice();
      const rotations = source.rotations.slice();
      let changed = false;
      measured.forEach((m, k) => {
        const i = indexes[k];
        if (sizes[i].width !== m.width || sizes[i].height !== m.height || rotations[i] !== m.rotate) {
          sizes[i] = { width: m.width, height: m.height };
          rotations[i] = m.rotate;
          changed = true;
        }
      });
      if (changed) {
        source.sizes = sizes;
        source.rotations = rotations;
      }
    } catch {
      return; // Document closed while measuring.
    }
  }
}

async function openWithPassword(file: OpenFile, askPassword: AskPassword) {
  let password: string | undefined;
  for (;;) {
    try {
      return { pdf: await loadPdf(file.bytes, password), password };
    } catch (e) {
      if (!(e instanceof PdfLoadError) || (e.kind !== 'password-required' && e.kind !== 'password-incorrect')) throw e;
      const answer = await askPassword(file.name, e.kind === 'password-incorrect');
      if (answer === null) throw new PdfLoadError('password-required', 'Opening was cancelled: no password given.');
      password = answer;
    }
  }
}

export interface LoadResult {
  pages: PageRef[];
  rejected: RejectedFile[];
}

/** Add files as sources of `doc`, returning their pages in file order. */
export async function loadFiles(doc: EditorDocument, files: OpenFile[], askPassword: AskPassword): Promise<LoadResult> {
  const pages: PageRef[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of files) {
    try {
      pages.push(...(await doc.addSource(file, askPassword)));
    } catch (e) {
      rejected.push({ name: file.name, reason: e instanceof Error ? e.message : 'The PDF could not be opened.' });
    }
  }
  return { pages, rejected };
}

export interface OpenResult {
  doc: EditorDocument | null;
  rejected: RejectedFile[];
}

/** Open one or more files as a single document, pages in file order. */
export async function openDocument(files: OpenFile[], askPassword: AskPassword): Promise<OpenResult> {
  const doc = new EditorDocument();
  const { pages, rejected } = await loadFiles(doc, files, askPassword);

  if (pages.length === 0) {
    await doc.destroy();
    return { doc: null, rejected };
  }

  const opened = files.filter((f) => doc.sources.has(f.id));
  doc.name = opened.length === 1 ? opened[0].name : `${opened[0].name} + ${opened.length - 1} more`;
  doc.fileName = opened.length === 1 ? opened[0].name : `${baseName(opened[0].name)}-merged.pdf`;
  doc.pages = pages;
  void doc.loadInfo();
  return { doc, rejected };
}

export function baseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '');
}
