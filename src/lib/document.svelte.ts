// The open document. Pages are references into one or more source PDFs, so
// reordering, rotating, merging and inserting only touch this list; the
// actual PDF bytes are produced on save.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OpenFile, RejectedFile } from './files';
import { loadPdf, PdfLoadError } from './pdf/pdfjs';

export interface Source {
  id: string;
  name: string;
  size: number;
  /** Original file bytes, untouched. Needed later to write the edited PDF. */
  bytes: Uint8Array;
  password?: string;
  pdf: PDFDocumentProxy;
}

export interface PageRef {
  id: string;
  sourceId: string;
  /** 0-based page index inside the source. */
  sourceIndex: number;
  /** Rotation added by the user, in degrees (multiple of 90), on top of the page's own /Rotate. */
  rotation: number;
  /** Page size in points as the source displays it (its own /Rotate applied, user rotation not). */
  width: number;
  height: number;
}

export interface DocInfo {
  title?: string;
  author?: string;
  pdfVersion?: string;
}

/** Return null to cancel. `retry` is true after a wrong password. */
export type AskPassword = (fileName: string, retry: boolean) => Promise<string | null>;

let nextPageId = 0;

export class EditorDocument {
  name = $state('');
  pages = $state<PageRef[]>([]);
  info = $state<DocInfo>({});
  readonly sources = new Map<string, Source>();

  get totalSize() {
    let n = 0;
    for (const s of this.sources.values()) n += s.size;
    return n;
  }

  source(page: PageRef): Source {
    return this.sources.get(page.sourceId)!;
  }

  /** Displayed size in points, user rotation included. */
  displaySize(page: PageRef) {
    return page.rotation % 180 === 0
      ? { width: page.width, height: page.height }
      : { width: page.height, height: page.width };
  }

  async addSource(file: OpenFile, askPassword: AskPassword): Promise<PageRef[]> {
    const { pdf, password } = await openWithPassword(file, askPassword);
    const source: Source = { id: file.id, name: file.name, size: file.size, bytes: file.bytes, password, pdf };
    this.sources.set(source.id, source);

    // Use page 1's size for every page so the layout can render immediately,
    // then fill in real sizes in the background.
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const refs: PageRef[] = Array.from({ length: pdf.numPages }, (_, i) => ({
      id: `page-${++nextPageId}`,
      sourceId: source.id,
      sourceIndex: i,
      rotation: 0,
      width: first.width,
      height: first.height,
    }));
    return refs;
  }

  /** Resolve true page sizes for pages that were given a provisional size. */
  async measurePages(refs: PageRef[]) {
    const BATCH = 50;
    for (let start = 1; start < refs.length; start += BATCH) {
      const batch = refs.slice(start, start + BATCH);
      const sizes = await Promise.all(
        batch.map(async (ref) => {
          const page = await this.source(ref).pdf.getPage(ref.sourceIndex + 1);
          const vp = page.getViewport({ scale: 1 });
          return { id: ref.id, width: vp.width, height: vp.height };
        }),
      );
      for (const s of sizes) {
        const p = this.pages.find((x) => x.id === s.id);
        if (p && (p.width !== s.width || p.height !== s.height)) {
          p.width = s.width;
          p.height = s.height;
        }
      }
    }
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

export interface OpenResult {
  doc: EditorDocument | null;
  rejected: RejectedFile[];
}

/** Open one or more files as a single document, pages in file order. */
export async function openDocument(files: OpenFile[], askPassword: AskPassword): Promise<OpenResult> {
  const doc = new EditorDocument();
  const rejected: RejectedFile[] = [];
  const pages: PageRef[] = [];

  for (const file of files) {
    try {
      pages.push(...(await doc.addSource(file, askPassword)));
    } catch (e) {
      rejected.push({ name: file.name, reason: e instanceof Error ? e.message : 'The PDF could not be opened.' });
    }
  }

  if (pages.length === 0) {
    await doc.destroy();
    return { doc: null, rejected };
  }

  const opened = files.filter((f) => doc.sources.has(f.id));
  doc.name = opened.length === 1 ? opened[0].name : `${opened[0].name} + ${opened.length - 1} more`;
  doc.pages = pages;
  void doc.measurePages(doc.pages);
  void doc.loadInfo();
  return { doc, rejected };
}
