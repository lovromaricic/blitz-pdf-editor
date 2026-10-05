import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
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
import { createFontProvider } from '../src/lib/pdf/font-provider';
import { readFileSync } from 'node:fs';
import { rectFromUpright, uprightSize, uprightTopLeft } from '../src/lib/annotations';

const FONT_FILES: Record<string, string> = {
  sans: 'node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf',
  'sans-bold': 'node_modules/@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf',
  serif: 'node_modules/@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf',
  mono: 'node_modules/@expo-google-fonts/noto-sans-mono/400Regular/NotoSansMono_400Regular.ttf',
};
const fonts = createFontProvider(async (key) => new Uint8Array(readFileSync(FONT_FILES[key])));

// 1x1 red PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

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

describe('saving text, stamps, comments and images', () => {
  const boxed: Annotation[] = [
    { id: 't1', type: 'text', color: [0, 0, 0], opacity: 1, rect: [50, 700, 250, 740], rotate: 0, text: 'Čestitamo, Đurđa! Ćevapi i žličnjaci.', lines: ['Čestitamo, Đurđa!', 'Ćevapi i žličnjaci.'], font: 'sans', size: 12 },
    { id: 'st1', type: 'stamp', color: [0.1, 0.55, 0.2], opacity: 1, rect: [300, 700, 420, 730], rotate: 0, label: 'APPROVED' },
    { id: 'n1', type: 'note', color: [1, 0.85, 0.2], opacity: 1, rect: [500, 700, 522, 722], rotate: 0, text: 'Please check this paragraph.' },
    { id: 'i1', type: 'image', color: [0, 0, 0], opacity: 1, rect: [100, 100, 250, 150], rotate: 90, dataUrl: PNG, role: 'signature' },
  ];

  it('writes FreeText, Stamp, Text and image Stamp annotations with embedded subset fonts', async () => {
    const out = await assemble([{ id: 'a', bytes: await onePage() }], [{ sourceId: 'a', index: 0, rotation: 0, annots: boxed }], 'preserve', { fonts });
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const annots = await (await pdf.getPage(1)).getAnnotations();
    expect(annots.map((a: { subtype: string }) => a.subtype)).toEqual(['FreeText', 'Stamp', 'Text', 'Stamp']);
    const free = annots[0] as { contentsObj: { str: string }; hasAppearance: boolean };
    expect(free.contentsObj.str).toBe('Čestitamo, Đurđa! Ćevapi i žličnjaci.');
    expect(free.hasAppearance).toBe(true);
    expect((annots[2] as { contentsObj: { str: string } }).contentsObj.str).toBe('Please check this paragraph.');
    await pdf.loadingTask.destroy();

    // Both fonts are embedded, and only as subsets: each full font file is over 600 KB.
    const loaded = await PDFDocument.load(out);
    const fontNames = loaded.context
      .enumerateIndirectObjects()
      .map(([, obj]) => (obj as { get?: (k: unknown) => unknown }).get?.(PDFName.of('FontName'))?.toString())
      .filter(Boolean);
    expect(fontNames.some((f) => f!.startsWith('/NotoSans-Regular'))).toBe(true);
    expect(fontNames.some((f) => f!.startsWith('/NotoSans-Bold'))).toBe(true);
    expect(out.length).toBeLessThan(150_000);
  });

  it('refuses to save text without a font provider rather than writing broken text', async () => {
    await expect(
      assemble([{ id: 'a', bytes: await onePage() }], [{ sourceId: 'a', index: 0, rotation: 0, annots: [boxed[0]] }], 'preserve'),
    ).rejects.toThrow(/Fonts are required/);
  });
});

