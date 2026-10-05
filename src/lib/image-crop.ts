// Cropping inserted images, without losing anything until the PDF is saved.
//
// An image object keeps its whole original (in the image store) and a crop:
// the part of the original it shows, as [x0, y0, x1, y1] from 0 to 1 of the
// original as shown (EXIF orientation applied). The object's rect is the
// cropped part; its turn, flips and opacity apply after the crop.
//
// Crop mode works in the object's own frame (its center at 0,0, x right and y
// down as seen upright, before its turn), in view units: `image` is where the
// whole original lies, `frame` the crop window. Flips only matter when
// converting between that view and the original's coordinates.
import { contentTurn, round, uprightSize, type ImageAnnotation, type Rect } from './annotations';

/** [x0, y0, x1, y1] of the original, 0..1. */
export type Crop = [number, number, number, number];
/** [left, top, width, height] in the object's frame. */
export type Box = [number, number, number, number];

export const FULL: Crop = [0, 0, 1, 1];
/** The smallest crop, in pixels of the original. */
export const MIN_CROP_PX = 16;

export function cropOf(a: Pick<ImageAnnotation, 'crop'>): Crop {
  return a.crop ?? FULL;
}

/** A crop of (very nearly) the whole image is no crop. */
export function isFull(c: Crop) {
  const e = 1e-6;
  return c[0] <= e && c[1] <= e && c[2] >= 1 - e && c[3] >= 1 - e;
}

/**
 * The crop clamped into the image, ordered, on whole pixels of the original
 * (what's shown is exactly what the saved file keeps) and at least the
 * minimum size.
 */
export function normalizeCrop(c: Crop, px: [number, number]): Crop {
  const axis = (a: number, b: number, n: number): [number, number] => {
    const min = Math.min(n, MIN_CROP_PX);
    let lo = Math.round(Math.max(0, Math.min(a, b)) * n);
    let hi = Math.round(Math.min(1, Math.max(a, b)) * n);
    lo = Math.min(lo, n - min);
    hi = Math.max(hi, lo + min);
    return [lo / n, hi / n];
  };
  const [x0, x1] = axis(c[0], c[2], px[0]);
  const [y0, y1] = axis(c[1], c[3], px[1]);
  return [x0, y0, x1, y1];
}

/** The crop's size in pixels of the original. */
export function cropPixels(c: Crop, px: [number, number]): [number, number] {
  return [Math.round((c[2] - c[0]) * px[0]), Math.round((c[3] - c[1]) * px[1])];
}

// --- Crop mode ------------------------------------------------------------------------------

export interface CropView {
  /** The whole original, in the object's frame (view units). */
  image: Box;
  /** The crop window. */
  frame: Box;
}

/**
 * Crop mode for an object whose frame is `w` × `h` (view units): the object's
 * current crop fills the frame, the rest of the original lies around it, at
 * the same scale (nothing appears to zoom).
 */
export function enterCrop(c: Crop, w: number, h: number, flipX = false, flipY = false): CropView {
  const iw = w / (c[2] - c[0]);
  const ih = h / (c[3] - c[1]);
  // Where the crop starts in the original, as seen (a flip mirrors it).
  const ux = flipX ? 1 - c[2] : c[0];
  const uy = flipY ? 1 - c[3] : c[1];
  return { image: [-w / 2 - ux * iw, -h / 2 - uy * ih, iw, ih], frame: [-w / 2, -h / 2, w, h] };
}

/** The crop that the view shows (in the original's coordinates). */
export function viewToCrop(v: CropView, flipX = false, flipY = false): Crop {
  const [ix, iy, iw, ih] = v.image;
  const [fx, fy, fw, fh] = v.frame;
  let x0 = (fx - ix) / iw;
  let x1 = (fx + fw - ix) / iw;
  let y0 = (fy - iy) / ih;
  let y1 = (fy + fh - iy) / ih;
  if (flipX) [x0, x1] = [1 - x1, 1 - x0];
  if (flipY) [y0, y1] = [1 - y1, 1 - y0];
  return [x0, y0, x1, y1].map((v) => Math.min(1, Math.max(0, v))) as Crop;
}

/** The smallest frame side, in view units (MIN_CROP_PX of the original). */
function minSide(v: CropView, px: [number, number]): [number, number] {
  return [Math.min(v.image[2], (MIN_CROP_PX * v.image[2]) / px[0]), Math.min(v.image[3], (MIN_CROP_PX * v.image[3]) / px[1])];
}

