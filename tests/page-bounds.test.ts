// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { bounds, type Annotation, type Rect } from '../src/lib/annotations';
import { boxOf, clampMove, fitIntoPage, growInside, inside, intoPage, limitRect, MIN_TEXT_WIDTH, newTextBoxSpan, placeInside } from '../src/lib/page-bounds';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';
import { OBJECT_STRINGS } from '../src/lib/strings';

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

describe('the limit: page or margin', () => {
  const page: Rect = [0, 0, 600, 800];
  it('the page when the margin isn\'t a limit', () => {
    expect(limitRect(page, null, [10, 10, 50, 50])).toEqual({ rect: page, kind: 'page' });
  });

  it('the margin rectangle for objects inside it', () => {
    expect(limitRect(page, 70, [100, 100, 200, 200])).toEqual({ rect: [70, 70, 530, 730], kind: 'margin' });
  });

  it('an edge already past the margin is limited where it is (it can only move inward); the others at the margin', () => {
    const r = limitRect(page, 70, [20, 100, 200, 780]).rect;
    expect(r).toEqual([20, 70, 530, 780]);
    // It can move right (inward) but not further left; up it may go to where it is, not past.
    expect(clampMove([20, 100, 200, 780], r, -30, 10)).toMatchObject({ dx: 0, dy: 0, limited: true });
    expect(clampMove([20, 100, 200, 780], r, 40, -10)).toMatchObject({ dx: 40, dy: -10, limited: false });
  });

  it('never past the page, whatever the margin', () => {
    expect(limitRect(page, -10, null).rect).toEqual(page);
  });
});

describe('the View settings for margins', () => {
  const fakePdf = { getPage: async () => ({ rotate: 0, getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
  function viewerOf() {
    const doc = new EditorDocument();
    const src = new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf);
    src.sizes = [{ width: 612, height: 792 }];
    src.views = [[0, 0, 612, 792]];
    doc.sources.set('s', src);
    doc.pages = [{ id: 'p0', sourceId: 's', sourceIndex: 0, rotation: 0 }] as PageRef[];
    return { doc, viewer: new Viewer(doc) };
  }

  it('default: margins hidden, 25 mm, not a limit; smart guides on', () => {
    const { viewer, doc } = viewerOf();
    expect([viewer.showMargins, viewer.smartGuides, viewer.marginMm]).toEqual([false, true, 25]);
    expect(viewer.marginOn(doc.pages[0])).toBeCloseTo((25 * 72) / 25.4, 6);
    expect(viewer.limitFor(doc.pages[0]).kind).toBe('page');
  });

  it('Show margins is the limit too: on, the margin; off, the page', () => {
    const { viewer, doc } = viewerOf();
    viewer.toggleMargins();
    expect(viewer.limitFor(doc.pages[0])).toMatchObject({ kind: 'margin', rect: [70.87, 70.87, 541.13, 721.13].map((v) => expect.closeTo(v, 1)) });
    viewer.toggleMargins();
    expect(viewer.limitFor(doc.pages[0]).kind).toBe('page');
  });

  it('turning the margins on or off never moves anything', () => {
    const { viewer, doc } = viewerOf();
    const outside: Annotation = { id: 'a', type: 'stamp', label: 'A', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [10, 10, 100, 40] };
    doc.pages = [{ ...doc.pages[0], annots: [outside] }];
    const before = doc.pages;
    viewer.toggleMargins();
    viewer.toggleMargins();
    viewer.toggleMargins();
    expect(doc.pages).toBe(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('text taken over from the PDF keeps to the page only', () => {
    const { viewer, doc } = viewerOf();
    viewer.showMargins = true;
    expect(viewer.limitFor(doc.pages[0], null, { ignoreMargin: true }).kind).toBe('page');
  });

  it('the hint shows at most twice per document, one at a time; the announcement at most once a second', () => {
    const { viewer } = viewerOf();
    const announced: string[] = [];
    viewer.announce = (t: string) => void announced.push(t);
    // (Read through a function: TypeScript would narrow it after the assignments below.)
    const shown = () => viewer.notice?.text ?? null;
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      viewer.limitHit('p0', 'margin');
      expect(shown()).toBe(OBJECT_STRINGS.marginHint);
      // Still showing: not shown (or counted) again.
      viewer.limitHit('p0', 'margin');
      viewer.notice = null;
      now += 1500;
      viewer.limitHit('p0', 'margin');
      expect(shown()).toBe(OBJECT_STRINGS.marginHint);
      viewer.notice = null;
      now += 1500;
      viewer.limitHit('p0', 'margin');
      expect(shown()).toBeNull();
      // Announced each time a second had passed (three times), not on the repeat in the same second.
      expect(announced).toEqual([OBJECT_STRINGS.marginStop, OBJECT_STRINGS.marginStop, OBJECT_STRINGS.marginStop]);
    } finally {
      Date.now = realNow;
    }
  });
});

describe('the margin as a limit', () => {
  const page: Rect = [0, 0, 612, 792];
  const M = (25 * 72) / 25.4;
  const margin = limitRect(page, M).rect;
  const box: Rect = [200, 300, 300, 340];

  it('each side stops exactly at the margin line', () => {
    expect(clampMove(box, margin, -1000, 0).dx).toBeCloseTo(M - 200, 6);
    expect(clampMove(box, margin, 1000, 0).dx).toBeCloseTo(612 - M - 300, 6);
    expect(clampMove(box, margin, 0, -1000).dy).toBeCloseTo(M - 300, 6);
    expect(clampMove(box, margin, 0, 1000).dy).toBeCloseTo(792 - M - 340, 6);
    expect(clampMove(box, margin, 10, 10)).toMatchObject({ dx: 10, dy: 10, limited: false });
  });

  it('a turned image is limited by its real (turned) extent', () => {
    const img: Annotation = { id: 'i', type: 'image', role: 'image', dataUrl: '', color: [0, 0, 0], opacity: 1, rotate: 0, angle: 45, rect: [200, 300, 300, 400] };
    const b = bounds(img);
    expect(b[0]).toBeLessThan(200);
    const m = clampMove(b, margin, -1000, 0);
    expect(b[0] + m.dx).toBeCloseTo(M, 6);
  });

  it('a group or several objects are clamped as one block', () => {
    const a: Annotation = { id: 'a', type: 'stamp', label: 'A', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [200, 300, 260, 330] };
    const b: Annotation = { id: 'b', type: 'stamp', label: 'B', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [320, 380, 400, 420] };
    const block = boxOf([a, b])!;
    const m = clampMove(block, margin, 2000, 0);
    // The block's right edge (b's) stops at the margin; a moves by the same amount.
    expect(block[2] + m.dx).toBeCloseTo(612 - M, 6);
  });

  it('an edge already past the margin stays where it is (it can only move inward)', () => {
    const out: Rect = [20, 300, 120, 340];
    const lim = limitRect(page, M, out).rect;
    expect(lim[0]).toBe(20);
    expect(clampMove(out, lim, -50, 0).dx).toBe(0);
    expect(clampMove(out, lim, 30, 0).dx).toBe(30);
  });

  it('a text box growing past the bottom margin moves up, then is full', () => {
    // Screen space, y down: the margin's bottom at 792 - M.
    const screen: Rect = [M, M, 612 - M, 792 - M];
    expect(growInside([100, 600, 300, 792 - M + 20], screen)).toEqual({ dy: -20, fits: true });
    expect(growInside([100, M, 300, 792 - M + 20], screen).fits).toBe(false);
  });
});
