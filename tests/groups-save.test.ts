// Groups exist only in the editor: the saved PDF is exactly the one without them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import type { Annotation } from '../src/lib/annotations';
import { assemble } from '../src/lib/pdf/assemble';
import { groupUnits } from '../src/lib/object-selection';

const objects: Annotation[] = [
  { id: 'r', type: 'shape', shape: 'rect', color: [0.8, 0, 0], opacity: 1, width: 2, fill: [0.9, 0.1, 0.1], from: [100, 480], to: [300, 650] },
  { id: 'e', type: 'shape', shape: 'ellipse', color: [0, 0, 0.7], opacity: 0.5, width: 2, fill: [0.1, 0.2, 0.9], from: [220, 440], to: [420, 640] },
  { id: 'h', type: 'highlight', color: [1, 0.84, 0.04], opacity: 1, rects: [[120, 500, 380, 520]] },
  { id: 'i', type: 'ink', color: [0, 0.5, 0], opacity: 0.8, width: 8, paths: [[[110, 470], [410, 630]]] },
  { id: 'n', type: 'note', text: 'A comment', color: [1, 0.85, 0.2], opacity: 1, rotate: 0, rect: [430, 700, 452, 722] } as Annotation,
];

describe('saving groups', () => {
  afterEach(() => vi.useRealTimers());

  it('writes exactly the same PDF as the same objects without groups', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T12:00:00Z'), toFake: ['Date'] });
    const src = await PDFDocument.create();
    src.addPage([612, 792]);
    const bytes = await src.save();
    // Nested: (r, (e, h)) as one group; i and n on their own.
    const grouped = groupUnits(groupUnits(objects, ['e', 'h'], 'group-in'), ['r', 'group-in'], 'group-out');
    expect(grouped.map((a) => a.id)).toEqual(['r', 'e', 'h', 'i', 'n']);
    expect(grouped.some((a) => a.groups)).toBe(true);
    const save = (annots: readonly Annotation[]) => assemble([{ id: 's', bytes }], [{ pageId: 'p', sourceId: 's', index: 0, rotation: 0, annots }], 'preserve');
    const a = await save(objects);
    const b = await save(grouped);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
  });
});
