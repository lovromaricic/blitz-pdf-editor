// Main-thread client for the PDF worker.
import type { EditorDocument, PageRef } from '../document.svelte';
import type { AssembleMode, PagePlan, RedactedPage } from './assemble';
import type { CancelRequest, Job, JobRequest, WorkerResponse } from './pdf-worker';
import type { Analysis, CompressSettings } from './compress';
import type { ImageInput, ImagesToPdfOptions } from './images-to-pdf';
import type { OcrWord } from './ocr-text';
import { FONT_URLS } from '../fonts';
import { changedFieldValues, type FieldValue } from '../forms';
import type { Rgb } from '../annotations';
import type { PageDecoration } from '../decorations';
import { pageNumberLabels, watermarkApplies } from '../settings';

let worker: Worker | null = null;
let nextId = 0;

function getWorker() {
  worker ??= new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module', name: 'pdf-writer' });
  return worker;
}

/** Watermark and page number for each page, from the document settings. */
export function decorationResolver(doc: EditorDocument) {
  const { watermark, pageNumbers } = doc.settings;
  const labels = pageNumbers ? pageNumberLabels(doc.pages.map((p) => p.id), pageNumbers) : new Map<string, string>();
  return (page: PageRef): PageDecoration | undefined => {
    const deco: PageDecoration = {};
    if (watermark && watermarkApplies(watermark, page.id)) {
      const { text, size, color, opacity, angle } = watermark;
      deco.watermark = { text, size, color: [...color] as Rgb, opacity, angle };
    }
    const label = labels.get(page.id);
    if (label && pageNumbers) deco.number = { text: label, size: pageNumbers.size, position: pageNumbers.position };
    return deco.watermark || deco.number ? deco : undefined;
  };
}

export function planFor(pages: readonly PageRef[], decoFor: (p: PageRef) => PageDecoration | undefined = () => undefined): PagePlan[] {
  return pages.map((p) => ({
    deco: decoFor(p),
    sourceId: p.sourceId,
    index: p.sourceIndex,
    rotation: p.rotation,
    crop: p.crop && { ...p.crop },
    // Plain JSON data only: anything reactive can't cross into the worker.
    annots: p.annots && (JSON.parse(JSON.stringify(p.annots)) as typeof p.annots),
  }));
}

/** Build one PDF per page list. `onProgress` reports finished outputs. */
export async function writePdfs(
  doc: EditorDocument,
  outputs: (readonly PageRef[])[],
  mode: AssembleMode,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  const used = new Set(outputs.flatMap((pages) => pages.map((p) => p.sourceId)));
  // Form values typed in the editor, and which files have their forms flattened.
  const forms = await formValues(doc, used);
  const flatten = [...new Set(outputs.flat().filter((p) => p.flattenForm).map((p) => p.sourceId))];

  // Structured clone copies the bytes, so the originals stay with us.
  const sources = sourceInputs(doc, used);

  const decoFor = decorationResolver(doc);
  const protection = doc.settings.protection;
  const result = await runJob(
    {
      kind: 'assemble',
      sources,
      outputs: outputs.map((pages) => planFor(pages, decoFor)),
      mode,
      forms,
      flatten,
      encrypt: protection && { ...protection },
    },
    onProgress,
  );
  return result.files;
}

/** Run a job in the PDF worker. Aborting `signal` asks the worker to stop and rejects with its reason. */
function runJob(
  job: Job,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ files: Uint8Array[]; analyses?: Analysis[]; sizes?: number[] }> {
  const id = ++nextId;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.postMessage({ kind: 'cancel', id } satisfies CancelRequest);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total);
        return;
      }
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (msg.type === 'done') resolve({ files: msg.files, analyses: msg.analyses, sizes: msg.sizes });
      else reject(new Error(msg.message));
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'The PDF engine stopped unexpectedly (the file may be too large for this device).'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    const req = { ...job, id, fontUrls: FONT_URLS } as JobRequest;
    w.postMessage(req);
  });
}

/** Form values typed in each source (plain data). */
async function formValues(doc: EditorDocument, ids: Iterable<string>) {
  const forms: Record<string, FieldValue[]> = {};
  for (const id of ids) {
    const values = await changedFieldValues(doc.sources.get(id)!.pdf);
    if (values.length) forms[id] = values;
  }
  return forms;
}

function sourceInputs(doc: EditorDocument, ids: Iterable<string>) {
  const want = new Set(ids);
  return [...doc.sources.values()].filter((s) => want.has(s.id)).map((s) => ({ id: s.id, bytes: s.bytes, password: s.password }));
}

export async function addOcrText(doc: EditorDocument, sourceId: string, words: Record<number, OcrWord[]>) {
  const [source] = sourceInputs(doc, [sourceId]);
  const forms = (await formValues(doc, [sourceId]))[sourceId] ?? [];
  return (await runJob({ kind: 'ocrText', source, words, forms })).files[0];
}

export async function redactInWorker(doc: EditorDocument, sourceId: string, pages: RedactedPage[], removeInfo: boolean) {
  const [source] = sourceInputs(doc, [sourceId]);
  const forms = (await formValues(doc, [sourceId]))[sourceId] ?? [];
  return (await runJob({ kind: 'redact', source, pages, forms, removeInfo })).files[0];
}

export async function imagesToPdfInWorker(images: ImageInput[], options: ImagesToPdfOptions, onProgress?: (done: number, total: number) => void) {
  return (await runJob({ kind: 'images', images, options }, onProgress)).files[0];
}

export async function analyzeSources(doc: EditorDocument, ids: string[]) {
  return (await runJob({ kind: 'analyze', sources: sourceInputs(doc, ids) })).analyses!;
}

export async function compressSources(
  doc: EditorDocument,
  ids: string[],
  settings: CompressSettings,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
) {
  const forms = await formValues(doc, ids);
  return (await runJob({ kind: 'compress', sources: sourceInputs(doc, ids), settings: { ...settings }, forms }, onProgress, signal)).files;
}

/** Estimated total size of the files for each settings (re-encodes images in the worker). */
export async function estimateCompression(
  doc: EditorDocument,
  ids: string[],
  settings: CompressSettings[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
) {
  const plain = settings.map((s) => ({ quality: s.quality, dpi: s.dpi }));
  return (await runJob({ kind: 'estimate', sources: sourceInputs(doc, ids), settings: plain }, onProgress, signal)).sizes!;
}

export function writePdf(doc: EditorDocument, pages: readonly PageRef[], mode: AssembleMode): Promise<Uint8Array> {
  return writePdfs(doc, [pages], mode).then((files) => files[0]);
}
