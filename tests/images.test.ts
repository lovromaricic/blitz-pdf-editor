import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { imagesToPdf } from '../src/lib/pdf/images-to-pdf';
import { jpegOrientation } from '../src/lib/image-input';

// 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('imagesToPdf', () => {
  it('makes one page per image, orientation following the image', async () => {
    const out = await imagesToPdf(
      [
        { name: 'tall.png', type: 'png', bytes: PNG, width: 1000, height: 1500 },
        { name: 'wide.png', type: 'png', bytes: PNG, width: 1600, height: 900 },
      ],
      { pageSize: 'a4', margin: 20 },
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([
      [595, 842],
      [842, 595],
    ]);
  });

  it('sizes "image size" pages from the pixels at 150 dpi plus margins', async () => {
    const out = await imagesToPdf([{ name: 'a.png', type: 'png', bytes: PNG, width: 300, height: 150 }], { pageSize: 'image', margin: 0 });
    const page = (await PDFDocument.load(out)).getPage(0);
    expect([page.getWidth(), page.getHeight()]).toEqual([144, 72]);
  });
});

describe('jpegOrientation', () => {
  it('reads the EXIF orientation tag', () => {
    // SOI, APP1 "Exif\0\0", big-endian TIFF, IFD with one entry: Orientation = 6
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
    const len = exif.length + 2;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xda, 0, 2]);
    expect(jpegOrientation(jpeg)).toBe(6);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
  });
});
