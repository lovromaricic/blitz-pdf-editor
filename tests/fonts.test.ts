import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Annotation } from '../src/lib/annotations';
import { faceKey, FONTS, hasBold, hasItalic, STYLE_DIRS } from '../src/lib/font-catalog';
import { assemble } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';

/** Face key → TTF path, the same mapping the app builds from its bundled files. */
const FILES: Record<string, string> = {};
for (const f of FONTS) {
  for (const [dir, style] of Object.entries(STYLE_DIRS)) {
    const path = `node_modules/@expo-google-fonts/${f.id}/${dir}`;
    try {
      FILES[faceKey(f.id, style.bold, style.italic)] = `${path}/${readdirSync(path).find((n) => n.endsWith('.ttf'))}`;
    } catch {
      // This style doesn't exist for the font.
    }
  }
}
const fonts = createFontProvider(async (key) => new Uint8Array(readFileSync(FILES[key])));

const CROATIAN = 'Žuti čovjek ćuti, đak šuti';
const ALL_LETTERS = 'č ć đ š ž Č Ć Đ Š Ž €';

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

const text = (font: string, lines: string[], extra: Partial<Annotation> = {}): Annotation =>
  ({ id: `t-${font}-${Math.random()}`, type: 'text', color: [0, 0, 0], opacity: 1, rect: [40, 40, 555, 800], rotate: 0, text: lines.join('\n'), lines, font, size: 14, ...extra }) as Annotation;

async function save(annots: Annotation[]) {
  return assemble([{ id: 'a', bytes: await blank() }], [{ sourceId: 'a', index: 0, rotation: 0, annots }], 'preserve', { fonts });
}

/** Page text as PDF readers extract it (search, select, copy). */
async function pageText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const annots = await page.getAnnotations();
  await pdf.loadingTask.destroy();
  return { text: content.items.map((i) => ('str' in i ? i.str : '')).join(''), annots };
}

/** BaseFont names of the embedded fonts. */
async function baseFonts(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const names: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Font' && obj.get(PDFName.of('Subtype'))?.toString() === '/Type0') {
      names.push(obj.get(PDFName.of('BaseFont'))!.toString().slice(1));
    }
  }
  return names;
}

describe('font catalog', () => {
  it('has 15 fonts with every style file present', () => {
    expect(FONTS).toHaveLength(15);
    for (const f of FONTS) {
      expect(FILES[faceKey(f.id)], f.id).toBeTruthy();
      if (f.bold) expect(FILES[faceKey(f.id, true)], `${f.id} bold`).toBeTruthy();
      if (f.italic) expect(FILES[faceKey(f.id, false, true)], `${f.id} italic`).toBeTruthy();
      if (f.bold && f.italic) expect(FILES[faceKey(f.id, true, true)], `${f.id} bold italic`).toBeTruthy();
    }
  });

  it('falls back to the styles a font has', () => {
    expect(faceKey('roboto', true, true)).toBe('roboto-bold-italic');
    expect(faceKey('caveat', true, true)).toBe('caveat-bold');
    expect(faceKey('great-vibes', true, true)).toBe('great-vibes');
    expect(faceKey('sans', true)).toBe('sans-bold');
    expect(faceKey('serif', true, true)).toBe('serif');
    expect(hasBold('great-vibes')).toBe(false);
    expect(hasItalic('dancing-script')).toBe(false);
  });
});

describe('embedding fonts', () => {
  it('every font and style embeds č ć đ š ž Č Ć Đ Š Ž and €', async () => {
    const annots = Object.keys(FILES).map((key) => {
      const font = FONTS.find((f) => key === f.id || key.startsWith(`${f.id}-`))!.id;
      return text(font, [`${key}: ${ALL_LETTERS}`], { bold: key.includes('-bold'), italic: key.includes('italic') });
    });
    const out = await save(annots);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).node.Annots()!.size()).toBe(annots.length);
    // Each face embedded once, as a subset: the whole file is far smaller than the fonts.
    expect(await baseFonts(out)).toHaveLength(Object.keys(FILES).length);
    const fullFonts = Object.values(FILES).reduce((sum, path) => sum + readFileSync(path).length, 0);
    expect(out.length).toBeLessThan(fullFonts / 10);
    // Every letter comes back out of every face.
    const { text: extracted } = await pageText(out);
    for (const key of Object.keys(FILES)) expect(extracted, key).toContain(`${key}: ${ALL_LETTERS}`);
  });

  for (const font of ['roboto', 'merriweather', 'dancing-script']) {
    it(`"${CROATIAN}" in ${font}: valid, opens, extracts, small`, async () => {
      const before = (await blank()).length;
      const out = await save([text(font, [CROATIAN])]);
      const { text: extracted, annots } = await pageText(out);
      // Still an editable text annotation…
      expect(annots).toHaveLength(1);
      expect(annots[0].subtype).toBe('FreeText');
      expect(annots[0].contentsObj.str).toBe(CROATIAN);
      // …and searchable, selectable page text.
      expect(extracted.trim()).toBe(CROATIAN);
      // Subset: only the glyphs used, so the file stays small.
      expect(out.length - before).toBeLessThan(40_000);
    });
  }

  it('long text, bold and italic', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Redak ${i + 1}: ${CROATIAN}. Cijena 12,50 €.`);
    const out = await save([
      text('tinos', long, { size: 9 }),
      text('montserrat', ['Podebljano: ' + CROATIAN], { bold: true }),
      text('lora', ['Kurziv: ' + CROATIAN], { italic: true }),
      text('inter', ['Oboje: ' + CROATIAN], { bold: true, italic: true }),
    ]);
    const names = await baseFonts(out);
    for (const name of ['Tinos-Regular', 'Montserrat-Bold', 'Lora-Italic', 'Inter-BoldItalic']) {
      expect(names.some((n) => n.startsWith(`${name}-`)), name).toBe(true);
    }
    const { text: extracted } = await pageText(out);
    expect(extracted).toContain('Redak 60: Žuti čovjek ćuti, đak šuti. Cijena 12,50 €.');
    expect(extracted).toContain('Oboje: ' + CROATIAN);
    expect(out.length).toBeLessThan(200_000);
  });
});
