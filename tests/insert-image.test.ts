import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareInsertImage, sniffImage, UnsupportedImageError } from '../src/lib/image-prepare';
import {
  applyMatrix,
  clampFrame,
  defaultImageSize,
  frameCorners,
  frameToImage,
  imageFrame,
  multiply,
  orientationMatrix,
  resizeFrame,
  turnFrame,
  uprightImageMatrix,
  type Frame,
} from '../src/lib/image-geometry';
import { bounds, type ImageAnnotation, type Point } from '../src/lib/annotations';
import { makeJpeg, makePng, marker } from './image-fixtures';

const close = (a: readonly number[], b: readonly number[], d = 0.01) => a.every((v, i) => Math.abs(v - b[i]) < d);

describe('preparing an inserted image', () => {
  it('keeps a portrait phone photo (EXIF orientation 6) byte for byte, upright size', async () => {
    // Shown 40 × 60 (portrait); stored 60 × 40 with orientation 6, like a phone camera.
    const photo = makeJpeg(40, 60, marker(40, 60), 6);
    const img = await prepareInsertImage(photo, false);
    expect(img.kind).toBe('jpeg');
    expect(img.bytes).toBe(photo);
    expect(img.orientation).toBe(6);
    expect([img.width, img.height]).toEqual([40, 60]);
    expect(img.downscaledFrom).toBeUndefined();
  });

  it('keeps a transparent PNG as it is (transparency is never flattened)', async () => {
    const png = makePng(30, 20, (x) => (x < 15 ? [0, 128, 0, 255] : [0, 0, 0, 0]));
    const img = await prepareInsertImage(png, false);
    expect(img).toMatchObject({ kind: 'png', orientation: 1, width: 30, height: 20 });
    expect(img.bytes).toBe(png);
  });

  describe('through a canvas', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Browser stand-ins: a decoded bitmap of the given size and a canvas whose pixels are opaque or not. */
    function stubCanvas(width: number, height: number, transparent: boolean) {
      const drawn: number[][] = [];
      vi.stubGlobal('createImageBitmap', async () => ({ width, height, close() {} }));
      vi.stubGlobal(
        'OffscreenCanvas',
        class {
          constructor(
            public width: number,
            public height: number,
          ) {
            drawn.push([width, height]);
          }
          getContext() {
            return {
              drawImage() {},
              getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(transparent ? 0 : 255) }),
            };
          }
          async convertToBlob(opts: { type: string }) {
            return new Blob([new Uint8Array([1, 2, 3])], { type: opts.type });
          }
        },
      );
      return drawn;
    }

    const webp = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0))));

    it('converts a WebP with transparency to PNG', async () => {
      stubCanvas(120, 80, true);
      const img = await prepareInsertImage(webp, false);
      expect(img).toMatchObject({ kind: 'png', width: 120, height: 80, orientation: 1 });
    });

    it('converts an opaque WebP to JPEG', async () => {
      stubCanvas(120, 80, false);
      expect((await prepareInsertImage(webp, false)).kind).toBe('jpeg');
    });

    it('reduces images longer than 8000 px to 4096 px and says from what', async () => {
      const drawn = stubCanvas(9000, 3000, false);
      const img = await prepareInsertImage(webp, false);
      expect([img.width, img.height]).toEqual([4096, 1365]);
      expect(img.downscaledFrom).toEqual([9000, 3000]);
      expect(drawn).toEqual([[4096, 1365]]);
    });
  });

  it('refuses unsupported types, and HEIC where the browser cannot decode it', async () => {
    const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]);
    const text = new TextEncoder().encode('not an image at all');
    const heic = new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
    expect(sniffImage(heic)).toBe('heic');
    await expect(prepareInsertImage(gif, true)).rejects.toBeInstanceOf(UnsupportedImageError);
    await expect(prepareInsertImage(text, true)).rejects.toBeInstanceOf(UnsupportedImageError);
    await expect(prepareInsertImage(heic, false)).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

