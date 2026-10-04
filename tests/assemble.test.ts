import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray } from '@cantoo/pdf-lib';
import { assemble, type PagePlan, type SourceInput } from '../src/lib/pdf/assemble';
import { blankPdf } from '../src/lib/pdf/blank';

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

/** n pages; page i is (500 + i) points wide and carries an uncompressed marker `MARK-<tag>-<i>`. */
async function makePdf(n: number, tag: string, setup?: (doc: PDFDocument) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Doc ${tag}`);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage([500 + i, 700]);
    const stream = doc.context.stream(`BT /F1 12 Tf 50 600 Td (MARK-${tag}-${i}) Tj ET`);
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  }
  setup?.(doc);
  return doc.save({ useObjectStreams: false });
}

const widths = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

const rotations = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle);

const plan = (sourceId: string, indexes: number[], rotation = 0): PagePlan[] =>
  indexes.map((index) => ({ sourceId, index, rotation }));

describe('assemble (preserve mode = Save)', () => {
  it('reorders pages and keeps document metadata', async () => {
    const src: SourceInput = { id: 'a', bytes: await makePdf(4, 'A') };
    const out = await assemble([src], plan('a', [3, 0, 2, 1]), 'preserve');
    expect(await widths(out)).toEqual([504, 501, 503, 502]);
    expect((await PDFDocument.load(out)).getTitle()).toBe('Doc A');
  });

  it('applies rotation on top of existing rotation', async () => {
    const bytes = await makePdf(2, 'R', (doc) => doc.getPage(1).setRotation({ type: 'degrees', angle: 90 } as never));
    const out = await assemble([{ id: 'r', bytes }], [
      { sourceId: 'r', index: 0, rotation: 270 },
      { sourceId: 'r', index: 1, rotation: 90 },
    ], 'preserve');
    expect(await rotations(out)).toEqual([270, 180]);
  });

  it('removes the content of deleted pages from the file', async () => {
    const src = { id: 'a', bytes: await makePdf(4, 'A') };
    expect(latin1(src.bytes)).toContain('MARK-A-3');
    const out = await assemble([src], plan('a', [0, 1, 3]), 'preserve');
    expect(await widths(out)).toEqual([501, 502, 504]);
    expect(latin1(out)).not.toContain('MARK-A-3');
    expect(latin1(out)).toContain('MARK-A-4');
  });

  it('merges pages from several files in any order', async () => {
    const a = { id: 'a', bytes: await makePdf(2, 'A') };
    const b = { id: 'b', bytes: await makePdf(3, 'B') };
    const out = await assemble([a, b], [...plan('b', [2]), ...plan('a', [0, 1]), ...plan('b', [0])], 'preserve');
    expect(await widths(out)).toEqual([503, 501, 502, 501]);
    const text = latin1(out);
    expect(text).toContain('MARK-B-3');
    expect(text).not.toContain('MARK-B-2');
  });

  it('can use the same page twice', async () => {
    const a = { id: 'a', bytes: await makePdf(2, 'A') };
    const out = await assemble([a], plan('a', [1, 1, 0]), 'preserve');
    expect(await widths(out)).toEqual([502, 502, 501]);
  });

  it('includes inserted blank pages', async () => {
    const a = { id: 'a', bytes: await makePdf(2, 'A') };
    const blank = { id: 'blank', bytes: blankPdf(300, 400) };
    const out = await assemble([a, blank], [...plan('a', [0]), ...plan('blank', [0]), ...plan('a', [1])], 'preserve');
    expect(await widths(out)).toEqual([501, 300, 502]);
  });

  it('keeps pages correct when they inherited size and rotation from a parent node', async () => {
    // Hand-written PDF: an intermediate /Pages node carries MediaBox and Rotate.
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [5 0 R] /Count 1 /MediaBox [0 0 300 400] /Rotate 90 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] >>',
      '<< /Type /Page /Parent 3 0 R >>',
    ];
    let s = '%PDF-1.4\n';
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(s.length);
      s += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const x = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    const src = { id: 'n', bytes: new TextEncoder().encode(s) };

    const out = await assemble([src], plan('n', [1, 0]), 'preserve');
    const doc = await PDFDocument.load(out);
    // Page 0 is the one under the intermediate node; the plan swaps the two.
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle])).toEqual([
      [600, 800, 0],
      [300, 400, 90],
    ]);
  });

  it('drops form fields that lived only on deleted pages', async () => {
    const bytes = await makePdf(2, 'F', (doc) => {
      const form = doc.getForm();
      form.createTextField('keep').addToPage(doc.getPage(0), { x: 50, y: 50 });
      form.createTextField('gone').addToPage(doc.getPage(1), { x: 50, y: 50 });
    });
    const out = await assemble([{ id: 'f', bytes }], plan('f', [0]), 'preserve');
    const names = (await PDFDocument.load(out)).getForm().getFields().map((f) => f.getName());
    expect(names).toEqual(['keep']);
  });

  it('opens password-protected sources with the password and saves them decrypted', async () => {
    const plain = await PDFDocument.load(await makePdf(2, 'E'));
    plain.encrypt({ userPassword: 'secret', ownerPassword: 'owner' });
    const bytes = await plain.save();
    await expect(PDFDocument.load(bytes)).rejects.toThrow();

    const out = await assemble([{ id: 'e', bytes, password: 'secret' }], plan('e', [1, 0]), 'preserve');
    expect(await widths(out)).toEqual([502, 501]);
  });

  it('opens files that have only an owner password', async () => {
    const plain = await PDFDocument.load(await makePdf(1, 'O'));
    plain.encrypt({ userPassword: '', ownerPassword: 'owner' });
    const bytes = await plain.save();
    const out = await assemble([{ id: 'o', bytes }], plan('o', [0]), 'preserve');
    expect(await widths(out)).toEqual([501]);
  });
});

describe('assemble (fresh mode = extract / split)', () => {
  it('contains only the requested pages', async () => {
    const a = { id: 'a', bytes: await makePdf(5, 'A') };
    const out = await assemble([a], plan('a', [1, 3]), 'fresh');
    expect(await widths(out)).toEqual([502, 504]);
    const text = latin1(out);
    expect(text).toContain('MARK-A-2');
    expect(text).not.toContain('MARK-A-1');
    expect(text).not.toContain('MARK-A-5');
  });

  it('rejects an empty plan', async () => {
    const a = { id: 'a', bytes: await makePdf(1, 'A') };
    await expect(assemble([a], [], 'fresh')).rejects.toThrow();
  });
});

describe('blankPdf', () => {
  it('is a valid one-page PDF of the given size', async () => {
    const doc = await PDFDocument.load(blankPdf(595.28, 841.89));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28);
    const pages = doc.catalog.lookup(PDFName.of('Pages'), PDFDict);
    expect(pages.lookup(PDFName.of('Kids'), PDFArray).size()).toBe(1);
  });
});
