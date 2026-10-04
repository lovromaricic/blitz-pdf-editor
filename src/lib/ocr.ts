// Text recognition (OCR) with Tesseract, entirely on this device. The engine,
// worker and language data are served from the app itself (never a CDN), and
// nothing is cached in browser storage.
import { AnnotationMode } from 'pdfjs-dist';
import type { EditorDocument, PageRef } from './document.svelte';
import type { OcrWord } from './pdf/ocr-text';
import { viewportFor } from './pdf/render';

export type OcrLanguage = 'eng' | 'hrv';

export const OCR_LANGUAGES: { id: OcrLanguage; label: string }[] = [
  { id: 'eng', label: 'English' },
  { id: 'hrv', label: 'Croatian' },
];

/** Scans are recognised at this resolution: a good balance of accuracy and speed. */
const OCR_DPI = 300;

/** Pages with fewer characters than this count as "no text" (likely scans). */
const MIN_TEXT = 20;

const assets = () => new URL(`${import.meta.env.BASE_URL}tesseract/`, document.baseURI).href;

/** Pages that look like scans: no real text layer. */
export async function pagesWithoutText(doc: EditorDocument, pages: readonly PageRef[]): Promise<PageRef[]> {
  const out: PageRef[] = [];
  for (const page of pages) {
    const pdfPage = await doc.source(page).pdf.getPage(page.sourceIndex + 1);
    const content = await pdfPage.getTextContent();
    const chars = content.items.reduce((n, it) => n + ('str' in it ? it.str.trim().length : 0), 0);
    if (chars < MIN_TEXT) out.push(page);
  }
  return out;
}

/**
 * Recognise text on the given pages. Returns words per page, in each page's
 * PDF user space. Stops early (throwing) when `signal` aborts.
 */
export async function recognizePages(
  doc: EditorDocument,
  pages: readonly PageRef[],
  languages: OcrLanguage[],
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<Map<PageRef, OcrWord[]>> {
  const { createWorker, OEM } = await import('tesseract.js');
  let pageProgress = 0;
  let done = 0;
  const report = () => onProgress((done + pageProgress) / pages.length);
  const base = assets();
  // A plain array: reactive (proxied) values can't be posted to the OCR worker.
  const worker = await createWorker([...languages], OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    gzip: true,
    workerBlobURL: false,
    // Don't keep language data in IndexedDB: nothing is stored.
    cacheMethod: 'none',
    logger: (m) => {
      if (m.status === 'recognizing text') {
        pageProgress = m.progress;
        report();
      }
    },
  });
  const stop = () => void worker.terminate();
  signal.addEventListener('abort', stop);

  const results = new Map<PageRef, OcrWord[]>();
  try {
    for (const page of pages) {
      signal.throwIfAborted();
      const pdfPage = await doc.source(page).pdf.getPage(page.sourceIndex + 1);
      // As displayed (rotation included), so text is upright for the engine.
      const viewport = viewportFor(pdfPage, OCR_DPI / 72, page.rotation);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      // 'print' intent renders without waiting for animation frames, so OCR keeps
      // going while the tab is in the background.
      await pdfPage.render({ canvas, viewport, intent: 'print', annotationMode: AnnotationMode.DISABLE }).promise;
      signal.throwIfAborted();

      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      canvas.width = canvas.height = 0;

      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const b = line.baseline;
            const slope = b.x1 !== b.x0 ? (b.y1 - b.y0) / (b.x1 - b.x0) : 0;
            for (const w of line.words) {
              if (!w.text.trim() || w.confidence < 30) continue;
              // Baseline under this word, in rendered pixels.
              const y0 = b.y0 + slope * (w.bbox.x0 - b.x0);
              const y1 = b.y0 + slope * (w.bbox.x1 - b.x0);
              const [px0, py0] = viewport.convertToPdfPoint(w.bbox.x0, y0);
              const [px1, py1] = viewport.convertToPdfPoint(w.bbox.x1, y1);
              words.push({
                text: w.text,
                x: px0,
                y: py0,
                width: Math.hypot(px1 - px0, py1 - py0),
                height: (w.bbox.y1 - w.bbox.y0) / viewport.scale,
                angle: (Math.atan2(py1 - py0, px1 - px0) * 180) / Math.PI,
              });
            }
          }
        }
      }
      results.set(page, words);
      done++;
      pageProgress = 0;
      report();
    }
  } finally {
    signal.removeEventListener('abort', stop);
    await worker.terminate().catch(() => {});
  }
  return results;
}
