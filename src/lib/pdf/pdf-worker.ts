// Web Worker for heavy PDF work (save, extract, split, images to PDF,
// compress, OCR text, redaction), off the UI thread.
import {
  addOcrToSource,
  analyzeSource,
  assemble,
  compressSource,
  estimateSource,
  redactSource,
  UserError,
  type RedactedPage,
  type AssembleMode,
  type Encryption,
  type PagePlan,
  type SourceInput,
} from './assemble';
import { CompressCancelled, type Analysis, type CompressSettings } from './compress';
import type { OcrWord } from './ocr-text';
import { createFontProvider } from './font-provider';
import { imagesToPdf, type ImageInput, type ImagesToPdfOptions } from './images-to-pdf';
import { newBlankPdf } from './new-blank';
import type { FontKey } from './write-annotations';
import { registerLocalFonts, type FontInfo } from '../font-catalog';
import type { FieldValue } from '../forms';
import type { ImageAsset } from '../image-store';

export type Job =
  | {
      kind: 'assemble';
      sources: SourceInput[];
      outputs: PagePlan[][];
      mode: AssembleMode;
      forms: Record<string, FieldValue[]>;
      flatten: string[];
      images: Record<string, ImageAsset>;
      encrypt?: Encryption;
    }
  | { kind: 'images'; images: ImageInput[]; options: ImagesToPdfOptions }
  | { kind: 'blank'; width: number; height: number; pages: number }
  | { kind: 'compress'; sources: SourceInput[]; settings: CompressSettings; forms: Record<string, FieldValue[]> }
  | { kind: 'estimate'; sources: SourceInput[]; settings: CompressSettings[] }
  | { kind: 'analyze'; sources: SourceInput[] }
  | { kind: 'ocrText'; source: SourceInput; words: Record<number, OcrWord[]>; forms: FieldValue[] }
  | { kind: 'redact'; source: SourceInput; pages: RedactedPage[]; forms: FieldValue[]; removeInfo: boolean };

export type JobRequest = Job & { id: number; fontUrls: Record<FontKey, string>; localFonts: FontInfo[] };

/** Stop a running job (compress and estimate check between images). */
export interface CancelRequest {
  kind: 'cancel';
  id: number;
}

export type WorkerResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; files: Uint8Array[]; analyses?: Analysis[]; sizes?: number[] }
  | { id: number; type: 'error'; message: string };

let fontUrls: Record<FontKey, string> | null = null;
const fonts = createFontProvider(async (key) => {
  let res: Response;
  try {
    res = await fetch(fontUrls![key]);
  } catch {
    throw new UserError('Could not load the font needed for text. Check your connection and try again.');
  }
  if (!res.ok) throw new UserError(`Could not load the font needed for text (error ${res.status}). Check your connection and try again.`);
  return new Uint8Array(await res.arrayBuffer());
});

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

const cancelled = new Set<number>();

async function run(
  job: JobRequest,
  progress: (done: number, total: number) => void,
): Promise<{ files: Uint8Array[]; analyses?: Analysis[]; sizes?: number[] }> {
  const stopped = () => cancelled.has(job.id);
  switch (job.kind) {
    case 'assemble': {
      const files: Uint8Array[] = [];
      for (let i = 0; i < job.outputs.length; i++) {
        // Only send the sources each output needs.
        const used = new Set(job.outputs[i].map((p) => p.sourceId));
        const options = { fonts, forms: job.forms, flatten: job.flatten, images: job.images, encrypt: job.encrypt };
        files.push(await assemble(job.sources.filter((s) => used.has(s.id)), job.outputs[i], job.mode, options));
        progress(i + 1, job.outputs.length);
      }
      return { files };
    }
    case 'blank':
      return { files: [await newBlankPdf(job.width, job.height, job.pages)] };
    case 'images':
      return { files: [await imagesToPdf(job.images, job.options, (done) => progress(done, job.images.length))] };
    case 'compress': {
      const files: Uint8Array[] = [];
      for (let i = 0; i < job.sources.length; i++) {
        const src = job.sources[i];
        files.push(
          await compressSource(src, job.settings, job.forms[src.id] ?? [], fonts, {
            stopped,
            onProgress: (done, total) => progress(i + done / Math.max(1, total), job.sources.length),
          }),
        );
      }
      return { files };
    }
    case 'estimate': {
      // Summed over all files, one size per settings.
      const sizes = job.settings.map(() => 0);
      for (let i = 0; i < job.sources.length; i++) {
        const each = await estimateSource(job.sources[i], job.settings, {
          stopped,
          onProgress: (done, total) => progress(i + done / Math.max(1, total), job.sources.length),
        });
        each.forEach((n, k) => (sizes[k] += n));
      }
      return { files: [], sizes };
    }
    case 'analyze':
      return { files: [], analyses: await Promise.all(job.sources.map(analyzeSource)) };
    case 'ocrText':
      return { files: [await addOcrToSource(job.source, job.words, job.forms, fonts)] };
    case 'redact':
      return { files: [await redactSource(job.source, job.pages, job.forms, fonts, job.removeInfo)] };
  }
}

self.onmessage = async (e: MessageEvent<JobRequest | CancelRequest>) => {
  if (e.data.kind === 'cancel') {
    cancelled.add(e.data.id);
    return;
  }
  const job = e.data;
  fontUrls = job.fontUrls;
  // Fonts from the user's computer: which styles they have (their files come as blob: URLs).
  registerLocalFonts(job.localFonts);
  try {
    const result = await run(job, (done, total) => post({ id: job.id, type: 'progress', done, total }));
    post({ id: job.id, type: 'done', ...result }, result.files.map((f) => f.buffer as ArrayBuffer));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Our own errors are written for people; anything from the PDF libraries is not.
    const message = err instanceof CompressCancelled
      ? 'Cancelled.'
      : err instanceof UserError
      ? detail
      : err instanceof RangeError
        ? 'This device ran out of memory while writing the PDF. Close other tabs, or try with fewer pages.'
        : `This PDF couldn't be written: part of the file is damaged in a way this app can't repair. ` +
          `Tip: use File › Print and choose "Save as PDF" to get a clean copy. (Details: ${detail})`;
    post({ id: job.id, type: 'error', message });
  } finally {
    cancelled.delete(job.id);
  }
};
