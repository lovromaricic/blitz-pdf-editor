// The hard page boundary: objects added in the editor never leave their page
// (the edge itself is fine). Everything here works on axis-aligned boxes (a
// turned object's smallest upright box, see bounds()) in one coordinate
// space: PDF user space, or screen space for what's measured on screen. The
// PDF's own content is never limited.
import { bounds, remap, translate, type Annotation, type Rect } from './annotations';

/** Is the box on the page (touching an edge counts)? A tiny tolerance absorbs rounding. */
export function inside(box: Rect, page: Rect, eps = 0.01) {
  return box[0] >= page[0] - eps && box[1] >= page[1] - eps && box[2] <= page[2] + eps && box[3] <= page[3] + eps;
}

/**
 * Limit a move (dx, dy) so the box stays on the page. A box larger than the
 * page in one direction stays where it is in that direction. Returns the
 * allowed move and whether it was limited.
 */
export function clampMove(box: Rect, page: Rect, dx: number, dy: number): { dx: number; dy: number; limited: boolean } {
  const fit = (lo: number, hi: number, pLo: number, pHi: number, d: number) => (hi - lo > pHi - pLo ? 0 : Math.min(Math.max(d, pLo - lo), pHi - hi));
  const cx = fit(box[0], box[2], page[0], page[2], dx);
  const cy = fit(box[1], box[3], page[1], page[3], dy);
  return { dx: cx, dy: cy, limited: Math.abs(cx - dx) > 1e-6 || Math.abs(cy - dy) > 1e-6 };
}

/** The move that brings a box (just) inside the page; zero when it's inside already. */
export function intoPage(box: Rect, page: Rect): [number, number] {
  const axis = (lo: number, hi: number, pLo: number, pHi: number) => (lo < pLo ? pLo - lo : hi > pHi ? Math.max(pHi - hi, pLo - lo) : 0);
  return [axis(box[0], box[2], page[0], page[2]), axis(box[1], box[3], page[1], page[3])];
}

/** The box around objects (their actual extent: turned images included). */
export function boxOf(members: readonly Annotation[]): Rect | null {
  if (!members.length) return null;
  const rs = members.map(bounds);
  return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
}

/** Objects moved together, as one block, just inside the page (pasted, duplicated, inserted). */
export function placeInside(members: readonly Annotation[], page: Rect): { members: Annotation[]; moved: boolean } {
  const box = boxOf(members);
  if (!box) return { members: [...members], moved: false };
  const [dx, dy] = intoPage(box, page);
  if (!dx && !dy) return { members: [...members], moved: false };
  return { members: members.map((a) => translate(a, dx, dy)), moved: true };
}

/**
 * After the page changed (a crop): objects (one unit: an object, or a group's
 * objects together) that no longer fit are shrunk to fit if they're larger
 * than the page (keeping their proportions), then moved back inside.
 */
export function fitIntoPage(members: readonly Annotation[], page: Rect): { members: Annotation[]; changed: boolean } {
  const box = boxOf(members);
  if (!box || inside(box, page)) return { members: [...members], changed: false };
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const k = Math.min(1, (page[2] - page[0]) / (w || 1), (page[3] - page[1]) / (h || 1));
  let out = [...members];
  if (k < 1) {
    // Scale around the box's lower-left corner, the same for every object (a group keeps its shape).
    const to = (r: Rect): Rect => [box[0] + (r[0] - box[0]) * k, box[1] + (r[1] - box[1]) * k, box[0] + (r[2] - box[0]) * k, box[1] + (r[3] - box[1]) * k];
    out = out.map((a) => remap(a, box, to(box)));
  }
  return { members: placeInside(out, page).members, changed: true };
}

/**
 * A text box growing as it's typed in (screen space, y down: `box` its new
 * size at its place, `page` the page as shown). If it would cross the bottom
 * edge it moves up, as far as the page top allows. `dy` is that move (≤ 0);
 * `fits` is false when it can't grow that far at all (then the change that
 * made it grow is refused).
 */
export function growInside(box: Rect, page: Rect): { dy: number; fits: boolean } {
  const over = box[3] - page[3];
  if (over <= 0.01) return { dy: 0, fits: true };
  const room = box[1] - page[1];
  return { dy: -Math.min(over, Math.max(0, room)), fits: over <= room + 0.01 };
}

/** The narrowest a text box may be, in points. */
export const MIN_TEXT_WIDTH = 60;

/**
 * Where a new text box goes when clicked near the right edge (display units
 * along the line): its width is the default reduced to the room left, but at
 * least MIN_TEXT_WIDTH, moving it left when even that doesn't fit.
 */
export function newTextBoxSpan(x: number, defaultWidth: number, pageLeft: number, pageRight: number): { x: number; width: number } {
  const room = pageRight - x;
  if (room >= defaultWidth) return { x, width: defaultWidth };
  if (room >= MIN_TEXT_WIDTH) return { x, width: room };
  const width = Math.min(MIN_TEXT_WIDTH, pageRight - pageLeft);
  return { x: Math.max(pageLeft, pageRight - width), width };
}

// --- The limit: the page, or the margin ("Keep objects inside margins") -----------------------

export type LimitKind = 'page' | 'margin';

/** The page shrunk by a margin on every side (the same on every side, so the page's rotation doesn't matter). */
export function insetRect(r: Rect, m: number): Rect {
  return [r[0] + m, r[1] + m, r[2] - m, r[3] - m];
}

/**
 * Where an object may go. The page, or with the margin as the limit, the
 * margin rectangle, except that an edge of the object that is already past
 * the margin is limited at where it is (so it can only move inward: nothing
 * is moved just because the option was turned on). Always within the page.
 */
export function limitRect(page: Rect, margin: number | null, box?: Rect | null): { rect: Rect; kind: LimitKind } {
  if (margin === null) return { rect: page, kind: 'page' };
  const m = insetRect(page, margin);
  const r: Rect = box ? [Math.min(m[0], box[0]), Math.min(m[1], box[1]), Math.max(m[2], box[2]), Math.max(m[3], box[3])] : m;
  return { rect: [Math.max(r[0], page[0]), Math.max(r[1], page[1]), Math.min(r[2], page[2]), Math.min(r[3], page[3])], kind: 'margin' };
}
