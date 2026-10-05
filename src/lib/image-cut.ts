// Cropped images, cut for real when a PDF is written: only the kept pixels go
// into the file. Planning is pure (which cut each image needs, shared when
// the same); cutting decodes the original and copies the crop onto a canvas,
// in the image worker (OffscreenCanvas) or, as a fallback, on the main thread.
// The session's originals and objects are never changed.
import type { Annotation } from './annotations';
import type { ImageAsset } from './image-store';
import { cropOf, isFull, type Crop } from './image-crop';

/** [x, y, width, height] in whole pixels of the original as shown. */
export type PixelRect = [number, number, number, number];

/** JPEG quality of a cut JPEG (re-encoded once, when written). */
export const CUT_JPEG_QUALITY = 0.95;
/**
 * Pixels a canvas may hold on every device (iOS Safari's limit is 16.7 MP).
 * A larger cut is tried at full size first; only if the device refuses is it
 * made smaller, to fit this.
 */
export const SAFE_CUT_PIXELS = 4096 * 4096;

/** The crop in whole pixels (crops are kept on pixel edges, see normalizeCrop). */
export function cropRectPx(c: Crop, px: readonly [number, number]): PixelRect {
  const x0 = Math.round(c[0] * px[0]);
  const y0 = Math.round(c[1] * px[1]);
  const x1 = Math.max(x0 + 1, Math.round(c[2] * px[0]));
  const y1 = Math.max(y0 + 1, Math.round(c[3] * px[1]));
  return [x0, y0, x1 - x0, y1 - y0];
}

export interface CutRequest {
  /** The key the cut image is embedded under. */
  key: string;
  /** The original's image store key. */
  source: string;
  rect: PixelRect;
}

/**
 * Annotation lists (plain copies) with each cropped image pointing at its cut
 * (no crop left), and the cuts needed: one per original and pixel rect,
 * however often it's used. Uncropped images keep sharing the original.
 */
export function planCuts<T extends { annots?: readonly Annotation[] }>(
  plans: readonly T[],
  sizeOf: (imageKey: string) => readonly [number, number] | undefined,
): { plans: T[]; cuts: CutRequest[] } {
  const cuts = new Map<string, CutRequest>();
  const out = plans.map((p) => {
    if (!p.annots?.some((a) => a.type === 'image' && a.crop)) return p;
    const annots = p.annots.map((a): Annotation => {
      if (a.type !== 'image' || !a.crop) return a;
      const { crop: _, ...rest } = a;
      const px = a.imageKey ? sizeOf(a.imageKey) : undefined;
      if (!a.imageKey || !px || isFull(cropOf(a))) return rest;
      const rect = cropRectPx(cropOf(a), px);
      if (rect[0] === 0 && rect[1] === 0 && rect[2] === px[0] && rect[3] === px[1]) return { ...rest };
      const key = `${a.imageKey}@${rect.join(',')}`;
      if (!cuts.has(key)) cuts.set(key, { key, source: a.imageKey, rect });
      return { ...rest, imageKey: key };
    });
    return { ...p, annots };
  });
  return { plans: out, cuts: [...cuts.values()] };
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function canvasOf(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

async function encode(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

/**
 * Cut `rect` out of an original (EXIF orientation applied, so the result is
 * upright: orientation 1). JPEG stays JPEG (quality 0.95), PNG stays PNG
 * (lossless, transparency kept). Full resolution unless the device can't
 * hold it: then `reduced` is set and it's made to fit SAFE_CUT_PIXELS.
 */
export async function cutImage(asset: ImageAsset, rect: PixelRect): Promise<{ asset: ImageAsset; reduced: boolean }> {
  const type = asset.kind === 'jpeg' ? 'image/jpeg' : 'image/png';
  const bitmap = await createImageBitmap(new Blob([asset.bytes as BlobPart], { type }), { imageOrientation: 'from-image' });
  try {
    const [x, y, w, h] = rect;
    const attempt = async (k: number) => {
      const cw = Math.max(1, Math.round(w * k));
      const ch = Math.max(1, Math.round(h * k));
      const canvas = canvasOf(cw, ch);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error('no canvas');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, x, y, w, h, 0, 0, cw, ch);
      const blob = await encode(canvas, type, asset.kind === 'jpeg' ? CUT_JPEG_QUALITY : undefined);
      // A canvas that was too big for the device comes back empty.
      if (!blob.size) throw new Error('empty');
      canvas.width = canvas.height = 0;
      return new Uint8Array(await blob.arrayBuffer());
    };
    try {
      return { asset: { kind: asset.kind, bytes: await attempt(1), orientation: 1 }, reduced: false };
    } catch (e) {
      if (w * h <= SAFE_CUT_PIXELS) throw e;
      return { asset: { kind: asset.kind, bytes: await attempt(Math.sqrt(SAFE_CUT_PIXELS / (w * h))), orientation: 1 }, reduced: true };
    }
  } finally {
    bitmap.close();
  }
}
