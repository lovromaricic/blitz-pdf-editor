// Turns a picked, dropped or pasted image file into something a PDF can embed.
// JPEG and PNG are kept byte for byte (no quality loss, no size growth): JPEG
// orientation is applied when drawing, not by re-encoding. WebP and HEIC are
// converted through a canvas; so are images too large to handle safely.
// Runs in a worker (image-worker.ts), or on the main thread as a fallback.
import { jpegOrientation } from './image-input';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic';

export interface PreparedImage {
  kind: 'jpeg' | 'png';
  bytes: Uint8Array;
  /** EXIF orientation still to apply when drawing (JPEG passed through), else 1. */
  orientation: number;
  /** Pixel size as shown (orientation applied). */
  width: number;
  height: number;
  /** Set when the image was made smaller: its original pixel size. */
  downscaledFrom?: [number, number];
}

/** Longer side above which an image is made smaller… */
export const MAX_SIDE = 8000;
/** …to this longer side. Canvases of up to 4096 × 4096 work in every browser, phones included. */
export const SAFE_SIDE = 4096;
/** Converted images (WebP, HEIC) also stay within this many pixels. */
export const SAFE_PIXELS = 4096 * 4096;

export class UnsupportedImageError extends Error {}

/** The format from the first bytes (file names and types can't be trusted). */
export function sniffImage(b: Uint8Array): ImageFormat | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return 'heic';
  return null;
}

/** Pixel size of a JPEG as stored (before orientation), from its frame header. */
export function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    }
    i += 2 + len;
  }
  return null;
}

/** Pixel size of a PNG, from its header. */
export function pngSize(b: Uint8Array): [number, number] {
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return [u32(16), u32(20)];
}

/** Size as shown: orientations 5–8 turn the image a quarter. */
export function orientedSize([w, h]: [number, number], orientation: number): [number, number] {
  return orientation >= 5 && orientation <= 8 ? [h, w] : [w, h];
}

/** The size to scale an image of `w` × `h` down to, or null if it can stay as it is. */
export function safeSize(w: number, h: number, converting: boolean): [number, number] | null {
  let k = Math.max(w, h) > MAX_SIDE ? SAFE_SIDE / Math.max(w, h) : 1;
  if (converting) k = Math.min(k, Math.sqrt(SAFE_PIXELS / (w * h)));
  if (k >= 1) return null;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

export async function prepareInsertImage(bytes: Uint8Array, heic: boolean): Promise<PreparedImage> {
  const format = sniffImage(bytes);
  if (!format || (format === 'heic' && !heic)) throw new UnsupportedImageError();

  if (format === 'jpeg') {
    const raw = jpegSize(bytes);
    if (!raw) throw new UnsupportedImageError();
    const orientation = jpegOrientation(bytes);
    const [width, height] = orientedSize(raw, orientation);
    if (!safeSize(width, height, false)) return { kind: 'jpeg', bytes, orientation, width, height };
  } else if (format === 'png') {
    const [width, height] = pngSize(bytes);
    if (!safeSize(width, height, false)) return { kind: 'png', bytes, orientation: 1, width, height };
  }
  return convert(bytes, format);
}

const MIME: Record<ImageFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

/** Decode and redraw on a canvas (orientation applied), smaller if needed. */
async function convert(bytes: Uint8Array, format: ImageFormat): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[format] }), { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedImageError();
  }
  const { width: w0, height: h0 } = bitmap;
  const target = safeSize(w0, h0, true) ?? [w0, h0];
  const canvas = new OffscreenCanvas(target[0], target[1]);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, target[0], target[1]);
  bitmap.close();
  // Photos without transparency become JPEG; anything with transparency (or a PNG) stays PNG.
  const transparent = format !== 'jpeg' && hasTransparency(ctx.getImageData(0, 0, target[0], target[1]).data);
  const kind = format === 'png' || transparent ? 'png' : 'jpeg';
  const blob = await canvas.convertToBlob(kind === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 });
  return {
    kind,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    orientation: 1,
    width: target[0],
    height: target[1],
    downscaledFrom: target[0] !== w0 ? [w0, h0] : undefined,
  };
}

function hasTransparency(rgba: Uint8ClampedArray) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}
