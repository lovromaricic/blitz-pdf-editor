// Inserted images in the saved PDF: real images at the same place, size, turn,
// flip, opacity and stacking order as on screen, embedded once.
import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from '@cantoo/pdf-lib';
import { assemble } from '../src/lib/pdf/assemble';
import type { Annotation, ImageAnnotation } from '../src/lib/annotations';
import type { ImageAsset } from '../src/lib/image-store';
import { makeJpeg, makePng, marker } from './image-fixtures';

const photo = makeJpeg(40, 60, marker(40, 60), 6);
const png = makePng(40, 40, (x, y) => (x + y < 40 ? [0, 160, 0, 255] : [0, 0, 0, 0]));
const images: Record<string, ImageAsset> = {
  P: { kind: 'jpeg', bytes: photo, orientation: 6 },
  A: { kind: 'png', bytes: png, orientation: 1 },
};

function img(id: string, key: string, rect: ImageAnnotation['rect'], extra: Partial<ImageAnnotation> = {}): ImageAnnotation {
  return { id, type: 'image', role: 'image', color: [0, 0, 0], opacity: 1, dataUrl: 'blob:x', imageKey: key, rotate: 0, angle: 0, rect, ...extra };
}

async function blankPdf(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

async function save(annots: Annotation[], rotation = 0) {
  const out = await assemble([{ id: 's', bytes: await blankPdf() }], [{ sourceId: 's', index: 0, rotation, annots }], 'preserve', { images });
  return PDFDocument.load(out);
}

/** The page's content, decoded, as one string. */
function pageContent(doc: PDFDocument) {
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  if (!contents) return '';
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((r) => {
      const s = doc.context.lookup(r as PDFRef);
      const bytes = s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as PDFStream).getContents();
      return new TextDecoder('latin1').decode(bytes);
    })
    .join('\n');
}

/** The `cm` matrices that draw each image XObject in the page content, in drawing order. */
function drawnImages(doc: PDFDocument) {
  return [...pageContent(doc).matchAll(/([-\d. ]+) cm\s*\/(BlitzImage-?\d+) Do/g)].map((m) => ({ name: m[2], matrix: m[1].trim().split(/\s+/).map(Number) }));
}

function imageXObjects(doc: PDFDocument) {
  return doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
}

function annotations(doc: PDFDocument) {
  const annots = doc.getPage(0).node.Annots();
  return (annots?.asArray() ?? []).map((r) => doc.context.lookup(r, PDFDict));
}

describe('inserted images in the saved PDF', () => {
  it('draws a phone photo upright, at its place and size, as page content', async () => {
    const doc = await save([img('a', 'P', [100, 500, 140, 560])]);
    const [drawn] = drawnImages(doc);
    // Orientation 6 turns the stored landscape pixels a quarter right: x' = y, y' = 1 − x, then 40 × 60 at (100, 500).
    expect(drawn.matrix).toEqual([0, -60, 40, 0, 100, 560]);
    expect(annotations(doc)).toHaveLength(0);
  });

  it('embeds JPEGs byte for byte and keeps PNG transparency', async () => {
    const doc = await save([img('a', 'P', [100, 500, 140, 560]), img('b', 'A', [300, 500, 340, 540])]);
    const [jpeg, pngImage] = imageXObjects(doc).map(([, o]) => o as PDFRawStream);
    const filters = [jpeg, pngImage].map((s) => String(s.dict.get(PDFName.of('Filter'))));
    expect(filters).toContain('/DCTDecode');
    const dct = [jpeg, pngImage].find((s) => String(s.dict.get(PDFName.of('Filter'))) === '/DCTDecode')!;
    expect(Buffer.from(dct.getContents()).equals(Buffer.from(photo))).toBe(true);
    const flate = [jpeg, pngImage].find((s) => s !== dct)!;
    expect(flate.dict.get(PDFName.of('SMask'))).toBeInstanceOf(PDFRef);
  });

  it('embeds the same image once, however often it is used', async () => {
    const doc = await save([img('a', 'P', [100, 500, 140, 560]), img('b', 'P', [200, 500, 240, 560]), img('c', 'P', [300, 500, 340, 560])]);
    expect(drawnImages(doc)).toHaveLength(3);
    expect(imageXObjects(doc)).toHaveLength(1);
  });

  it('flips both ways and fades as on screen', async () => {
    const doc = await save([
      img('h', 'A', [100, 100, 140, 140], { flipX: true }),
      img('v', 'A', [200, 100, 240, 140], { flipY: true }),
      img('o', 'A', [300, 100, 340, 140], { opacity: 0.5 }),
    ]);
    const [h, v, o] = drawnImages(doc);
    // Flip horizontal: x runs right to left (negative width, starting at the right edge).
    expect(h.matrix).toEqual([-40, 0, 0, 40, 140, 100]);
    // Flip vertical: y runs top to bottom.
    expect(v.matrix).toEqual([40, 0, 0, -40, 200, 140]);
    expect(o.matrix).toEqual([40, 0, 0, 40, 300, 100]);
    expect(pageContent(doc)).toMatch(/\/BlitzGS-?\d+ gs[\s\S]*BlitzImage-?\d+ Do/);
  });

  it('turns about the center, clockwise as seen on screen', async () => {
    const doc = await save([img('t', 'A', [100, 100, 140, 140], { angle: 90 })]);
    const [t] = drawnImages(doc);
    // A quarter turn clockwise: the image's left edge is at the top. Same box, same center (120, 120).
    expect(t.matrix).toEqual([0, -40, 40, 0, 100, 140]);
  });

  it('keeps the stacking order with other objects', async () => {
    const rect: Annotation = { id: 's', type: 'shape', shape: 'rect', color: [1, 0, 0], fill: [1, 1, 0], width: 2, opacity: 1, from: [150, 150], to: [350, 350] };
    // Below the rectangle: page content. Above it and overlapping: an image annotation after it.
    const below = await save([img('under', 'A', [100, 100, 200, 200]), rect]);
    expect(drawnImages(below)).toHaveLength(1);
    expect(annotations(below).map((a) => String(a.get(PDFName.of('Subtype'))))).toEqual(['/Square']);

    const above = await save([rect, img('over', 'A', [100, 100, 200, 200])]);
    expect(drawnImages(above)).toHaveLength(0);
    const list = annotations(above);
    expect(list.map((a) => String(a.get(PDFName.of('Subtype'))))).toEqual(['/Square', '/Stamp']);
    expect(String(list[1].get(PDFName.of('Name')))).toBe('/Image');

    // Above it but elsewhere on the page: the order doesn't show, so it stays page content.
    const apart = await save([rect, img('apart', 'A', [400, 500, 500, 600])]);
    expect(drawnImages(apart)).toHaveLength(1);
  });

  it('stays on its page and upright as shown on a rotated page', async () => {
    // Placed while page is shown turned a quarter right: rotate = 90, upright 40 × 60 in a 60 × 40 rect.
    const doc = await save([img('r', 'P', [200, 300, 260, 340], { rotate: 90 })], 90);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    const [r] = drawnImages(doc);
    // Upright on screen means turned a quarter left in page space (undone by /Rotate 90).
    // The photo's EXIF quarter turn right cancels that: the stored pixels are drawn
    // as they are, exactly covering the rect.
    expect(r.matrix).toEqual([60, 0, 0, 40, 200, 300]);
  });
});
