// Web Worker for heavy PDF work (save, extract, split, images to PDF,
// compress, OCR text, redaction), off the UI thread.
import {
  addOcrToSource,
  analyzeSource,
  assemble,
  compressSource,
  redactSource,
  UserError,
  type RedactedPage,
  type AssembleMode,
  type Encryption,
  type PagePlan,
  type SourceInput,
} from './assemble';
import type { Analysis, CompressLevel } from './compress';
import type { OcrWord } from './ocr-text';
import { createFontProvider } from './font-provider';
import { imagesToPdf, type ImageInput, type ImagesToPdfOptions } from './images-to-pdf';
import type { FontKey } from './write-annotations';
import type { FieldValue } from '../forms';

export type Job =
  | {
      kind: 'assemble';
      sources: SourceInput[];
      outputs: PagePlan[][];
      mode: AssembleMode;
      forms: Record<string, FieldValue[]>;
      flatten: string[];
      encrypt?: Encryption;
    }
  | { kind: 'images'; images: ImageInput[]; options: ImagesToPdfOptions }
  | { kind: 'compress'; sources: SourceInput[]; level: CompressLevel; forms: Record<string, FieldValue[]> }
  | { kind: 'analyze'; sources: SourceInput[] }
  | { kind: 'ocrText'; source: SourceInput; words: Record<number, OcrWord[]>; forms: FieldValue[] }
  | { kind: 'redact'; source: SourceInput; pages: RedactedPage[]; forms: FieldValue[]; removeInfo: boolean };

export type JobRequest = Job & { id: number; fontUrls: Record<FontKey, string> };

export type WorkerResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; files: Uint8Array[]; analyses?: Analysis[] }
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

async function run(job: JobRequest, progress: (done: number, total: number) => void): Promise<{ files: Uint8Array[]; analyses?: Analysis[] }> {
  switch (job.kind) {
    case 'assemble': {
      const files: Uint8Array[] = [];
      for (let i = 0; i < job.outputs.length; i++) {
        // Only send the sources each output needs.
        const used = new Set(job.outputs[i].map((p) => p.sourceId));
        const options = { fonts, forms: job.forms, flatten: job.flatten, encrypt: job.encrypt };
        files.push(await assemble(job.sources.filter((s) => used.has(s.id)), job.outputs[i], job.mode, options));
        progress(i + 1, job.outputs.length);
      }
      return { files };
    }
    case 'images':
      return { files: [await imagesToPdf(job.images, job.options, (done) => progress(done, job.images.length))] };
    case 'compress': {
      const files: Uint8Array[] = [];
      for (let i = 0; i < job.sources.length; i++) {
        const src = job.sources[i];
        files.push(
          await compressSource(src, job.level, job.forms[src.id] ?? [], fonts, (done, total) =>
            progress(i + done / Math.max(1, total), job.sources.length),
          ),
        );
      }
      return { files };
    }
    case 'analyze':
      return { files: [], analyses: await Promise.all(job.sources.map(analyzeSource)) };
    case 'ocrText':
      return { files: [await addOcrToSource(job.source, job.words, job.forms, fonts)] };
    case 'redact':
      return { files: [await redactSource(job.source, job.pages, job.forms, fonts, job.removeInfo)] };
  }
}

self.onmessage = async (e: MessageEvent<JobRequest>) => {
  const job = e.data;
  fontUrls = job.fontUrls;
  try {
    const result = await run(job, (done, total) => post({ id: job.id, type: 'progress', done, total }));
    post({ id: job.id, type: 'done', ...result }, result.files.map((f) => f.buffer as ArrayBuffer));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Our own errors are written for people; anything from the PDF libraries is not.
    const message = err instanceof UserError
      ? detail
      : err instanceof RangeError
        ? 'This device ran out of memory while writing the PDF. Close other tabs, or try with fewer pages.'
        : `This PDF couldn't be written: part of the file is damaged in a way this app can't repair. ` +
          `Tip: use File › Print and choose "Save as PDF" to get a clean copy. (Details: ${detail})`;
    post({ id: job.id, type: 'error', message });
  }
};
