import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addOcrToSource } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';

const fonts = createFontProvider(async () =>
  new Uint8Array(readFileSync('node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf')),
);

describe('OCR text layer', () => {
  it('adds invisible words that PDF readers can search and copy', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const bytes = await doc.save();
    const out = await addOcrToSource(
      { id: 's', bytes },
      {
        0: [
          { text: 'Račun', x: 50, y: 700, width: 60, height: 14, angle: 0 },
          { text: 'br.', x: 116, y: 700, width: 20, height: 14, angle: 0 },
          { text: '2026-117', x: 140, y: 700, width: 70, height: 14, angle: 0 },
          { text: 'Rotated', x: 300, y: 300, width: 80, height: 14, angle: 90 },
        ],
      },
      [],
      fonts,
    );
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    expect(text).toContain('Račun');
    expect(text).toContain('2026-117');
    expect(text).toContain('Rotated');
    await pdf.loadingTask.destroy();
    // The page still looks blank: the text is drawn in invisible mode (3 Tr).
    const raw = (await PDFDocument.load(out)).getPage(0).node.Contents();
    expect(raw).toBeTruthy();
  });
});
