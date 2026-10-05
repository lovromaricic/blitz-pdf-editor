// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { bounds, type Annotation, type Rect } from '../src/lib/annotations';
import { boxOf, clampMove, fitIntoPage, growInside, inside, intoPage, MIN_TEXT_WIDTH, newTextBoxSpan, placeInside } from '../src/lib/page-bounds';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';

const PAGE: Rect = [0, 0, 612, 792];
const BOX: Rect = [100, 100, 200, 150];

describe('clamping a move to the page', () => {
  it('inside: unchanged; touching an edge is allowed', () => {
    expect(clampMove(BOX, PAGE, 10, 20)).toEqual({ dx: 10, dy: 20, limited: false });
    expect(clampMove(BOX, PAGE, -100, 0)).toEqual({ dx: -100, dy: 0, limited: false }); // exactly on the left edge
    expect(inside([0, 0, 612, 792], PAGE)).toBe(true);
  });

  it('crossing each edge stops at it', () => {
    expect(clampMove(BOX, PAGE, -150, 0)).toMatchObject({ dx: -100, limited: true }); // left
    expect(clampMove(BOX, PAGE, 500, 0)).toMatchObject({ dx: 412, limited: true }); // right
    expect(clampMove(BOX, PAGE, 0, -150)).toMatchObject({ dy: -100, limited: true }); // bottom (PDF y up)
    expect(clampMove(BOX, PAGE, 0, 700)).toMatchObject({ dy: 642, limited: true }); // top
  });

  it('an object larger than the page doesn\'t move in that direction', () => {
    expect(clampMove([-10, 100, 700, 120], PAGE, 30, 5)).toMatchObject({ dx: 0, dy: 5 });
  });

  it('uses a turned image\'s actual extent, and a block\'s (selection, group) as a whole', () => {
    const img: Annotation = { id: 'i', type: 'image', role: 'image', color: [0, 0, 0], opacity: 1, dataUrl: '', rotate: 0, angle: 45, rect: [100, 100, 200, 200] };
    const b = bounds(img);
    expect(b[2] - b[0]).toBeCloseTo(100 * Math.SQRT2, 1);
    expect(clampMove(b, PAGE, -200, 0).dx).toBeCloseTo(-b[0], 6);
    const a: Annotation = { id: 'a', type: 'shape', shape: 'rect', color: [0, 0, 0], opacity: 1, width: 2, fill: null, from: [10, 10], to: [50, 50], groups: ['group-1'] };
    const c: Annotation = { ...a, id: 'c', from: [500, 700], to: [600, 780] };
    expect(boxOf([a, c])).toEqual([9, 9, 601, 781]);
    expect(clampMove(boxOf([a, c])!, PAGE, 50, 50)).toMatchObject({ dx: 11, dy: 11, limited: true });
  });
});

describe('placing objects just inside', () => {
  const stamp = (rect: Rect): Annotation => ({ id: 's', type: 'stamp', label: 'S', color: [0, 0, 0], opacity: 1, rotate: 0, rect });
  it('moves a block that would land outside just inside, keeping its shape', () => {
    expect(intoPage([-20, 100, 30, 150], PAGE)).toEqual([20, 0]);
    expect(intoPage([590, 780, 640, 800], PAGE)).toEqual([-28, -8]);
    const r = placeInside([stamp([590, 10, 650, 40]), stamp([600, 50, 660, 80])], PAGE);
    expect(r.moved).toBe(true);
    expect(r.members.map((a) => (a as { rect: Rect }).rect)).toEqual([[542, 10, 602, 40], [552, 50, 612, 80]]);
  });

  it('after the page shrank: shrinks an object bigger than the page (same proportions), then moves it in', () => {
    const page: Rect = [100, 100, 300, 300];
    const r = fitIntoPage([stamp([0, 0, 400, 100])], page);
    expect(r.changed).toBe(true);
    const out = (r.members[0] as { rect: Rect }).rect;
    expect(out[2] - out[0]).toBeCloseTo(200, 1);
    expect(out[3] - out[1]).toBeCloseTo(50, 1);
    expect(inside(out, page)).toBe(true);
    expect(fitIntoPage([stamp([150, 150, 200, 200])], page).changed).toBe(false);
  });
});

