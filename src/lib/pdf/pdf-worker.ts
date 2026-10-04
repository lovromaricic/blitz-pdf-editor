// Web Worker for heavy PDF writing (save, extract, split), off the UI thread.
import { assemble, SourceOpenError, type AssembleMode, type PagePlan, type SourceInput } from './assemble';

export interface AssembleRequest {
  id: number;
  sources: SourceInput[];
  outputs: PagePlan[][];
  mode: AssembleMode;
}

export type WorkerResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; files: Uint8Array[] }
  | { id: number; type: 'error'; message: string };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<AssembleRequest>) => {
  const { id, sources, outputs, mode } = e.data;
  try {
    const files: Uint8Array[] = [];
    for (let i = 0; i < outputs.length; i++) {
      // Only send the sources each output needs.
      const used = new Set(outputs[i].map((p) => p.sourceId));
      files.push(await assemble(sources.filter((s) => used.has(s.id)), outputs[i], mode));
      post({ id, type: 'progress', done: i + 1, total: outputs.length });
    }
    post({ id, type: 'done', files }, files.map((f) => f.buffer as ArrayBuffer));
  } catch (err) {
    const message =
      err instanceof SourceOpenError
        ? `A source file could not be read for saving (${err.message}).`
        : err instanceof Error
          ? err.message
          : String(err);
    post({ id, type: 'error', message });
  }
};