describe('image geometry', () => {
  it('sizes a new image at its natural size, at most 40% of the page each way', () => {
    // 300 × 150 px is 225 × 112.5 pt at 100%: fits on a Letter page as is.
    expect(defaultImageSize([300, 150], [612, 792])).toEqual([225, 112.5]);
    // A big photo: limited by 40% of the width (244.8 pt), proportions kept.
    expect(defaultImageSize([4000, 3000], [612, 792])).toEqual([244.8, 183.6]);
    // A tall strip: limited by 40% of the height.
    expect(defaultImageSize([100, 2000], [612, 792])).toEqual([15.84, 316.8]);
  });

  const f: Frame = { cx: 100, cy: 100, w: 80, h: 40, turn: 0 };

  it('resizes from a corner with the aspect ratio locked: the opposite corner stays', () => {
    // Drag the bottom-right corner (index 2) from (140, 120) to (180, 125).
    const r = resizeFrame(f, 2, [180, 125], { lock: true, fromCenter: false });
    expect([r.w, r.h]).toEqual([120, 60]);
    expect(close(frameCorners(r)[0], frameCorners(f)[0])).toBe(true);
  });

  it('stretches freely with the lock off', () => {
    const r = resizeFrame(f, 2, [180, 125], { lock: false, fromCenter: false });
    expect([r.w, r.h]).toEqual([120, 45]);
    expect(close(frameCorners(r)[0], [60, 80])).toBe(true);
  });

  it('resizes from the center with Alt', () => {
    // Pointer 60 px right and 30 px below the center: twice that, both ways.
    const r = resizeFrame(f, 2, [160, 130], { lock: true, fromCenter: true });
    expect([r.cx, r.cy]).toEqual([100, 100]);
    expect([r.w, r.h]).toEqual([120, 60]);
  });

  it('resizes a turned image along its own sides', () => {
    const turned = { ...f, turn: 90 };
    // Turned a quarter clockwise: its top-left corner is on the right of the view, at (120, 60).
    const tl = frameCorners(turned)[0];
    expect(close(tl, [120, 60])).toBe(true);
    // Its bottom-right corner (80, 140) dragged 20 px further left: 20 px wider, the top-left stays.
    const r = resizeFrame(turned, 2, [80, 160], { lock: false, fromCenter: false });
    expect(r.w).toBeCloseTo(100);
    expect(close(frameCorners(r)[0], tl)).toBe(true);
  });

  it('turns towards the pointer, in 15° steps with Shift', () => {
    // Pointer straight right of the center: a quarter turn.
    expect(turnFrame(f, [200, 100], 0, false).turn).toBeCloseTo(90);
    // 37° snaps to 30° with Shift.
    const p: Point = [100 + 100 * Math.sin((37 * Math.PI) / 180), 100 - 100 * Math.cos((37 * Math.PI) / 180)];
    expect(turnFrame(f, p, 0, false).turn).toBeCloseTo(37);
    expect(turnFrame(f, p, 0, true).turn).toBe(30);
  });

  it('keeps a dragged image on the page', () => {
    expect(clampFrame({ ...f, cx: -50, cy: 900 }, [0, 0, 612, 792])).toMatchObject({ cx: 0, cy: 792 });
  });

  it('maps between a view and PDF space, keeping its turn', () => {
    // A Letter page at scale 2, not rotated: view y runs down, PDF y up.
    const toView = (p: Point): Point => [p[0] * 2, (792 - p[1]) * 2];
    const toPdf = (x: number, y: number): Point => [x / 2, 792 - y / 2];
    const a: ImageAnnotation = { id: 'i', type: 'image', role: 'image', color: [0, 0, 0], opacity: 1, dataUrl: '', rotate: 0, rect: [100, 600, 200, 650] };
    const frame = imageFrame(a, toView, 2, 0);
    expect(frame).toMatchObject({ cx: 300, cy: 334, w: 200, h: 100, turn: 0 });
    const turned = frameToImage(a, { ...frame, turn: 30 }, toPdf, 2, 0);
    expect(turned.rect).toEqual(a.rect);
    expect(turned.angle).toBe(30);
    // The saved bounding box grows to hold the turned picture.
    const b = bounds(turned);
    expect(b[2] - b[0]).toBeCloseTo(100 * Math.cos(Math.PI / 6) + 50 * Math.sin(Math.PI / 6), 1);
  });

  it('turns phone photos upright with the EXIF orientation, then flips', () => {
    // Orientation 6: the stored image's top-left corner (unit square (0, 1)) ends up top-right (1, 1).
    expect(applyMatrix(orientationMatrix(6), [0, 1])).toEqual([1, 1]);
    // Its top-right (1, 1) ends up bottom-right (1, 0).
    expect(applyMatrix(orientationMatrix(6), [1, 1])).toEqual([1, 0]);
    // Orientation 8 is the other way round.
    expect(applyMatrix(orientationMatrix(8), [0, 1])).toEqual([0, 0]);
    expect(applyMatrix(multiply(orientationMatrix(6), orientationMatrix(8)), [0.25, 0.75])).toEqual([0.25, 0.75]);

    const a: ImageAnnotation = { id: 'i', type: 'image', role: 'image', color: [0, 0, 0], opacity: 1, dataUrl: '', rotate: 0, rect: [0, 0, 40, 60] };
    // Flip horizontal: the image's left edge (x = 0) is drawn on the right (x = 40).
    expect(applyMatrix(uprightImageMatrix({ ...a, flipX: true }, 1), [0, 0.5])).toEqual([40, 30]);
    // Flip vertical: its top (y = 1) is drawn at the bottom.
    expect(applyMatrix(uprightImageMatrix({ ...a, flipY: true }, 1), [0.5, 1])).toEqual([20, 0]);
  });
});
