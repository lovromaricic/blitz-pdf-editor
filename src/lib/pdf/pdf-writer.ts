// Main-thread client for the PDF worker.
import type { EditorDocument, PageRef } from '../document.svelte';
import type { AssembleMode, PagePlan } from './assemble';
import type { AssembleRequest, WorkerResponse } from './pdf-worker';
import { FONT_URLS } from '../fonts';
import { changedFieldValues, type FieldValue } from '../forms';

let worker: Worker | null = null;
let nextId = 0;

function getWorker() {
  worker ??= new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module', name: 'pdf-writer' });
  return worker;
}

export function planFor(pages: readonly PageRef[]): PagePlan[] {
  return pages.map((p) => ({
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
  const forms: Record<string, FieldValue[]> = {};
  for (const id of used) {
    const values = await changedFieldValues(doc.sources.get(id)!.pdf);
    if (values.length) forms[id] = values;
  }
  const flatten = [...new Set(outputs.flat().filter((p) => p.flattenForm).map((p) => p.sourceId))];

  const sources = [...doc.sources.values()]
    .filter((s) => used.has(s.id))
    // Structured clone copies the bytes, so the originals stay with us.
    .map((s) => ({ id: s.id, bytes: s.bytes, password: s.password }));

  const id = ++nextId;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total);
        return;
      }
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (msg.type === 'done') resolve(msg.files);
      else reject(new Error(msg.message));
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'The PDF writer stopped unexpectedly (the file may be too large for this device).'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    const req: AssembleRequest = { id, sources, outputs: outputs.map(planFor), mode, fontUrls: FONT_URLS, forms, flatten };
    w.postMessage(req);
  });
}

export function writePdf(doc: EditorDocument, pages: readonly PageRef[], mode: AssembleMode): Promise<Uint8Array> {
  return writePdfs(doc, [pages], mode).then((files) => files[0]);
}
