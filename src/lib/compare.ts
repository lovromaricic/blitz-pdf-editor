// Compare two PDFs: collects the words of each side and diffs them in a worker.
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { wordsOf, type Hunk, type Word } from './compare-diff';
import { viewportFor } from './pdf/render';

/** One page shown in Compare: a page of a loaded PDF, with any extra rotation. */
export interface ComparePage {
  pdf: PDFDocumentProxy;
  /** 0-based page index in `pdf`. */
  index: number;
  rotation: number;
}

/** Words of all pages, and each page's viewport at 100% (for layout and highlights). */
export async function readPages(pages: readonly ComparePage[], signal: AbortSignal, onPage?: () => void) {
  const words: Word[] = [];
  const viewports: PageViewport[] = [];
  for (let i = 0; i < pages.length; i++) {
    signal.throwIfAborted();
    const page = await pages[i].pdf.getPage(pages[i].index + 1);
    viewports.push(viewportFor(page, 1, pages[i].rotation));
    const content = await page.getTextContent();
    words.push(...wordsOf(content.items.filter((it): it is TextItem => 'str' in it), i));
    onPage?.();
  }
  return { words, viewports };
}

export function diffWords(a: readonly Word[], b: readonly Word[], signal: AbortSignal): Promise<Hunk[]> {
  const worker = new Worker(new URL('./compare-worker.ts', import.meta.url), { type: 'module', name: 'compare' });
  return new Promise<Hunk[]>((resolve, reject) => {
    const stop = () => {
      worker.terminate();
      reject(signal.reason);
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.onmessage = (e: MessageEvent<Hunk[]>) => resolve(e.data);
    worker.onerror = (e) => reject(new Error(e.message || 'The comparison stopped unexpectedly (the files may be too large for this device).'));
    worker.postMessage({ a: a.map((w) => w.text), b: b.map((w) => w.text) });
  }).finally(() => worker.terminate());
}
