import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { redactSource } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';
import { groupMarks, padTextRect } from '../src/lib/redact-marks';

const fonts = createFontProvider(async () =>
  new Uint8Array(readFileSync('node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf')),
);

/** Smallest JPEG header pdf-lib accepts (1x1 grayscale); the image data itself doesn't matter here. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xd9]);

async function textOf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    pages.push((await (await pdf.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await pdf.loadingTask.destroy();
  return pages;
}

describe('redaction', () => {
  it('removes the original content of redacted pages from the file', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Secret project');
    doc.setAuthor('Ana Anić');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([600, 800]);
    p1.drawText('Account SECRET-4711 belongs to Ana', { x: 50, y: 700, size: 14, font });
    p1.setRotation({ type: 'degrees', angle: 90 } as never);
    const p2 = doc.addPage([600, 800]);
    p2.drawText('Public text stays', { x: 50, y: 700, size: 14, font });
    const form = doc.getForm();
    form.createTextField('account').addToPage(p1, { x: 50, y: 600, width: 200, height: 20 });
    form.getTextField('account').setText('IBAN HR12 3456');
    const bytes = await doc.save({ useObjectStreams: false });

    const out = await redactSource({ id: 's', bytes }, [{ index: 0, jpeg: JPEG, box: [0, 0, 600, 800] }], [], fonts, true);

    const [first, second] = await textOf(out);
    expect(first.trim()).toBe('');
    expect(second).toContain('Public text stays');

    // Nothing of the original survives anywhere in the bytes (uncompressed check).
    const plain = await PDFDocument.load(out);
    const raw = new TextDecoder('latin1').decode(await plain.save({ useObjectStreams: false, compress: false } as never));
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain('IBAN');
    expect(raw).not.toContain('Secret project');

    // Page geometry and rotation are kept; the form field on the redacted page is gone.
    const page = plain.getPage(0);
    expect(page.getRotation().angle).toBe(90);
    expect(page.getSize()).toEqual({ width: 600, height: 800 });
    expect(page.node.Annots()?.size() ?? 0).toBe(0);
    expect(plain.getForm().getFields()).toHaveLength(0);
    expect(plain.getTitle()).toBeUndefined();
  });

  it('keeps document properties unless asked to remove them', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Report');
    doc.addPage([300, 300]);
    const out = await redactSource({ id: 's', bytes: await doc.save() }, [{ index: 0, jpeg: JPEG, box: [0, 0, 300, 300] }], [], fonts, false);
    expect((await PDFDocument.load(out)).getTitle()).toBe('Report');
  });

  it('pads text matches to cover accents and descenders', () => {
    const [x0, y0, x1, y1] = padTextRect([10, 100, 50, 110]);
    expect(x0).toBeLessThan(10);
    expect(y0).toBeLessThan(100);
    expect(x1).toBeGreaterThan(50);
    expect(y1).toBeGreaterThan(110);
  });

  it('groups marks by source page, combining pages used twice', () => {
    const r = (n: number): [number, number, number, number] => [n, n, n + 1, n + 1];
    const pages = [
      { id: 'a', sourceId: 's', sourceIndex: 0, rotation: 0, redactions: [r(1)] },
      { id: 'b', sourceId: 's', sourceIndex: 1, rotation: 0 },
      { id: 'c', sourceId: 's', sourceIndex: 0, rotation: 0, redactions: [r(2)] },
      { id: 'd', sourceId: 't', sourceIndex: 3, rotation: 0, redactions: [r(3)] },
    ];
    const g = groupMarks(pages);
    expect([...g.keys()]).toEqual(['s', 't']);
    expect(g.get('s')!.get(0)).toEqual([r(1), r(2)]);
    expect(g.get('s')!.has(1)).toBe(false);
    expect(g.get('t')!.get(3)).toEqual([r(3)]);
  });
});
