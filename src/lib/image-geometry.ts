// Geometry of inserted images: where one sits in a view (a "frame"), moving,
// resizing and turning it, its default size, and the PDF matrix that draws it.
// Pure: used by the page overlay (screen px), the Image panel (page points),
// the PDF writer and tests.
import { contentTurn, round, uprightSize, type ImageAnnotation, type Point, type Rect } from './annotations';
import { boxedGeometry } from './annotation-view';

/** An image in a view: center, upright size and clockwise turn (degrees), in view units. */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  turn: number;
}

/** Smallest size an image can be dragged down to, in view units. */
export const MIN_IMAGE_SIZE = 8;

/** Default insert size: at most this share of the page's width and height. */
export const MAX_PAGE_SHARE = 0.4;

/** CSS px per PDF point at 100% zoom: an image's natural size is one CSS px per pixel. */
const PX_PER_PT = 96 / 72;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Degrees in (-180, 180]. */
export function normalizeAngle(deg: number) {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : Math.round(d * 100) / 100 || 0;
}

export function imageFrame(a: ImageAnnotation, toView: (p: Point) => Point, scale: number, pageRotation: number): Frame {
  const g = boxedGeometry(a, toView, scale, pageRotation);
  return { cx: g.cx, cy: g.cy, w: g.w, h: g.h, turn: g.turn };
}

/** The image placed at `f` (view units, `scale` units per point), keeping what the frame doesn't describe. */
export function frameToImage(
  a: ImageAnnotation,
  f: Frame,
  toPdf: (x: number, y: number) => Point,
  scale: number,
  pageRotation: number,
): ImageAnnotation {
  const [cx, cy] = toPdf(f.cx, f.cy);
  const w = f.w / scale;
  const h = f.h / scale;
  const [rw, rh] = a.rotate % 180 === 0 ? [w, h] : [h, w];
  const rect: Rect = [round(cx - rw / 2), round(cy - rh / 2), round(cx + rw / 2), round(cy + rh / 2)];
  const angle = normalizeAngle(f.turn - (pageRotation - a.rotate));
  return { ...a, rect, angle };
}

/** Unit vectors of the frame's own x (right) and y (down) axes, in the view. */
function axes(turn: number): [Point, Point] {
  const t = rad(turn);
  return [
    [Math.cos(t), Math.sin(t)],
    [-Math.sin(t), Math.cos(t)],
  ];
}

/** A point given in the frame's own axes (from its center), in the view. */
function fromLocal(f: Frame, x: number, y: number): Point {
  const [ux, uy] = axes(f.turn);
  return [f.cx + x * ux[0] + y * uy[0], f.cy + x * ux[1] + y * uy[1]];
}

