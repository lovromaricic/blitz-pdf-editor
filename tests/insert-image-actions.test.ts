// @vitest-environment happy-dom
// Insert image through the same action the Page menu, drag and drop and paste
// use: placement on the current page, one undo step, and the object commands.
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';
import type { Annotation, ImageAnnotation } from '../src/lib/annotations';
import { defaultImageSize } from '../src/lib/image-geometry';
import { makeJpeg, makePng, marker } from './image-fixtures';

/** A Letter-size PDF as PDF.js would present it, unrotated (only what the editor asks for). */
const fakePdf = {
  getPage: async () => ({
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({
      convertToViewportPoint: (x: number, y: number) => [x * scale, (792 - y) * scale],
      convertToPdfPoint: (x: number, y: number) => [x / scale, 792 - y / scale],
    }),
  }),
} as unknown as PDFDocumentProxy;

function setup(pageCount = 3) {
  const doc = new EditorDocument();
  doc.sources.set('s', new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf));
  doc.pages = Array.from({ length: pageCount }, (_, i): PageRef => ({ id: `p${i}`, sourceId: 's', sourceIndex: i, rotation: 0 }));
  const viewer = new Viewer(doc);
  return { doc, viewer, actions: new Actions(doc, viewer) };
}

const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes as BlobPart], name, { type });
const photo = () => file(makeJpeg(400, 600, marker(400, 600), 6), 'portrait.jpg', 'image/jpeg');
const png = () => file(makePng(300, 150, (x) => (x < 150 ? [0, 0, 0, 255] : [0, 0, 0, 0])), 'logo.png', 'image/png');
const images = (p: PageRef) => (p.annots ?? []).filter((a): a is ImageAnnotation => a.type === 'image');
const center = (a: ImageAnnotation) => [(a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2];

describe('Insert image', () => {
  it('places the image on the page selected in the rail, centered, sized, selected, as one undo step', async () => {
    const { doc, viewer, actions } = setup();
    viewer.select('p1');
    await actions.insertImageFiles([photo()]);
    const [a] = images(doc.pages[1]);
    expect(images(doc.pages[0])).toHaveLength(0);
    expect(a).toMatchObject({ role: 'image', rotate: 0, angle: 0, opacity: 1 });
    // Portrait, upright: 400 × 600 px is 300 × 450 pt, shrunk to 40% of the page height (316.8 pt).
    const [w, h] = defaultImageSize([400, 600], [612, 792]);
    expect(a.rect[2] - a.rect[0]).toBeCloseTo(w);
    expect(a.rect[3] - a.rect[1]).toBeCloseTo(h);
    expect(h).toBeCloseTo(316.8);
    expect(center(a)).toEqual([306, 396]);
    expect(viewer.tool).toBe('select');
    expect(viewer.selectedAnnot).toEqual({ pageId: 'p1', id: a.id });
    expect(doc.history.undoLabel).toBe('Insert image');
    doc.undo();
    expect(images(doc.pages[1])).toHaveLength(0);
    expect(doc.history.canUndo).toBe(false);
  });

  it('uses the current page when nothing is selected, and offsets several images', async () => {
    const { doc, viewer, actions } = setup();
    viewer.currentIndex = 2;
    await actions.insertImageFiles([png(), png()]);
    const [first, second] = images(doc.pages[2]);
    expect(doc.history.undoLabel).toBe('Insert 2 images');
    // 16 px at the current zoom, right and down.
    const step = 16 / viewer.scale;
    expect(center(second)[0] - center(first)[0]).toBeCloseTo(step);
    expect(center(second)[1] - center(first)[1]).toBeCloseTo(-step);
    // The same picture twice is kept once.
    expect(first.imageKey).toBe(second.imageKey);
  });

  it('lands where it was dropped', async () => {
    const { doc, actions } = setup();
    await actions.insertImageFiles([png()], { index: 0, point: [100, 200] });
    expect(center(images(doc.pages[0])[0])).toEqual([100, 792 - 200]);
  });

  it('says so for an unsupported type and changes nothing', async () => {
    const { doc, viewer, actions } = setup();
    await actions.insertImageFiles([file(new TextEncoder().encode('hello'), 'notes.txt', 'text/plain')]);
    expect(viewer.notice?.text).toBe("That image type isn't supported. Try JPG or PNG.");
    expect(doc.history.canUndo).toBe(false);
  });

  it('orders, flips, deletes, copies and pastes like every other object, one step each', async () => {
    const { doc, viewer, actions } = setup(1);
    const ink: Annotation = { id: 'ink', type: 'ink', color: [0, 0, 0], opacity: 1, width: 2, paths: [[[10, 10], [500, 700]]] };
    doc.pages = [{ ...doc.pages[0], annots: [ink] }];
    await actions.insertImageFiles([png()]);
    const id = viewer.selectedAnnot!.id;
    const order = () => doc.pages[0].annots!.map((a) => a.id);
    const steps = () => doc.history.undoLabel;

    // Inserted on top of the drawing.
    expect(order()).toEqual(['ink', id]);
    expect(actions.canMoveLayer('p0', id, 'front')).toBe(false);
    actions.moveLayer('p0', id, 'back');
    expect(order()).toEqual([id, 'ink']);
    expect(steps()).toBe('Send to back');
    expect(actions.canMoveLayer('p0', id, 'back')).toBe(false);
    actions.moveLayer('p0', id, 'front');
    expect(order()).toEqual(['ink', id]);
    expect(steps()).toBe('Bring to front');

    const image = () => doc.pages[0].annots!.find((a) => a.id === id) as ImageAnnotation;
    actions.updateAnnotation('p0', { ...image(), flipX: true }, 'Flip image');
    actions.updateAnnotation('p0', { ...image(), flipY: true }, 'Flip image');
    expect(image()).toMatchObject({ flipX: true, flipY: true });

    actions.copyAnnotation();
    actions.pasteAnnotation();
    expect(doc.pages[0].annots).toHaveLength(3);
    expect(steps()).toBe('Paste image');
    const pasted = doc.pages[0].annots![2] as ImageAnnotation;
    expect(pasted).toMatchObject({ imageKey: image().imageKey, flipX: true, flipY: true });

    actions.duplicateAnnotation();
    expect(doc.pages[0].annots).toHaveLength(4);
    expect(steps()).toBe('Duplicate image');

    actions.deleteAnnotation('p0', id);
    expect(doc.pages[0].annots!.some((a) => a.id === id)).toBe(false);
    expect(steps()).toBe('Delete image');

    // Each of those was exactly one step: undo walks back through them in order.
    const labels: string[] = [];
    while (doc.history.canUndo) {
      labels.push(doc.history.undoLabel!);
      doc.undo();
    }
    expect(labels).toEqual(['Delete image', 'Duplicate image', 'Paste image', 'Flip image', 'Flip image', 'Bring to front', 'Send to back', 'Insert image']);
  });
});