describe('upright boxes on rotated pages', () => {
  it('round-trips the upright top-left corner at every rotation', () => {
    for (const rotate of [0, 90, 180, 270]) {
      const rect = rectFromUpright([100, 200], 80, 30, rotate);
      expect(uprightTopLeft({ rect, rotate })).toEqual([100, 200]);
      expect(uprightSize({ rect, rotate })).toEqual([80, 30]);
    }
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

describe('custom colors', () => {
  // Picker output is quantized to 8-bit steps; these are typical custom picks.
  const c = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const picks = { highlight: c('22AA99'), ink: c('C63838'), stroke: c('3F6FE0'), fill: c('F2C94C'), text: c('6B2FA3'), stamp: c('0E7C66'), note: c('FF8A65') };
  const annots: Annotation[] = [
    { id: 'h', type: 'highlight', color: picks.highlight, opacity: 0.5, rects: [[50, 700, 200, 712]] },
    { id: 'i', type: 'ink', color: picks.ink, opacity: 1, width: 2, paths: [[[100, 100], [120, 130]]] },
    { id: 's', type: 'shape', shape: 'rect', color: picks.stroke, opacity: 1, width: 3, fill: picks.fill, from: [300, 300], to: [400, 350] },
    { id: 't', type: 'text', color: picks.text, opacity: 1, rect: [50, 600, 250, 640], rotate: 0, text: 'Hello', lines: ['Hello'], font: 'sans', size: 12 },
    { id: 'st', type: 'stamp', color: picks.stamp, opacity: 1, rect: [300, 600, 420, 630], rotate: 0, label: 'APPROVED' },
    { id: 'n', type: 'note', color: picks.note, opacity: 1, rect: [500, 600, 522, 622], rotate: 0, text: 'Note' },
  ];

  it('are saved as the exact 8-bit RGB values that were picked', async () => {
    const out = await assemble([{ id: 'a', bytes: await onePage() }], [{ sourceId: 'a', index: 0, rotation: 0, annots }], 'preserve', { fonts });
    const doc = await PDFDocument.load(out);
    const { decodePDFRawStream, PDFDict, PDFRawStream } = await import('@cantoo/pdf-lib');
    const hexes = new Set<string>();
    const toHex = (nums: string[]) => nums.map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    for (const ref of doc.getPage(0).node.Annots()!.asArray()) {
      const annot = doc.context.lookup(ref, PDFDict);
      const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict)?.lookup(PDFName.of('N'));
      if (!(ap instanceof PDFRawStream)) continue;
      // Text boxes draw inside a transparency group (a form XObject of the appearance).
      const xobjects = ap.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      const forms = (xobjects?.values() ?? []).map((r) => doc.context.lookup(r)).filter((x) => x instanceof PDFRawStream) as (typeof ap)[];
      for (const stream of [ap, ...forms]) {
        const ops = new TextDecoder().decode(decodePDFRawStream(stream).decode());
        for (const m of ops.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:rg|RG)/g)) hexes.add(toHex(m.slice(1, 4)));
      }
    }
    for (const [name, rgb] of Object.entries(picks)) expect(hexes, name).toContain(toHex(rgb.map(String)));
  });
});

describe('comment icon', () => {
  it('is one closed path: box and tail together', async () => {
    const { bubblePath, toSvgPath } = await import('../src/lib/note-shape');
    const segs = bubblePath();
    expect(segs[0][0]).toBe('M');
    expect(segs.at(-1)![0]).toBe('Z');
    expect(segs.filter((s) => s[0] === 'M')).toHaveLength(1);
    // The tail tip is part of the outline.
    expect(segs.some((s) => s[0] === 'L' && s[2] < 2)).toBe(true);
    expect(toSvgPath(segs).match(/M/g)).toHaveLength(1);
  });

  it('saves the bubble as one filled-and-stroked closed path with round joins, as a Text annotation', async () => {
    const note: Annotation = { id: 'n', type: 'note', color: [1, 0.85, 0.2], opacity: 1, rect: [100, 100, 122, 122], rotate: 0, text: 'Hello' };
    const out = await assemble([{ id: 'a', bytes: await onePage() }], [{ sourceId: 'a', index: 0, rotation: 0, annots: [note] }], 'preserve', { fonts });
    const doc = await PDFDocument.load(out);
    const { decodePDFRawStream, PDFDict, PDFRawStream } = await import('@cantoo/pdf-lib');
    const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
    expect(annot.get(PDFName.of('Subtype'))?.toString()).toBe('/Text');
    expect(annot.get(PDFName.of('Border'))?.toString().replace(/\s+/g, ' ').trim()).toBe('[ 0 0 0 ]');
    const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict)!.lookup(PDFName.of('N'));
    if (!(ap instanceof PDFRawStream)) throw new Error('no appearance');
    const ops = new TextDecoder().decode(decodePDFRawStream(ap).decode());
    expect(ops).toContain('1 J 1 j');
    // Exactly one subpath before the fill-and-stroke (B), and it is closed (h).
    const bubble = ops.slice(0, ops.indexOf(' B'));
    expect(bubble.match(/ m\b/g)).toHaveLength(1);
    expect(bubble.trimEnd().endsWith('h')).toBe(true);
    // Still a real comment for other viewers.
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const [read] = await (await pdf.getPage(1)).getAnnotations();
    expect(read.subtype).toBe('Text');
    expect(read.contentsObj.str).toBe('Hello');
    await pdf.loadingTask.destroy();
  });
});

describe('stamps in the saved PDF', () => {
  it('draw only their own border: no viewer border, one stroke in the stamp color', async () => {
    const stamp: Annotation = { id: 's', type: 'stamp', label: 'VOID', color: [0.8, 0.1, 0.1], opacity: 0.6, rect: [100, 100, 200, 130], rotate: 0 };
    const out = await assemble([{ id: 'a', bytes: await onePage() }], [{ sourceId: 'a', index: 0, rotation: 0, annots: [stamp] }], 'preserve', { fonts });
    const doc = await PDFDocument.load(out);
    const { decodePDFRawStream, PDFDict, PDFRawStream } = await import('@cantoo/pdf-lib');
    const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
    expect(annot.get(PDFName.of('Subtype'))?.toString()).toBe('/Stamp');
    expect(annot.get(PDFName.of('Border'))?.toString().replace(/\s+/g, ' ').trim()).toBe('[ 0 0 0 ]');
    const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict)!.lookup(PDFName.of('N'));
    if (!(ap instanceof PDFRawStream)) throw new Error('no appearance');
    const ops = new TextDecoder().decode(decodePDFRawStream(ap).decode());
    // One stroked shape, and the only stroke color is the stamp's own.
    expect(ops.match(/\bS\b/g)).toHaveLength(1);
    expect([...ops.matchAll(/([\d.]+ [\d.]+ [\d.]+) RG/g)].map((m) => m[1])).toEqual(['0.8 0.1 0.1']);
  });
});
