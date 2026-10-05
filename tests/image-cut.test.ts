import { describe, expect, it } from 'vitest';
import type { Annotation, ImageAnnotation } from '../src/lib/annotations';
import { cropRectPx, planCuts } from '../src/lib/image-cut';
import { normalizeCrop } from '../src/lib/image-crop';

const img = (id: string, over: Partial<ImageAnnotation> = {}): ImageAnnotation => ({
  id,
  type: 'image',
  role: 'image',
  color: [0, 0, 0],
  opacity: 1,
  dataUrl: '',
  imageKey: 'img-a',
  rotate: 0,
  rect: [0, 0, 100, 100],
  ...over,
});
const sizes: Record<string, [number, number]> = { 'img-a': [400, 300], 'img-b': [100, 100] };
const sizeOf = (k: string) => sizes[k];
const keyOf = (a: Annotation) => (a.type === 'image' ? a.imageKey : undefined);

describe('cutting cropped images when writing', () => {
  it('crops are on whole pixels, and cut exactly there', () => {
    const c = normalizeCrop([0.1234, 0.25, 0.6789, 0.999], [400, 300]);
    expect(c.map((v, i) => v * [400, 300][i % 2])).toEqual([49, 75, 272, 300]);
    expect(cropRectPx(c, [400, 300])).toEqual([49, 75, 223, 225]);
  });

  it('without crops, the plans are passed on untouched (the file is written exactly as before)', () => {
    const plans = [{ annots: [img('a'), img('b', { imageKey: 'img-b' })] as Annotation[] }, { annots: undefined }];
    const r = planCuts(plans, sizeOf);
    expect(r.cuts).toEqual([]);
    expect(r.plans[0]).toBe(plans[0]);
    expect(r.plans[1]).toBe(plans[1]);
  });

  it('one cut per original and pixel area: the same crop is shared, others get their own; uncropped share the original', () => {
    const left: [number, number, number, number] = [0, 0, 0.5, 1];
    const plans = [
      { annots: [img('a', { crop: left }), img('b', { crop: left }), img('c', { crop: [0.5, 0, 1, 1] })] as Annotation[] },
      { annots: [img('d'), img('e', { crop: left })] as Annotation[] },
    ];
    const before = JSON.stringify(plans);
    const r = planCuts(plans, sizeOf);
    expect(r.cuts.map((c) => c.rect)).toEqual([
      [0, 0, 200, 300],
      [200, 0, 200, 300],
    ]);
    const keys = r.plans.flatMap((p) => p.annots!.map(keyOf));
    expect(keys).toEqual([r.cuts[0].key, r.cuts[0].key, r.cuts[1].key, 'img-a', r.cuts[0].key]);
    // No crop is left in what's written; the session's objects are unchanged.
    expect(r.plans.flatMap((p) => p.annots!).some((a) => a.type === 'image' && a.crop)).toBe(false);
    expect(JSON.stringify(plans)).toBe(before);
  });

  it('a crop of the whole image (or of a missing image) is written as the original, with no crop', () => {
    const r = planCuts([{ annots: [img('a', { crop: [0, 0, 1, 1] }), img('m', { imageKey: 'gone', crop: [0, 0, 0.5, 0.5] })] as Annotation[] }], sizeOf);
    expect(r.cuts).toEqual([]);
    expect(r.plans[0].annots!.map(keyOf)).toEqual(['img-a', 'gone']);
    expect(r.plans[0].annots!.some((a) => a.type === 'image' && a.crop)).toBe(false);
  });
});
