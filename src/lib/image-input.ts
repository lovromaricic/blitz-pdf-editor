// Prepares image files for the PDF worker. JPEGs that need no rotation are
// passed through untouched (no quality loss); everything else is normalized
// in the browser, which also applies the EXIF orientation of phone photos.
import type { ImageInput } from './pdf/images-to-pdf';

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif';

export function isImageFile(f: File) {
  return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic)$/i.test(f.name);
}

export async function prepareImage(file: File): Promise<ImageInput> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: file.type || 'application/octet-stream' }));
  } catch {
    throw new Error(`${file.name}: this image format can't be read here. Try JPG or PNG.`);
  }
  const { width, height } = bitmap;
  if (isJpeg && jpegOrientation(bytes) <= 1) {
    bitmap.close();
    return { name: file.name, type: 'jpeg', bytes, width, height };
  }
  // Re-encode: PNG keeps transparency and sharp edges; photos become JPEG.
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const asJpeg = isJpeg || file.type === 'image/webp' || file.type === 'image/avif';
  const blob = await canvas.convertToBlob(asJpeg ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' });
  return { name: file.name, type: asJpeg ? 'jpeg' : 'png', bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** EXIF orientation of a JPEG (1 = upright), or 1 if absent. */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF header
      const little = b[t] === 0x49;
      const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const count = u16(ifd);
      for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) return 1; // start of image data: no EXIF before it
    i += 2 + len;
  }
  return 1;
}
