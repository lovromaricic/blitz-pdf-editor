import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  bounds,
  mergeLineRects,
  remap,
  simplifyPath,
  translate,
  type Annotation,
} from '../src/lib/annotations';
import { assemble } from '../src/lib/pdf/assemble';

const yellow: [number, number, number] = [1, 0.92, 0.23];

const sample: Annotation[] = [
  { id: 'h1', type: 'highlight', color: yellow, opacity: 0.5, rects: [[50, 700, 200, 712], [50, 680, 150, 692]] },
  { id: 'i1', type: 'ink', color: [1, 0, 0], opacity: 1, width: 2, paths: [[[100, 100], [120, 130], [140, 100]]] },
  { id: 's1', type: 'shape', shape: 'rect', color: [0, 0, 1], opacity: 1, width: 3, fill: null, from: [300, 300], to: [400, 350] },
  { id: 's2', type: 'shape', shape: 'ellipse', color: [0, 0, 0], opacity: 0.8, width: 1, fill: [0.9, 0.9, 0.9], from: [300, 400], to: [400, 480] },
  { id: 's3', type: 'shape', shape: 'arrow', color: [0, 0, 0], opacity: 1, width: 2, fill: null, from: [50, 50], to: [200, 120] },
];

async function onePage() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe('saving annotations', () => {
  it('writes standard annotations that PDF.js reads back', async () => {
    const out = await assemble([{ id: 'a', bytes: await onePage() }], [{ sourceId: 'a', index: 0, rotation: 0, annots: sample }], 'preserve');

    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const annots = await (await pdf.getPage(1)).getAnnotations();
    expect(annots.map((a: { subtype: string }) => a.subtype)).toEqual(['Highlight', 'Ink', 'Square', 'Circle', 'Line']);

    const hl = annots[0] as { quadPoints: Float32Array; color: Uint8ClampedArray; hasAppearance: boolean };
    expect(hl.hasAppearance).toBe(true);
    expect(Array.from(hl.color)).toEqual([255, 235, 59]);
    expect(hl.quadPoints.length).toBe(16);

    const line = annots[4] as { lineCoordinates: number[] };
    expect(Array.from(line.lineCoordinates)).toEqual([50, 50, 200, 120]);
    await pdf.loadingTask.destroy();
  });

  it('keeps annotations on the right page through reordering and extraction', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    doc.addPage([500, 700]);
    const bytes = await doc.save();
    const out = await assemble(
      [{ id: 'a', bytes }],
      [
        { sourceId: 'a', index: 1, rotation: 0 },
        { sourceId: 'a', index: 0, rotation: 90, annots: [sample[0]] },
      ],
      'fresh',
    );
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPage(0).node.Annots()).toBeUndefined();
    expect(loaded.getPage(1).node.Annots()?.size()).toBe(1);
  });
});

describe('annotation geometry', () => {
  it('bounds include stroke width and arrowheads', () => {
    expect(bounds(sample[2])).toEqual([298.5, 298.5, 401.5, 351.5]);
    const arrow = bounds(sample[4]);
    expect(arrow[2]).toBeGreaterThan(201);
  });

  it('translate and remap move geometry without mutating', () => {
    const moved = translate(sample[2], 10, -5) as Extract<Annotation, { type: 'shape' }>;
    expect(moved.from).toEqual([310, 295]);
    expect((sample[2] as Extract<Annotation, { type: 'shape' }>).from).toEqual([300, 300]);
    const scaled = remap(sample[1], [100, 100, 140, 130], [0, 0, 80, 60]) as Extract<Annotation, { type: 'ink' }>;
    expect(scaled.paths[0]).toEqual([[0, 0], [40, 60], [80, 0]]);
  });

  it('merges selection rectangles into one per line', () => {
    const rects: [number, number, number, number][] = [
      [10, 100, 50, 112],
      [52, 101, 90, 111],
      [10, 80, 70, 92],
      [0, 0, 0.2, 0.2],
    ];
    expect(mergeLineRects(rects)).toEqual([
      [10, 100, 90, 112],
      [10, 80, 70, 92],
    ]);
  });

  it('simplifies dense paths but keeps the end points', () => {
    const pts: [number, number][] = [[0, 0], [0.2, 0], [0.4, 0], [5, 0], [5.1, 0]];
    expect(simplifyPath(pts, 1)).toEqual([[0, 0], [5, 0], [5.1, 0]]);
  });
});
