// Builds a PDF with one image per page. Runs in the PDF worker (no DOM).
import { PDFDocument } from '@cantoo/pdf-lib';

export interface ImageInput {
  name: string;
  type: 'jpeg' | 'png';
  bytes: Uint8Array;
  /** Pixel size, after any EXIF rotation was applied. */
  width: number;
  height: number;
}

export type PageSizeChoice = 'a4' | 'letter' | 'image';

export interface ImagesToPdfOptions {
  pageSize: PageSizeChoice;
  /** Margin in points. */
  margin: number;
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
/** "Image size" pages show images at this resolution. */
const IMAGE_DPI = 150;

export async function imagesToPdf(images: readonly ImageInput[], options: ImagesToPdfOptions, onProgress?: (done: number) => void) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const embedded = img.type === 'jpeg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
    const naturalW = (img.width * 72) / IMAGE_DPI;
    const naturalH = (img.height * 72) / IMAGE_DPI;
    let pageW: number;
    let pageH: number;
    if (options.pageSize === 'image') {
      pageW = naturalW + 2 * options.margin;
      pageH = naturalH + 2 * options.margin;
    } else {
      // Match the page's orientation to the image.
      const [a, b] = SIZES[options.pageSize];
      [pageW, pageH] = img.width > img.height ? [b, a] : [a, b];
    }
    const boxW = pageW - 2 * options.margin;
    const boxH = pageH - 2 * options.margin;
    // Shrink to fit, but never enlarge small images beyond their natural size.
    const k = Math.min(boxW / naturalW, boxH / naturalH, 1);
    const w = naturalW * k;
    const h = naturalH * k;
    const page = doc.addPage([pageW, pageH]);
    page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    onProgress?.(i + 1);
  }
  return doc.save({ useObjectStreams: true });
}
