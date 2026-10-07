// @vitest-environment happy-dom
// View › Margin size › Custom…: typed values, the allowed range, presets, and
// that a new margin moves nothing.
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { checkMargin, convertTyped, formatMargin, marginLabel, marginPoints, maxMarginMm, outsideMessage, presetFor, rangeText } from '../src/lib/margins';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import type { Annotation } from '../src/lib/annotations';

const A4 = { width: 595.28, height: 841.89 };
const A6 = { width: 297.64, height: 419.53 };
const A4_MAX = maxMarginMm([A4]); // 52.5 mm

describe('typing a margin', () => {
  it('dot or comma decimals; spaces around are fine', () => {
    expect(checkMargin('30', 'mm', A4_MAX)).toEqual({ ok: true, mm: 30 });
    expect(checkMargin('12.5', 'mm', A4_MAX)).toEqual({ ok: true, mm: 12.5 });
    expect(checkMargin(' 12,5 ', 'mm', A4_MAX)).toEqual({ ok: true, mm: 12.5 });
    expect(checkMargin('0', 'mm', A4_MAX)).toEqual({ ok: true, mm: 0 });
  });

  it('empty, negative, letters and huge numbers are refused with the range', () => {
    const refused = { ok: false, error: 'Enter a value from 0 to 52.5 mm' };
    for (const t of ['', '  ', '-5', 'abc', '30mm', '3e1', '1,2,3', '500', '9'.repeat(400)]) expect(checkMargin(t, 'mm', A4_MAX), t).toEqual(refused);
  });

  it('inches convert to mm; the range is shown in the unit', () => {
    expect(checkMargin('1', 'in', A4_MAX)).toEqual({ ok: true, mm: 25.4 });
    expect(checkMargin('3', 'in', A4_MAX)).toEqual({ ok: false, error: 'Enter a value from 0 to 2.06 in' });
    expect(rangeText(A4_MAX, 'mm')).toBe('0 to 52.5 mm');
    expect(convertTyped('25.4', 'mm', 'in')).toBe('1');
    expect(convertTyped('0,5', 'in', 'mm')).toBe('12.7');
    expect(convertTyped('abc', 'mm', 'in')).toBe('abc');
    expect(formatMargin(30, 'in')).toBe('1.181');
    expect(marginLabel(30, 'mm')).toBe('30 mm');
  });

  it('the maximum shown is always allowed (rounded down)', () => {
    expect(checkMargin('52.5', 'mm', A4_MAX).ok).toBe(true);
    expect(checkMargin('52.6', 'mm', A4_MAX).ok).toBe(false);
    expect(checkMargin('2.06', 'in', A4_MAX).ok).toBe(true);
  });
});

describe('presets', () => {
  it('a typed value equal to a preset is that preset (also in inches)', () => {
    expect(presetFor(20)).toBe(20);
    expect(presetFor(30)).toBeNull();
    expect(checkMargin('0.25', 'in', A4_MAX)).toEqual({ ok: true, mm: 6.35 });
    expect(checkMargin('0,5', 'in', A4_MAX)).toEqual({ ok: true, mm: 12.7 });
    expect(checkMargin('1', 'in', A4_MAX)).toEqual({ ok: true, mm: 25.4 }); // not 25
  });
});

describe('the range per page', () => {
  it('the largest margin is a quarter of the smallest page’s shorter side', () => {
    expect(maxMarginMm([A4])).toBeCloseTo(52.5, 1);
    expect(maxMarginMm([A4, A6])).toBeCloseTo(26.25, 1);
    expect(maxMarginMm([{ width: 842, height: 595 }])).toBeCloseTo(52.5, 1); // landscape: the same
  });

  it('each page gets at most a quarter of its own shorter side', () => {
    expect(marginPoints(30, A4.width, A4.height)).toBeCloseTo((30 * 72) / 25.4, 6);
    expect(marginPoints(30, A6.width, A6.height)).toBeCloseTo(A6.width / 4, 6);
  });
});

describe('applying a margin', () => {
  const fakePdf = { getPage: async () => ({ rotate: 0, getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
  function setup(annots: Annotation[] = []) {
    const doc = new EditorDocument();
    const src = new Source('s', 'test.pdf', 2, new Uint8Array(), fakePdf);
    src.sizes = [A4, A6];
    src.views = [
      [0, 0, A4.width, A4.height],
      [0, 0, A6.width, A6.height],
    ];
    doc.sources.set('s', src);
    doc.pages = [
      { id: 'p0', sourceId: 's', sourceIndex: 0, rotation: 0, annots },
      { id: 'p1', sourceId: 's', sourceIndex: 1, rotation: 0 },
    ] as PageRef[];
    return { doc, viewer: new Viewer(doc) };
  }
  const stamp = (id: string, rect: [number, number, number, number]): Annotation => ({ id, type: 'stamp', label: id, color: [0, 0, 0], opacity: 1, rotate: 0, rect });

  it('never moves objects; those across the new margin are counted once', () => {
    const { doc, viewer } = setup([stamp('in', [200, 300, 300, 340]), stamp('out1', [10, 300, 100, 340]), stamp('out2', [200, 820, 300, 840])]);
    const before = doc.pages;
    viewer.setMargin(30);
    expect(doc.pages).toBe(before);
    expect(doc.history.canUndo).toBe(false);
    expect(viewer.objectsOutsideMargins()).toBe(2);
    expect(viewer.notice?.text).toBe(outsideMessage(2));
    expect(outsideMessage(2)).toBe('2 objects are outside the new margins. They stay where they are.');
    expect(outsideMessage(1)).toBe('1 object is outside the new margins. It stays where it is.');
    // Already outside: it can only move inward (its own edge is the limit).
    expect(viewer.limitFor(doc.pages[0], [10, 300, 100, 340]).rect[0]).toBe(10);
  });

  it('applying turns Show margins on; every page uses the value, a small page gets less', () => {
    const { doc, viewer } = setup();
    expect(viewer.showMargins).toBe(false);
    viewer.setMargin(30);
    expect(viewer.showMargins).toBe(true);
    expect(viewer.marginOn(doc.pages[0])).toBeCloseTo((30 * 72) / 25.4, 6);
    expect(viewer.marginOn(doc.pages[1])).toBeCloseTo(A6.width / 4, 6);
    expect(viewer.limitFor(doc.pages[0]).kind).toBe('margin');
  });

  it('0: no margin, the limit is the page edge', () => {
    const { doc, viewer } = setup([stamp('a', [0, 0, 50, 50])]);
    viewer.setMargin(0);
    expect(viewer.limitFor(doc.pages[0])).toEqual({ kind: 'page', rect: [0, 0, A4.width, A4.height] });
    expect(viewer.notice).toBeNull();
  });

  it('the preview only moves the guides', () => {
    const { doc, viewer } = setup();
    viewer.marginPreviewMm = 40;
    expect(viewer.guideMarginOn(doc.pages[0])).toBeCloseTo((40 * 72) / 25.4, 6);
    expect(viewer.marginMm).toBe(25);
    expect(viewer.limitFor(doc.pages[0]).kind).toBe('page');
    viewer.marginPreviewMm = null;
    expect(viewer.guideMarginOn(doc.pages[0])).toBeNull();
  });
});
