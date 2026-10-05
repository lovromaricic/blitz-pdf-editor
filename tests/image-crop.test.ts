import { describe, expect, it } from 'vitest';
import { contentTurn, uprightSize, type ImageAnnotation, type Rect } from '../src/lib/annotations';
import { applyCropView, enterCropFor, sameCrop, applyRatio, cropPixels, dragHandle, enterCrop, FULL, isFull, moveImage, normalizeCrop, ratioValue, resizeFromCorner, viewToCrop, type Crop } from '../src/lib/image-crop';

const PX: [number, number] = [800, 600];
const close = (a: number[], b: number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('crop values', () => {
  it('normalizes: ordered, inside the image, at least 16 px of the original', () => {
    expect(normalizeCrop([0.6, 0.5, 0.2, -0.1], PX)).toEqual([0.2, 0, 0.6, 0.5]);
    const tiny = normalizeCrop([0.5, 0.5, 0.501, 0.5], PX);
    close(cropPixels(tiny, PX), [16, 16]);
    expect(normalizeCrop([0.99, 0.99, 1.2, 1.2], PX)[0]).toBeCloseTo(1 - 16 / 800, 9);
    expect(isFull(FULL)).toBe(true);
    expect(isFull([0, 0, 1, 0.999])).toBe(false);
  });
});

describe('crop mode geometry (the object\'s frame, view units)', () => {
  it('the current crop fills the frame; the rest of the original lies around it at the same scale', () => {
    const v = enterCrop([0.25, 0.5, 0.75, 1], 200, 150);
    close(v.frame, [-100, -75, 200, 150]);
    close(v.image, [-200, -225, 400, 300]);
    close(viewToCrop(v), [0.25, 0.5, 0.75, 1]);
  });

  it('flips mirror where the crop sits (and convert back)', () => {
    const c: Crop = [0.1, 0.2, 0.4, 0.6];
    for (const [fx, fy] of [[true, false], [false, true], [true, true]] as const) {
      const v = enterCrop(c, 120, 160, fx, fy);
      close(viewToCrop(v, fx, fy), c);
    }
    // Flipped left-right: the crop of the left part is shown at the image's right side.
    const v = enterCrop([0, 0, 0.5, 1], 100, 100, true);
    expect(v.image[0]).toBeCloseTo(-150, 6);
  });

  it('handles resize within the image and above the minimum; a ratio is kept from the opposite corner', () => {
    const v = enterCrop([0.25, 0.25, 0.75, 0.75], 400, 300); // image 800 x 600 view units = 1 per px
    const wider = dragHandle(v, [1, 0], 1000, 0, PX);
    expect(wider.frame[0] + wider.frame[2]).toBeCloseTo(v.image[0] + v.image[2], 6); // stops at the image's edge
    const small = dragHandle(v, [-1, -1], 1000, 1000, PX);
    close([small.frame[2], small.frame[3]], [16, 16]);
    const square = dragHandle(v, [1, 1], 50, -10, PX, 1);
    expect(square.frame[2]).toBeCloseTo(square.frame[3], 6);
    expect(square.frame[0]).toBeCloseTo(v.frame[0], 6); // anchored at the top-left
  });

  it('moving the image keeps the frame still and inside the image', () => {
    const v = enterCrop([0.25, 0.25, 0.75, 0.75], 400, 300);
    const m = moveImage(v, 50, -30);
    close(m.frame, v.frame);
    close(viewToCrop(m), [0.25 - 50 / 800, 0.25 + 30 / 600, 0.75 - 50 / 800, 0.75 + 30 / 600]);
    const far = moveImage(v, 5000, 5000);
    close(viewToCrop(far), [0, 0, 0.5, 0.5]);
  });

  it('ratio presets: the largest frame of that ratio inside the current one; portrait swaps', () => {
    const v = enterCrop(FULL, 800, 600);
    const sq = applyRatio(v, ratioValue('1:1', PX, false));
    close([sq.frame[2], sq.frame[3]], [600, 600]);
    expect(ratioValue('16:9', PX, false)).toBeCloseTo(16 / 9, 9);
    expect(ratioValue('16:9', PX, true)).toBeCloseTo(9 / 16, 9);
    expect(ratioValue('original', PX, false)).toBeCloseTo(4 / 3, 9);
    expect(ratioValue('original', PX, true)).toBeCloseTo(3 / 4, 9);
    expect(ratioValue('free', PX, true)).toBeNull();
    const tall = applyRatio(v, ratioValue('3:2', PX, true));
    close([tall.frame[2] / tall.frame[3]], [2 / 3]);
  });

  it('keyboard: Alt+arrows resize from the bottom-right corner', () => {
    const v = enterCrop([0.25, 0.25, 0.75, 0.75], 400, 300);
    const r = resizeFromCorner(v, -10, -1, PX, null);
    close(r.frame, [v.frame[0], v.frame[1], 390, 299]);
  });

  it('scale and turn don\'t matter: everything is relative to the frame', () => {
    for (const k of [0.5, 1, 3]) {
      const v = enterCrop([0.1, 0.1, 0.6, 0.6], 500 * k, 500 * k);
      close(viewToCrop(moveImage(v, 10 * k, 0)), viewToCrop(moveImage(enterCrop([0.1, 0.1, 0.6, 0.6], 500, 500), 10, 0)));
    }
  });
});

describe('applying a crop (points, the object as shown)', () => {
  // Where a point of the original (0..1, as shown, before flips) lands on the page.
  const at = (a: ImageAnnotation, u: number, v: number): [number, number] => {
    const c = a.crop ?? FULL;
    let s = (u - c[0]) / (c[2] - c[0]);
    let t = (v - c[1]) / (c[3] - c[1]);
    if (a.flipX) s = 1 - s;
    if (a.flipY) t = 1 - t;
    const [w, h] = uprightSize(a);
    const x = (s - 0.5) * w;
    const yd = (t - 0.5) * h;
    const r = (contentTurn(a) * Math.PI) / 180;
    return [(a.rect[0] + a.rect[2]) / 2 + x * Math.cos(r) + yd * Math.sin(r), (a.rect[1] + a.rect[3]) / 2 + x * Math.sin(r) - yd * Math.cos(r)];
  };
  const base = (over: Partial<ImageAnnotation> = {}): ImageAnnotation => ({
    id: 'i',
    type: 'image',
    role: 'image',
    color: [0, 0, 0],
    opacity: 1,
    dataUrl: '',
    imageKey: 'k',
    rotate: 0,
    angle: 0,
    rect: [100, 100, 500, 400],
    ...over,
  });

  for (const over of [{}, { angle: 30 }, { rotate: 90, rect: [100, 100, 400, 500] as Rect }, { angle: -45, flipX: true }, { rotate: 270, rect: [100, 100, 400, 500] as Rect, flipY: true, angle: 12 }]) {
    it(`keeps every visible pixel where it was, at the same scale: ${JSON.stringify(over)}`, () => {
      const a = base(over);
      // Crop: left handle in by 100, bottom handle up by 50, then move the image a little.
      let v = enterCropFor(a);
      v = dragHandle(v, [-1, 0], 100, 0, PX);
      v = dragHandle(v, [0, 1], 0, -50, PX);
      const b = applyCropView(a, v, PX);
      expect(b.crop).toBeDefined();
      close(uprightSize(b), [300, 250], 1);
      for (const [u, w] of [[0.5, 0.4], [0.3, 0.1], [0.9, 0.8]]) close(at(b, u, w), at(a, u, w), 1);
      // Crop again from there, moving the image under the frame: the frame stays put, the content shifts.
      const v2 = moveImage(enterCropFor(b), 40, 0);
      const c = applyCropView(b, v2, PX);
      close(c.rect, b.rect, 1);
      // Uncrop: back to the whole original, at the same scale and place.
      const full = applyCropView(b, { image: enterCropFor(b).image, frame: enterCropFor(b).image }, PX);
      expect(full.crop).toBeUndefined();
      close(uprightSize(full), uprightSize(a), 1);
      close(full.rect, a.rect, 1);
    });
  }

  it('sameCrop: no crop and the full crop are the same', () => {
    expect(sameCrop({}, { crop: [0, 0, 1, 1] })).toBe(true);
    expect(sameCrop({}, { crop: [0, 0, 1, 0.5] })).toBe(false);
  });
});