/** Which edges a handle moves: -1 the left/top edge, 1 the right/bottom edge, 0 neither. */
export type Handle = [-1 | 0 | 1, -1 | 0 | 1];
export const HANDLES: readonly Handle[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

/**
 * Drag a handle by (dx, dy): its edges follow, within the image and no smaller
 * than the minimum; with a ratio (width / height) the frame keeps it, growing
 * or shrinking from the opposite corner or edge.
 */
export function dragHandle(v: CropView, h: Handle, dx: number, dy: number, px: [number, number], ratio: number | null = null): CropView {
  const [ix, iy, iw, ih] = v.image;
  const [mw, mh] = minSide(v, px);
  let [l, t, r, b] = [v.frame[0], v.frame[1], v.frame[0] + v.frame[2], v.frame[1] + v.frame[3]];
  if (h[0] < 0) l = Math.min(Math.max(ix, l + dx), r - mw);
  if (h[0] > 0) r = Math.max(Math.min(ix + iw, r + dx), l + mw);
  if (h[1] < 0) t = Math.min(Math.max(iy, t + dy), b - mh);
  if (h[1] > 0) b = Math.max(Math.min(iy + ih, b + dy), t + mh);
  let frame: Box = [l, t, r - l, b - t];
  if (ratio) frame = keepRatio(frame, h, ratio, v.image);
  return { image: v.image, frame };
}

/** A frame brought to a ratio, anchored at the side or corner opposite the handle, inside the image. */
function keepRatio(f: Box, h: Handle, ratio: number, img: Box): Box {
  let [x, y, w, hh] = f;
  // Follow the dimension being dragged; a corner follows the larger change.
  if (h[0] !== 0 && (h[1] === 0 || w / hh > ratio)) hh = w / ratio;
  else w = hh * ratio;
  // Not bigger than the image allows from the anchor.
  const ax = h[0] < 0 ? x + f[2] : h[0] > 0 ? x : x + f[2] / 2;
  const ay = h[1] < 0 ? y + f[3] : h[1] > 0 ? y : y + f[3] / 2;
  const roomW = h[0] < 0 ? ax - img[0] : h[0] > 0 ? img[0] + img[2] - ax : 2 * Math.min(ax - img[0], img[0] + img[2] - ax);
  const roomH = h[1] < 0 ? ay - img[1] : h[1] > 0 ? img[1] + img[3] - ay : 2 * Math.min(ay - img[1], img[1] + img[3] - ay);
  const k = Math.min(1, roomW / w, roomH / hh);
  w *= k;
  hh *= k;
  x = h[0] < 0 ? ax - w : h[0] > 0 ? ax : ax - w / 2;
  y = h[1] < 0 ? ay - hh : h[1] > 0 ? ay : ay - hh / 2;
  return [x, y, w, hh];
}

/** Move the image under the (still) frame, keeping the frame inside the image. */
export function moveImage(v: CropView, dx: number, dy: number): CropView {
  const [ix, iy, iw, ih] = v.image;
  const [fx, fy, fw, fh] = v.frame;
  const nx = Math.min(fx, Math.max(fx + fw - iw, ix + dx));
  const ny = Math.min(fy, Math.max(fy + fh - ih, iy + dy));
  return { image: [nx, ny, iw, ih], frame: v.frame };
}

/**
 * A ratio (width / height) for the frame: the largest frame of that ratio
 * inside the current one, centered on it (and inside the image). Null: free.
 */
export function applyRatio(v: CropView, ratio: number | null): CropView {
  if (!ratio) return v;
  const [fx, fy, fw, fh] = v.frame;
  let w = fw;
  let h = fw / ratio;
  if (h > fh) {
    h = fh;
    w = fh * ratio;
  }
  return { image: v.image, frame: [fx + (fw - w) / 2, fy + (fh - h) / 2, w, h] };
}

/** The ratio presets (width / height of the result, landscape); "original" is the image's own. */
export const RATIOS = [
  { id: 'free', label: 'Free', value: null },
  { id: 'original', label: 'Original', value: 'original' },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
] as const;
export type RatioId = (typeof RATIOS)[number]['id'];

/** The ratio a preset means for this image, turned to portrait when asked (1:1 stays). */
export function ratioValue(id: RatioId, px: [number, number], portrait: boolean): number | null {
  const preset = RATIOS.find((r) => r.id === id)!;
  if (preset.value === null) return null;
  const r = preset.value === 'original' ? px[0] / px[1] : preset.value;
  return portrait === r > 1 ? 1 / r : r;
}

/** Is the frame taller than wide (for the Portrait / Landscape toggle's starting state)? */
export function isPortrait(v: CropView) {
  return v.frame[3] > v.frame[2];
}

/** Keyboard: arrows move the image (dx, dy); Alt+arrows resize from the bottom-right. */
export function resizeFromCorner(v: CropView, dx: number, dy: number, px: [number, number], ratio: number | null): CropView {
  return dragHandle(v, [1, 1], dx, dy, px, ratio);
}

// --- Applying ----------------------------------------------------------------------------------

/** Crop mode for an image object, in points (its upright size as shown). */
export function enterCropFor(a: ImageAnnotation): CropView {
  const [w, h] = uprightSize(a);
  return enterCrop(cropOf(a), w, h, a.flipX, a.flipY);
}

/**
 * The image after crop mode (view in points, see enterCropFor): the object
 * becomes the frame, where it was shown, at the same scale (nothing zooms); its
 * turn and flips stay. A crop of the whole image is no crop.
 */
export function applyCropView(a: ImageAnnotation, v: CropView, px: [number, number]): ImageAnnotation {
  const crop = normalizeCrop(viewToCrop(v, a.flipX, a.flipY), px);
  // The frame of that crop (on whole pixels), as seen.
  const [ix, iy, iw, ih] = v.image;
  const fx = ix + (a.flipX ? 1 - crop[2] : crop[0]) * iw;
  const fy = iy + (a.flipY ? 1 - crop[3] : crop[1]) * ih;
  const fw = (crop[2] - crop[0]) * iw;
  const fh = (crop[3] - crop[1]) * ih;
  // The frame's center (upright, y down) turned into page space (y up).
  const x = fx + fw / 2;
  const yd = fy + fh / 2;
  const t = (contentTurn(a) * Math.PI) / 180;
  const cx = (a.rect[0] + a.rect[2]) / 2 + x * Math.cos(t) + yd * Math.sin(t);
  const cy = (a.rect[1] + a.rect[3]) / 2 + x * Math.sin(t) - yd * Math.cos(t);
  const [rw, rh] = a.rotate % 180 === 0 ? [fw, fh] : [fh, fw];
  const rect: Rect = [round(cx - rw / 2), round(cy - rh / 2), round(cx + rw / 2), round(cy + rh / 2)];
  const next: ImageAnnotation = { ...a, rect };
  if (isFull(crop)) delete next.crop;
  else next.crop = crop;
  return next;
}

/** Is the view's crop the same as the object's (nothing to apply)? */
export function sameCrop(a: Pick<ImageAnnotation, 'crop'>, b: Pick<ImageAnnotation, 'crop'>, eps = 1e-6) {
  const x = cropOf(a);
  const y = cropOf(b);
  return x.every((v, i) => Math.abs(v - y[i]) < eps);
}

/**
 * Portrait ⇄ landscape: the frame's sides swapped about its center, made
 * smaller if the image doesn't have the room, and kept inside the image.
 */
export function swapFrame(v: CropView): CropView {
  const [ix, iy, iw, ih] = v.image;
  const [fx, fy, fw, fh] = v.frame;
  const k = Math.min(1, iw / fh, ih / fw);
  const w = fh * k;
  const h = fw * k;
  const cx = Math.min(ix + iw - w / 2, Math.max(ix + w / 2, fx + fw / 2));
  const cy = Math.min(iy + ih - h / 2, Math.max(iy + h / 2, fy + fh / 2));
  return { image: v.image, frame: [cx - w / 2, cy - h / 2, w, h] };
}

/** Crop mode for one inserted image (in the editor only; nothing is in the document until applied). */
export interface CropSession {
  pageId: string;
  id: string;
  /** The object when crop mode started (or was last reset): what the view is relative to. */
  base: ImageAnnotation;
  /** In points, see enterCropFor. */
  view: CropView;
  /** Pixel size of the original as shown. */
  px: [number, number];
  ratio: RatioId;
  portrait: boolean;
}
