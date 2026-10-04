// Web Worker for heavy PDF writing (save, extract, split), off the UI thread.
import { assemble, SourceOpenError, type AssembleMode, type PagePlan, type SourceInput } from './assemble';
import { createFontProvider } from './font-provider';
import type { FontKey } from './write-annotations';
import type { FieldValue } from '../forms';

export interface AssembleRequest {
  id: number;
  sources: SourceInput[];
  outputs: PagePlan[][];
  mode: AssembleMode;
  /** Where to fetch fonts from, if text needs embedding. */
  fontUrls: Record<FontKey, string>;
  forms: Record<string, FieldValue[]>;
  flatten: string[];
}

export type WorkerResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; files: Uint8Array[] }
  | { id: number; type: 'error'; message: string };

let fontUrls: Record<FontKey, string> | null = null;
const fonts = createFontProvider(async (key) => {
  const res = await fetch(fontUrls![key]);
  if (!res.ok) throw new Error(`Could not load the font for text (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
});

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<AssembleRequest>) => {
  const { id, sources, outputs, mode, forms, flatten } = e.data;
  fontUrls = e.data.fontUrls;
  try {
    const files: Uint8Array[] = [];
    for (let i = 0; i < outputs.length; i++) {
      // Only send the sources each output needs.
      const used = new Set(outputs[i].map((p) => p.sourceId));
      files.push(await assemble(sources.filter((s) => used.has(s.id)), outputs[i], mode, { fonts, forms, flatten }));
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
