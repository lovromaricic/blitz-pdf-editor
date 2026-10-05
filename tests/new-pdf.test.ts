import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { orient, PAGE_SIZES, validateNewPdf, type NewPdfChoice } from '../src/lib/new-pdf';
import { newBlankPdf } from '../src/lib/pdf/new-blank';

const base: NewPdfChoice = { size: 'a4', orientation: 'portrait', unit: 'mm', width: '210', height: '297', pages: '1' };
const custom = (width: string, height: string, unit: NewPdfChoice['unit'] = 'mm', extra: Partial<NewPdfChoice> = {}) => validateNewPdf({ ...base, size: 'custom', unit, width, height, ...extra });

describe('New blank PDF: page sizes', () => {
  it('has the standard sizes in points', () => {
    expect(PAGE_SIZES.a4).toMatchObject({ width: 595.28, height: 841.89 });
    expect(PAGE_SIZES.letter).toMatchObject({ width: 612, height: 792 });
    expect(PAGE_SIZES.a5).toMatchObject({ width: 419.53, height: 595.28 });
    expect(PAGE_SIZES.legal).toMatchObject({ width: 612, height: 1008 });
  });

  it('swaps width and height for landscape, and keeps portrait tall', () => {
    expect(validateNewPdf({ ...base, orientation: 'landscape' })).toEqual({ ok: true, width: 841.89, height: 595.28, pages: 1 });
    expect(validateNewPdf({ ...base, size: 'letter', orientation: 'landscape' })).toMatchObject({ width: 792, height: 612 });
    // A custom size typed wide but chosen portrait comes out tall.
    expect(custom('300', '200')).toMatchObject({ ok: true, width: 566.93, height: 850.39 });
    expect(orient(100, 50, 'portrait')).toEqual([50, 100]);
    expect(orient(50, 100, 'landscape')).toEqual([100, 50]);
  });
});

describe('New blank PDF: custom size validation', () => {
  it('accepts mm, inches and points (a comma works as the decimal point)', () => {
    expect(custom('210', '297')).toMatchObject({ ok: true, width: 595.28, height: 841.89 });
    expect(custom('8.5', '11', 'in')).toMatchObject({ ok: true, width: 612, height: 792 });
    expect(custom('8,5', '11', 'in')).toMatchObject({ ok: true, width: 612 });
    expect(custom('400', '600', 'pt')).toMatchObject({ ok: true, width: 400, height: 600 });
  });

  it('allows 13 mm to 5080 mm (36 to 14400 pt), and says what is wrong otherwise', () => {
    expect(custom('13', '5080').ok).toBe(true);
    expect(custom('36', '14400', 'pt').ok).toBe(true);
    expect(custom('12', '297')).toEqual({ ok: false, errors: { width: 'Too small: at least 12.7 mm.' } });
    expect(custom('210', '5081')).toEqual({ ok: false, errors: { height: 'Too large: at most 5080 mm.' } });
    expect(custom('0.4', '201', 'in')).toEqual({ ok: false, errors: { width: 'Too small: at least 0.5 in.', height: 'Too large: at most 200 in.' } });
  });

  it('accepts numbers only', () => {
    for (const bad of ['', 'abc', '-210', '2e2', '210mm', '1.2.3']) {
      expect(custom(bad, '297')).toEqual({ ok: false, errors: { width: 'Enter a number.' } });
    }
  });

  it('ignores the custom fields for a standard size', () => {
    expect(validateNewPdf({ ...base, width: 'nonsense' }).ok).toBe(true);
  });

  it('allows 1 to 200 pages, whole numbers only', () => {
    expect(validateNewPdf({ ...base, pages: '200' })).toMatchObject({ ok: true, pages: 200 });
    for (const bad of ['0', '201', '1.5', '', 'two', '-1']) {
      expect(validateNewPdf({ ...base, pages: bad })).toEqual({ ok: false, errors: { pages: 'Enter a whole number from 1 to 200.' } });
    }
  });
});

describe('New blank PDF: the file', () => {
  it('makes one empty A4 page', async () => {
    const doc = await PDFDocument.load(await newBlankPdf(595.28, 841.89, 1));
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect([page.getWidth(), page.getHeight()]).toEqual([595.28, 841.89]);
    expect(page.getRotation().angle).toBe(0);
    // Nothing drawn: white paper in every viewer.
    expect(page.node.Contents()).toBeUndefined();
  });

  it('makes 200 US Letter landscape pages', async () => {
    const bytes = await newBlankPdf(792, 612, 200);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(200);
    expect(doc.getPages().every((p) => p.getWidth() === 792 && p.getHeight() === 612)).toBe(true);
    // Small: empty pages share everything.
    expect(bytes.length).toBeLessThan(40_000);
  });
});
