// Web Worker for editing a PDF's original content: analyzing pages (text
// blocks and images) and deleting some of them, which writes a new version of
// the file. Keeps each file it was given (by source id) until told to forget
// it, so a page can be analyzed without sending the whole file again.
import { PDFDocument } from '@cantoo/pdf-lib';
import { analyzePage, ContentEditError, deleteItems, type DeleteResult, type PageAnalysis } from './content/edit';
import { collectGarbage } from './gc';

export type ContentRequest =
  | { id: number; kind: 'open'; sourceId: string; bytes: Uint8Array; password?: string }
  | { id: number; kind: 'analyze'; sourceId: string; page: number }
  | { id: number; kind: 'delete'; sourceId: string; page: number; ids: string[]; newSourceId: string }
  | { id: number; kind: 'forget'; sourceId: string };

export type ContentResponse =
  | { id: number; ok: true; analysis?: PageAnalysis; bytes?: Uint8Array; result?: DeleteResult }
  | { id: number; ok: false; message: string; user: boolean; unknownSource?: boolean };

interface Held {
  bytes: Uint8Array;
  password?: string;
  /** Loaded once for analysis (never changed). */
  doc?: Promise<PDFDocument>;
}

const held = new Map<string, Held>();

const load = (h: Held) => PDFDocument.load(h.bytes, { updateMetadata: false, password: h.password ?? '' });

const post = (msg: ContentResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ContentRequest>) => {
  const req = e.data;
  try {
    switch (req.kind) {
      case 'open':
        held.set(req.sourceId, { bytes: req.bytes, password: req.password });
        return post({ id: req.id, ok: true });
      case 'forget':
        held.delete(req.sourceId);
        return post({ id: req.id, ok: true });
      case 'analyze': {
        const h = held.get(req.sourceId);
        if (!h) return post({ id: req.id, ok: false, message: 'unknown source', user: false, unknownSource: true });
        h.doc ??= load(h);
        const doc = await h.doc;
        return post({ id: req.id, ok: true, analysis: analyzePage(doc, req.page) });
      }
      case 'delete': {
        const h = held.get(req.sourceId);
        if (!h) return post({ id: req.id, ok: false, message: 'unknown source', user: false, unknownSource: true });
        // A fresh copy: the one used for analysis stays as it was (undo goes back to it).
        const doc = await load(h);
        const result = deleteItems(doc, req.page, req.ids);
        collectGarbage(doc);
        const bytes = await doc.save();
        held.set(req.newSourceId, { bytes });
        const copy = bytes.slice();
        return post({ id: req.id, ok: true, bytes: copy, result }, [copy.buffer]);
      }
    }
  } catch (err) {
    const user = err instanceof ContentEditError;
    post({ id: req.id, ok: false, message: user ? (err as Error).message : String((err as Error)?.message ?? err), user });
  }
};
