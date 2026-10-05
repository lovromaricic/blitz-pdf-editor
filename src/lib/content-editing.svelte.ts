// Main-thread side of editing a PDF's original content: asks the content
// worker what's on a page (lazily, for pages being looked at; cached per
// version of the file) and to delete things, which returns a new version of
// the file. The originals are never changed, so undo goes back to them exactly.
import { SvelteMap } from 'svelte/reactivity';
import { PermissionFlag } from 'pdfjs-dist';
import type { Source } from './document.svelte';
import type { ContentRequest, ContentResponse } from './pdf/content-worker';
import type { DeleteResult, PageAnalysis } from './pdf/content/edit';

export type { ContentItem, PageAnalysis, DeleteResult } from './pdf/content/edit';

export class ContentEditError extends Error {}

/** A request without its id (distributes over the union). */
type Pending = ContentRequest extends infer R ? (R extends ContentRequest ? Omit<R, 'id'> : never) : never;

export class ContentEditing {
  private worker: Worker | null = null;
  private nextId = 0;
  private waiting = new Map<number, (r: ContentResponse) => void>();
  /** Sources the worker holds. */
  private opened = new Map<string, Promise<void>>();
  /** Page analyses by "sourceId:index": the result, or 'pending' / 'failed'. */
  private analyses = new SvelteMap<string, PageAnalysis | 'pending' | 'failed'>();

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./pdf/content-worker.ts', import.meta.url), { type: 'module', name: 'content' });
      this.worker.onmessage = (e: MessageEvent<ContentResponse>) => {
        this.waiting.get(e.data.id)?.(e.data);
        this.waiting.delete(e.data.id);
      };
      this.worker.onerror = () => {
        // The worker died (out of memory…): everything it held is gone.
        for (const done of this.waiting.values()) done({ id: -1, ok: false, message: 'The content engine stopped.', user: false });
        this.waiting.clear();
        this.opened.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  private send(req: Pending, transfer: Transferable[] = []): Promise<ContentResponse> {
    const id = ++this.nextId;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.getWorker().postMessage({ ...req, id } as ContentRequest, transfer);
    });
  }

  private open(source: Source) {
    let p = this.opened.get(source.id);
    if (!p) {
      // A copy: the source keeps its bytes.
      p = this.send({ kind: 'open', sourceId: source.id, bytes: source.bytes.slice(), password: source.password }).then(() => {});
      this.opened.set(source.id, p);
    }
    return p;
  }

  /** Files whose permissions forbid changing the content (known once checked). */
  readonly locked = new SvelteMap<string, boolean>();

  /** Whether the file's permissions forbid changing its content (PDF.js reads them). */
  async checkLock(source: Source): Promise<boolean> {
    const known = this.locked.get(source.id);
    if (known !== undefined) return known;
    const perms = await source.pdf.getPermissions().catch(() => null);
    const locked = !!perms && !perms.has(PermissionFlag.MODIFY_CONTENTS);
    this.locked.set(source.id, locked);
    return locked;
  }

  /** Start analyzing a page if that hasn't been done (call from an effect, not a derived value). */
  request(source: Source, index: number) {
    const key = `${source.id}:${index}`;
    if (this.analyses.has(key)) return;
    this.analyses.set(key, 'pending');
    void this.analyze(source, index, key);
  }

  /** What's on a page (reactive): undefined until requested. */
  get(source: Source, index: number): PageAnalysis | 'pending' | 'failed' | undefined {
    return this.analyses.get(`${source.id}:${index}`);
  }

  private async analyze(source: Source, index: number, key: string, retry = true): Promise<void> {
    await this.open(source);
    const r = await this.send({ kind: 'analyze', sourceId: source.id, page: index });
    if (!r.ok && r.unknownSource && retry) {
      this.opened.delete(source.id);
      return this.analyze(source, index, key, false);
    }
    this.analyses.set(key, r.ok && r.analysis ? r.analysis : 'failed');
  }

  /** Delete items from a page: the new version of the whole file. Throws ContentEditError with a message for the user. */
  async remove(source: Source, index: number, ids: string[], newSourceId: string): Promise<{ bytes: Uint8Array; result: DeleteResult }> {
    await this.open(source);
    let r = await this.send({ kind: 'delete', sourceId: source.id, page: index, ids, newSourceId });
    if (!r.ok && r.unknownSource) {
      this.opened.delete(source.id);
      await this.open(source);
      r = await this.send({ kind: 'delete', sourceId: source.id, page: index, ids, newSourceId });
    }
    if (!r.ok) throw r.user ? new ContentEditError(r.message) : new Error(r.message);
    // The worker holds the new version already.
    this.opened.set(newSourceId, Promise.resolve());
    return { bytes: r.bytes!, result: r.result! };
  }

  /** A version of a file nothing refers to any more (not even undo). */
  forget(sourceId: string) {
    for (const k of [...this.analyses.keys()]) if (k.startsWith(`${sourceId}:`)) this.analyses.delete(k);
    if (this.opened.delete(sourceId) && this.worker) void this.send({ kind: 'forget', sourceId });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
    this.opened.clear();
    this.analyses.clear();
  }
}