/** A view point in the frame's own axes, relative to `origin`. */
function toLocal(turn: number, origin: Point, p: Point): Point {
  const [ux, uy] = axes(turn);
  const dx = p[0] - origin[0];
  const dy = p[1] - origin[1];
  return [dx * ux[0] + dy * ux[1], dx * uy[0] + dy * uy[1]];
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left (as seen upright). */
export const CORNER_SIGNS: readonly Point[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export function frameCorners(f: Frame, pad = 0): Point[] {
  return CORNER_SIGNS.map(([sx, sy]) => fromLocal(f, sx * (f.w / 2 + pad), sy * (f.h / 2 + pad)));
}

/** Where the turn handle sits: above the middle of the top edge. */
export function turnHandle(f: Frame, distance: number): Point {
  return fromLocal(f, 0, -f.h / 2 - distance);
}

/**
 * Drag corner `corner` (index into CORNER_SIGNS) to view point `p`. The opposite
 * corner stays put, or the center with `fromCenter` (Alt). With `lock` the
 * proportions are kept.
 */
export function resizeFrame(f: Frame, corner: number, p: Point, { lock, fromCenter }: { lock: boolean; fromCenter: boolean }): Frame {
  const [sx, sy] = CORNER_SIGNS[corner];
  if (fromCenter) {
    const d = toLocal(f.turn, [f.cx, f.cy], p);
    let w = Math.max(MIN_IMAGE_SIZE, 2 * d[0] * sx);
    let h = Math.max(MIN_IMAGE_SIZE, 2 * d[1] * sy);
    if (lock) [w, h] = keepProportions(f, w, h);
    return { ...f, w, h };
  }
  const fixed = fromLocal(f, -sx * (f.w / 2), -sy * (f.h / 2));
  const d = toLocal(f.turn, fixed, p);
  let w = Math.max(MIN_IMAGE_SIZE, d[0] * sx);
  let h = Math.max(MIN_IMAGE_SIZE, d[1] * sy);
  if (lock) [w, h] = keepProportions(f, w, h);
  // The new center is half the new size away from the fixed corner, along the frame's axes.
  const [ux, uy] = axes(f.turn);
  const hx = (sx * w) / 2;
  const hy = (sy * h) / 2;
  return { ...f, w, h, cx: fixed[0] + hx * ux[0] + hy * uy[0], cy: fixed[1] + hx * ux[1] + hy * uy[1] };
}

/** The larger of the two stretches, applied to both sides. */
function keepProportions(f: Frame, w: number, h: number): [number, number] {
  const k = Math.max(w / f.w, h / f.h, MIN_IMAGE_SIZE / Math.min(f.w, f.h));
  return [f.w * k, f.h * k];
}

/** Turn the frame so its top faces view point `p`; `snap` (Shift) rounds to 15° steps of the image's own angle. */
export function turnFrame(f: Frame, p: Point, baseTurn: number, snap: boolean): Frame {
  const toward = (Math.atan2(p[1] - f.cy, p[0] - f.cx) * 180) / Math.PI + 90;
  let angle = normalizeAngle(toward - baseTurn);
  if (snap) angle = normalizeAngle(Math.round(angle / 15) * 15);
  return { ...f, turn: baseTurn + angle };
}

/** Keep the center inside `area` [x1, y1, x2, y2], so the image never leaves the page entirely. */
export function clampFrame(f: Frame, area: Rect): Frame {
  return { ...f, cx: Math.min(area[2], Math.max(area[0], f.cx)), cy: Math.min(area[3], Math.max(area[1], f.cy)) };
}

/**
 * Size (points, as shown) for a newly inserted image of `px` pixels on a page
 * shown `page` points large: its natural size at 100% zoom, shrunk to fit
 * within 40% of the page's width and height. Proportions are kept.
 */
export function defaultImageSize(px: readonly [number, number], page: readonly [number, number]): [number, number] {
  const w = px[0] / PX_PER_PT;
  const h = px[1] / PX_PER_PT;
  const k = Math.min(1, (MAX_PAGE_SHARE * page[0]) / w, (MAX_PAGE_SHARE * page[1]) / h);
  return [round(w * k), round(h * k)];
}

// --- PDF ------------------------------------------------------------------

/** A PDF matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

/** First `m`, then `n` (PDF row-vector order: m × n). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function applyMatrix(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Turns the raw image (as stored, painted into the unit square) upright, per
 * its EXIF orientation. JPEGs are embedded untouched, so the PDF must do what
 * a browser does on screen.
 */
export function orientationMatrix(orientation: number): Matrix {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, 1, 0];
    case 3:
      return [-1, 0, 0, -1, 1, 1];
    case 4:
      return [1, 0, 0, -1, 0, 1];
    case 5:
      return [0, -1, -1, 0, 1, 1];
    case 6:
      return [0, -1, 1, 0, 0, 1];
    case 7:
      return [0, 1, 1, 0, 0, 0];
    case 8:
      return [0, 1, -1, 0, 1, 0];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * Maps the unit square of the stored image to the upright box [0 0 w h]:
 * EXIF orientation, then the user's flips, then the size.
 */
export function uprightImageMatrix(a: ImageAnnotation, orientation: number): Matrix {
  const [w, h] = uprightSize(a);
  let m = orientationMatrix(orientation);
  if (a.flipX) m = multiply(m, [-1, 0, 0, 1, 1, 0]);
  if (a.flipY) m = multiply(m, [1, 0, 0, -1, 0, 1]);
  return multiply(m, [w, 0, 0, h, 0, 0]);
}

/** Turns the upright box [0 0 w h] about its center and centers it on the annotation's rect (page space). */
export function placementMatrix(a: ImageAnnotation): Matrix {
  const [w, h] = uprightSize(a);
  const t = rad(contentTurn(a));
  const cx = (a.rect[0] + a.rect[2]) / 2;
  const cy = (a.rect[1] + a.rect[3]) / 2;
  const toCenter: Matrix = [1, 0, 0, 1, -w / 2, -h / 2];
  const turn: Matrix = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
  return multiply(multiply(toCenter, turn), [1, 0, 0, 1, cx, cy]);
}

/** Turn only (for an annotation appearance: viewers move the turned box onto Rect). */
export function turnMatrix(a: ImageAnnotation): Matrix {
  const t = rad(contentTurn(a));
  return [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];
}

/** Do two rectangles overlap (more than touching)? */
export function rectsOverlap(a: Rect, b: Rect) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}
