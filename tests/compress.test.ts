import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { analyze, recompressImages } from '../src/lib/pdf/compress';

async function pdfWithImages() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  const pixels = new Uint8Array(400 * 300 * 3).map((_, i) => (i * 37) % 251);
  const photo = doc.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 400, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  const mask = doc.context.flateStream(new Uint8Array(400 * 300).fill(200), { Type: 'XObject', Subtype: 'Image', Width: 400, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  const maskRef = doc.context.register(mask);
  photo.dict.set(PDFName.of('SMask'), maskRef);
  doc.context.register(photo);
  // Too small to bother with:
  doc.context.register(doc.context.flateStream(new Uint8Array(16 * 16 * 3), { Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  return doc;
}

describe('compression analysis', () => {
  it('finds photos, skips alpha masks and tiny images, and estimates smaller results per level', async () => {
    const doc = await pdfWithImages();
    const a = analyze(doc, 500_000);
    expect(a.imageCount).toBe(1);
    expect(a.estimates.light).toBeLessThan(500_000);
    expect(a.estimates.maximum).toBeLessThanOrEqual(a.estimates.balanced);
    expect(a.estimates.balanced).toBeLessThanOrEqual(a.estimates.light);
  });

  it('leaves images alone where image re-encoding is unavailable', async () => {
    const doc = await pdfWithImages();
    expect(await recompressImages(doc, 'balanced')).toBe(0);
  });
});
