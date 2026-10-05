// Inserted images for this session, in memory only (never stored anywhere).
// Keyed by a hash of their bytes, so the same picture inserted twice is kept,
// and embedded in the saved PDF, once.
import { prepareInsertImage, UnsupportedImageError, type PreparedImage } from './image-prepare';
import type { ImageJob, ImageJobResult } from './image-worker';
import { cutImage, type CutRequest } from './image-cut';

export interface StoredImage extends PreparedImage {
  key: string;
  name: string;
  /** Object URL for showing it in the editor. */
  url: string;
}

/** What the PDF writer needs to embed an image. */
export interface ImageAsset {
  kind: 'jpeg' | 'png';
  bytes: Uint8Array;
  orientation: number;
}

const images = new Map<string, StoredImage>();

export function storedImage(key: string): StoredImage | undefined {
  return images.get(key);
}

/** Embeddable copies of the given images (structured clone copies the bytes; ours stay). */
export function imageAssets(keys: Iterable<string>): Record<string, ImageAsset> {
  const out: Record<string, ImageAsset> = {};
  for (const key of keys) {
    const img = images.get(key);
    if (img) out[key] = { kind: img.kind, bytes: img.bytes, orientation: img.orientation };
  }
  return out;
}

/** Forget every image (the document was closed): its object URLs and bytes go. */
export function releaseImages() {
  for (const img of images.values()) URL.revokeObjectURL(img.url);
  images.clear();
}

let worker: Worker | null = null;
let nextId = 0;

/** Run a job in the image worker (started on first use). */
function inWorker<R>(job: Omit<ImageJob, 'id'>, transfer: Transferable[], pick: (r: ImageJobResult) => R | undefined): Promise<R> {
  worker ??= new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module', name: 'images' });
  const w = worker;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<ImageJobResult>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      const r = pick(e.data);
      if (r !== undefined) resolve(r);
      else reject('error' in e.data && e.data.error === 'unsupported' ? new UnsupportedImageError() : new Error('error' in e.data ? e.data.error : 'unexpected'));
    };
    const onError = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      worker?.terminate();
      worker = null;
      reject(new Error('worker failed'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ ...job, id } as ImageJob, transfer);
  });
}

/**
 * The cut images a written PDF needs (see image-cut.ts), by their keys. In
 * the worker; on the main thread where that fails. `reduced` lists cuts the
 * device could only hold at a lower resolution.
 */
export async function cutImages(cuts: readonly CutRequest[], onProgress?: (done: number) => void): Promise<{ assets: Record<string, ImageAsset>; reduced: CutRequest[] }> {
  const assets: Record<string, ImageAsset> = {};
  const reduced: CutRequest[] = [];
  let done = 0;
  for (const c of cuts) {
    const img = images.get(c.source);
    if (!img) continue;
    // A copy goes to the worker: ours stays.
    const asset: ImageAsset = { kind: img.kind, bytes: img.bytes.slice(), orientation: img.orientation };
    let r: { asset: ImageAsset; reduced: boolean };
    try {
      r = await inWorker({ cut: { asset, rect: c.rect } }, [asset.bytes.buffer as ArrayBuffer], (m) => ('cut' in m ? m.cut : undefined));
    } catch {
      r = await cutImage({ kind: img.kind, bytes: img.bytes, orientation: img.orientation }, c.rect);
    }
    assets[c.key] = r.asset;
    if (r.reduced) reduced.push(c);
    onProgress?.(++done);
  }
  return { assets, reduced };
}

/**
 * Read an image file and keep it for this session. Throws UnsupportedImageError
 * for files that aren't JPEG, PNG, WebP or (where the browser decodes it) HEIC.
 */
export async function addImageFile(file: Blob & { name?: string }, heic: boolean): Promise<StoredImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let prepared: PreparedImage;
  try {
    // A copy goes to the worker, so a failure there can still be retried here.
    const copy = bytes.slice();
    prepared = await inWorker({ bytes: copy, heic }, [], (m) => ('image' in m ? m.image : undefined));
  } catch (e) {
    // Some browsers can't decode everything in a worker (HEIC in Safari): try here.
    if (e instanceof UnsupportedImageError && !heic) throw e;
    prepared = await prepareInsertImage(bytes, heic);
  }
  const key = await hashKey(prepared.bytes);
  const known = images.get(key);
  if (known) return known;
  const url = URL.createObjectURL(new Blob([prepared.bytes as BlobPart], { type: prepared.kind === 'jpeg' ? 'image/jpeg' : 'image/png' }));
  const stored: StoredImage = { ...prepared, key, url, name: file.name || 'Pasted image' };
  images.set(key, stored);
  return stored;
}

async function hashKey(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return 'img-' + Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
