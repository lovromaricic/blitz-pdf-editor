import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compressSource, estimateSource } from '../src/lib/pdf/assemble';
import { analyze, isWorthwhile, PRESETS, rawPixels, type CompressSettings, type ImageCodec } from '../src/lib/pdf/compress';
import { findPlacements } from '../src/lib/pdf/image-placement';
import { createFontProvider } from '../src/lib/pdf/font-provider';

const fonts = createFontProvider(async () =>
  new Uint8Array(readFileSync('node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf')),
);

/** A real JPEG codec for Node (the app uses the browser's). Nearest-neighbour resize is enough for size tests. */
const codec: ImageCodec = {
  async reencode(c, w, h, quality) {
    const src = c.kind === 'jpeg' ? jpeg.decode(c.stream.contents, { useTArray: true }) : { width: c.width, height: c.height, data: rawPixels(c) };
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.floor((y * src.height) / h);
      for (let x = 0; x < w; x++) {
        const s = (sy * src.width + Math.floor((x * src.width) / w)) * 4;
        out.set(src.data.subarray(s, s + 4), (y * w + x) * 4);
      }
    }
    return new Uint8Array(jpeg.encode({ data: out, width: w, height: h }, Math.round(quality * 100)).data);
  },
};

/** A photo-like picture: smooth shapes with fine grain (expensive for JPEG at high quality). */
function photo(width: number, height: number, seed: number) {
  const data = new Uint8Array(width * height * 4);
  let r = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      const grain = (r % 40) - 20;
      const o = (y * width + x) * 4;
      data[o] = 128 + 100 * Math.sin((x + seed) / 97) + grain;
      data[o + 1] = 128 + 100 * Math.cos((y - seed) / 71) + grain;
      data[o + 2] = 128 + 60 * Math.sin((x + y) / 53) + grain;
      data[o + 3] = 255;
    }
  }
  return new Uint8Array(jpeg.encode({ data, width, height }, 95).data);
}

let photoBytes: Promise<Uint8Array> | null = null;
/** Built once: encoding the test photos is the slow part. */
const photoPdf = () => (photoBytes ??= makePhotoPdf());

async function makePhotoPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842]);
    const img = await doc.embedJpg(photo(1500, 1000, i * 31));
    // 500 pt wide = 6.94 in: 1500 px is about 216 DPI here.
    page.drawImage(img, { x: 47, y: 400, width: 500, height: 333 });
    page.drawText('Caption text stays as text', { x: 47, y: 380, size: 10, font });
  }
  return doc.save();
}

async function textPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 20; i++) {
    const page = doc.addPage([595, 842]);
    for (let l = 0; l < 40; l++) page.drawText(`Page ${i + 1}, line ${l + 1}: plain text with no pictures at all.`, { x: 40, y: 800 - l * 19, size: 10, font });
  }
  return doc.save();
}

const compress = (bytes: Uint8Array, settings: CompressSettings) => compressSource({ id: 's', bytes }, settings, [], fonts, { codec });

async function imageSizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const out: [number, number][] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
      out.push([(obj.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(), (obj.dict.get(PDFName.of('Height')) as PDFNumber).asNumber()]);
    }
  }
  return out;
}

async function pageText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
  await pdf.loadingTask.destroy();
  return text;
}

describe('compress', () => {
  it('shrinks a file with large photos a lot, and estimates the result closely', async () => {
    const bytes = await photoPdf();
    const out = await compress(bytes, PRESETS.maximum);
    expect(out.length).toBeLessThan(bytes.length * 0.15);
    expect(isWorthwhile(bytes.length, out.length)).toBe(true);
    // 96 DPI over 6.94 in is about 667 px wide.
    for (const [w] of await imageSizes(out)) expect(w).toBeGreaterThanOrEqual(660), expect(w).toBeLessThanOrEqual(680);
    // Text is untouched.
    expect(await pageText(out)).toContain('Caption text stays as text');

    const [estimate] = await estimateSource({ id: 's', bytes }, [PRESETS.maximum], { codec });
    expect(Math.abs(estimate - out.length) / out.length).toBeLessThan(0.02);
  });

  it('presets give different, ordered sizes on photos', async () => {
    const bytes = await photoPdf();
    const sizes = await estimateSource({ id: 's', bytes }, [PRESETS.light, PRESETS.balanced, PRESETS.maximum], { codec });
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
  });

  it('says a file with almost no images cannot be made much smaller', async () => {
    const bytes = await textPdf();
    expect(analyze(await PDFDocument.load(bytes), bytes.length).imageCount).toBe(0);
    const out = await compress(bytes, PRESETS.maximum);
    expect(isWorthwhile(bytes.length, out.length)).toBe(false);
    expect(await pageText(out)).toContain('Page 1, line 1');
  });

  it('custom settings at both extremes', async () => {
    const bytes = await photoPdf();
    const smallest = await compress(bytes, { quality: 0.1, dpi: 72 });
    const best = await compress(bytes, { quality: 0.95, dpi: null });
    expect(smallest.length).toBeLessThan(best.length / 10);
    // 72 DPI over 6.94 in is about 500 px; "Original" keeps every pixel.
    for (const [w] of await imageSizes(smallest)) expect(Math.abs(w - 500)).toBeLessThanOrEqual(5);
    for (const [w, h] of await imageSizes(best)) expect([w, h]).toEqual([1500, 1000]);
  });

  it('cancels between images', async () => {
    const bytes = await photoPdf();
    await expect(compressSource({ id: 's', bytes }, PRESETS.balanced, [], fonts, { codec, stopped: () => true })).rejects.toThrow('Cancelled');
  });
});

describe('image placement', () => {
  it('finds how large each image is drawn', async () => {
    const doc = await PDFDocument.load(await photoPdf());
    const sizes = [...findPlacements(doc).values()];
    expect(sizes).toHaveLength(3);
    for (const s of sizes) {
      expect(s.width).toBeCloseTo(500);
      expect(s.height).toBeCloseTo(333);
    }
  });

  it('leaves images alone where image re-encoding is unavailable', async () => {
    const bytes = await photoPdf();
    const out = await compressSource({ id: 's', bytes }, PRESETS.maximum, [], fonts, { codec: null });
    expect((await imageSizes(out)).every(([w]) => w === 1500)).toBe(true);
  });
});