describe('a text box growing as it is typed in (screen space, y down)', () => {
  const page: Rect = [0, 0, 600, 800];
  it('fits: nothing to do', () => expect(growInside([10, 100, 200, 300], page)).toEqual({ dy: 0, fits: true }));
  it('past the bottom: moves up', () => expect(growInside([10, 700, 200, 850], page)).toEqual({ dy: -50, fits: true }));
  it('as far as the page top allows; taller than the page: refused', () => {
    expect(growInside([10, 30, 200, 830], page)).toEqual({ dy: -30, fits: true });
    expect(growInside([10, 30, 200, 900], page)).toEqual({ dy: -30, fits: false });
  });
});

describe('a new text box near the right edge', () => {
  it('normal width when there is room; narrower near the edge; moved left below the minimum', () => {
    expect(newTextBoxSpan(100, 200, 0, 600)).toEqual({ x: 100, width: 200 });
    expect(newTextBoxSpan(450, 200, 0, 600)).toEqual({ x: 450, width: 150 });
    expect(newTextBoxSpan(570, 200, 0, 600)).toEqual({ x: 600 - MIN_TEXT_WIDTH, width: MIN_TEXT_WIDTH });
    // A page narrower than the minimum: the whole width.
    expect(newTextBoxSpan(10, 200, 0, 40)).toEqual({ x: 0, width: 40 });
  });
});

describe('the boundary in the editor', () => {
  const fakePdf = { getPage: async () => ({ rotate: 0, getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
  function setup() {
    const doc = new EditorDocument();
    const src = new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf);
    src.sizes = [{ width: 612, height: 792 }];
    src.views = [[0, 0, 612, 792]];
    doc.sources.set('s', src);
    doc.pages = [{ id: 'p0', sourceId: 's', sourceIndex: 0, rotation: 0, annots: [{ id: 'a', type: 'stamp', label: 'A', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [540, 700, 600, 730] }] }] as PageRef[];
    const viewer = new Viewer(doc);
    return { doc, viewer, actions: new Actions(doc, viewer) };
  }

  it('page bounds follow the crop (zoom never matters)', () => {
    const { doc } = setup();
    expect(doc.pageBounds(doc.pages[0])).toEqual([0, 0, 612, 792]);
    expect(doc.pageBounds({ ...doc.pages[0], crop: { top: 10, right: 20, bottom: 30, left: 40 } })).toEqual([40, 30, 592, 782]);
  });

  it('duplicate and paste near the edge land just inside', () => {
    const { doc, viewer, actions } = setup();
    viewer.selectAnnot({ pageId: 'p0', id: 'a' });
    actions.duplicateAnnotation(); // +12 right would cross the right edge
    const dup = doc.pages[0].annots![1] as { rect: Rect };
    expect(dup.rect[2]).toBeLessThanOrEqual(612);
    actions.copyAnnotation();
    actions.pasteAnnotation({ pageId: 'p0', point: [610, 790] });
    const pasted = doc.pages[0].annots!.at(-1) as { rect: Rect };
    expect(inside(pasted.rect, [0, 0, 612, 792])).toBe(true);
  });

  it('a crop that leaves objects off the page brings them back, in the same undo step, with one notice', () => {
    const { doc, actions, viewer } = setup();
    const next = [{ ...doc.pages[0], crop: { top: 100, right: 100, bottom: 0, left: 0 } }];
    expect(actions.editPagesKeepingObjects('Crop 1 page', next)).toBe(1);
    const r = (doc.pages[0].annots![0] as { rect: Rect }).rect;
    expect(inside(r, [0, 0, 512, 692])).toBe(true);
    expect(doc.history.undoLabel).toBe('Crop 1 page');
    expect(viewer.notice?.text ?? '').toMatch(/moved back onto the page/);
    doc.undo();
    expect(doc.pages[0].crop).toBeUndefined();
    expect((doc.pages[0].annots![0] as { rect: Rect }).rect).toEqual([540, 700, 600, 730]);
  });
});
