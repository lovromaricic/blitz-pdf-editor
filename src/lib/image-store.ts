// Inserted images for this session, in memory only (never stored anywhere).
// Keyed by a hash of their bytes, so the same picture inserted twice is kept,
// and embedded in the saved PDF, once.
import { prepareInsertImage, UnsupportedImageError, type PreparedImage } from './image-prepare';
import type { ImageJob, ImageJobResult } from './image-worker';

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

let worker: Worker | null = null;
let nextId = 0;

function inWorker(bytes: Uint8Array, heic: boolean): Promise<PreparedImage> {
  worker ??= new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module', name: 'images' });
  const w = worker;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<ImageJobResult>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if ('image' in e.data) resolve(e.data.image);
      else reject(e.data.error === 'unsupported' ? new UnsupportedImageError() : new Error(e.data.error));
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
    w.postMessage({ id, bytes, heic } satisfies ImageJob);
  });
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
    prepared = await inWorker(bytes.slice(), heic);
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
