// Markup annotations: data model and geometry. Coordinates are PDF user space
// of the page (points, origin bottom-left, before any rotation or crop), so
// annotations stay put when pages are rotated, cropped, reordered or merged.
// No DOM here: used by the UI, printing and the PDF writer in a worker.

export type Point = [number, number];
/** [x1, y1, x2, y2] with x1 < x2, y1 < y2. */
export type Rect = [number, number, number, number];
/** RGB, 0..1 per channel. */
export type Rgb = [number, number, number];

interface Base {
  id: string;
  color: Rgb;
  /** 0..1 */
  opacity: number;
  /**
   * The groups this object is in, outermost first (editor only: never saved
   * into the PDF). A group's objects are always next to each other in the
   * page's list, so it sits in the layer order as one block.
   */
  groups?: string[];
}

export interface HighlightAnnotation extends Base {
  type: 'highlight';
  /** One rectangle per line of highlighted text. */
  rects: Rect[];
}

export interface InkAnnotation extends Base {
  type: 'ink';
  paths: Point[][];
  /** Stroke width in points. */
  width: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

export interface ShapeAnnotation extends Base {
  type: 'shape';
  shape: ShapeKind;
  /** rect/ellipse: two opposite corners. line/arrow: start and end. */
  from: Point;
  to: Point;
  width: number;
  /** Fill for rect/ellipse, or null for none. */
  fill: Rgb | null;
}

/** A font id from font-catalog.ts, or one of the built-in 'sans' | 'serif' | 'mono'. */
export type FontFamily = string;

/**
 * Annotations with upright content in a box (text, stamps, comments, images).
 * `rotate` is the page's total rotation when the annotation was made: the
 * content was drawn upright for that view, and turns with the page afterwards.
 */
interface Boxed extends Base {
  rect: Rect;
  rotate: number;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** Where a link goes: a web or email address, or a page of this document (by page id, so it follows the page). */
export type TextLink = { kind: 'url'; href: string } | { kind: 'page'; pageId: string };

/** A stretch of text with one formatting. */
export interface TextRun {
  text: string;
  font: FontFamily;
  /** Points. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color: Rgb;
  link?: TextLink;
}

/** A paragraph: runs in order. An empty paragraph keeps one empty run (its size sets the line height). */
/** A list paragraph's marker: a bullet or a number. */
export type ListKind = 'bullet' | 'number';
/** List indent levels: 0, 1 and 2. */
export const MAX_LIST_LEVEL = 2;

export interface TextParagraph {
  runs: TextRun[];
  /** A list item (no value: a plain paragraph). */
  list?: ListKind;
  /** The list item's indent level, 0 to MAX_LIST_LEVEL (no value: 0). */
  level?: number;
}

export interface TextAnnotation extends Boxed {
  type: 'text';
  /**
   * Rich text: paragraphs of formatted runs. When present, it is the content
   * and the line breaks are computed (text-rich-layout.ts). Text boxes from
   * before rich text don't have it: they use the fields below and their stored
   * `lines`, so they look exactly as they did until they are edited.
   */
  paragraphs?: TextParagraph[];
  /** The plain text (paragraphs joined by line breaks), for search, labels and older code. */
  text: string;
  /**
   * Boxes from before rich text: the line breaks as they were laid out, which
   * screen, print and PDF keep using. Not used by rich boxes (computed).
   */
  lines?: string[];
  /**
   * Per line: does it end a paragraph (a manual line break or the end of the
   * text)? Justified text leaves those lines unstretched. Missing on text from
   * before alignment existed (it is never justified).
   */
  ends?: boolean[];
  /** The box's base style: the whole text's style before rich text; for rich text, the style of new text. */
  font: FontFamily;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Default left. */
  align?: TextAlign;
  /** Line height as a multiple of the size. Default 1.25 (what text boxes always had). */
  lineSpacing?: number;
  /** Fill behind the whole box (padding included), or none. */
  background?: Rgb | null;
  /** Points. */
  size: number;
  /** Made from the PDF's own text (Edit content): it keeps its place, so the margins don't limit its typing. */
  fromPdf?: boolean;
}

export interface StampAnnotation extends Boxed {
  type: 'stamp';
  label: string;
}

/** A sticky-note comment, shown as an icon. */
export interface NoteAnnotation extends Boxed {
  type: 'note';
  text: string;
}

export interface ImageAnnotation extends Boxed {
  type: 'image';
  /** What the editor shows: a PNG data URL (signatures) or an object URL from the image store (inserted images). */
  dataUrl: string;
  role: 'signature' | 'image';
  /** Inserted images: the image store key of the original bytes (embedded once per saved file). */
  imageKey?: string;
  /** Extra clockwise turn in degrees, as seen on screen, on top of `rotate`. */
  angle?: number;
  /** Mirrored left-right / top-bottom (as seen upright). */
  flipX?: boolean;
  flipY?: boolean;
  /**
   * Inserted images: the part of the original shown, [x0, y0, x1, y1] from 0
   * to 1 of the original as shown (none: all of it). The rect is that part;
   * turn and flips apply after. Cut for real when the PDF is saved.
   */
  crop?: [number, number, number, number];
}

export type BoxedAnnotation = TextAnnotation | StampAnnotation | NoteAnnotation | ImageAnnotation;

export type Annotation = HighlightAnnotation | InkAnnotation | ShapeAnnotation | BoxedAnnotation;

export function isBoxed(a: Annotation): a is BoxedAnnotation {
  return a.type === 'text' || a.type === 'stamp' || a.type === 'note' || a.type === 'image';
}

/** Outline of the comment icon (content, matches the saved PDF appearance). */
export const NOTE_OUTLINE: Rgb = [0.25, 0.25, 0.25];

/** Size of a note icon, in points. */
export const NOTE_SIZE = 22;

/** Width and height of a boxed annotation's content, upright. */
export function uprightSize(a: { rect: Rect; rotate: number }): [number, number] {
  const w = a.rect[2] - a.rect[0];
  const h = a.rect[3] - a.rect[1];
  return a.rotate % 180 === 0 ? [w, h] : [h, w];
}

/**
 * PDF-space rectangle for upright content of size w x h whose upright top-left
 * corner is at `topLeft`, on a page shown with total rotation `rotate`
 * (clockwise, like /Rotate).
 */
export function rectFromUpright(topLeft: Point, w: number, h: number, rotate: number): Rect {
  const [x, y] = topLeft;
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return [x, y, x + h, y + w];
    case 180:
      return [x - w, y, x, y + h];
    case 270:
      return [x - h, y - w, x, y];
    default:
      return [x, y - h, x + w, y];
  }
}

/** The PDF-space point that is the upright top-left corner of a boxed annotation. */
export function uprightTopLeft(a: { rect: Rect; rotate: number }): Point {
  const [x1, y1, x2, y2] = a.rect;
  switch (((a.rotate % 360) + 360) % 360) {
    case 90:
      return [x1, y1];
    case 180:
      return [x2, y1];
    case 270:
      return [x2, y2];
    default:
      return [x1, y2];
  }
}

let counter = 0;
export function newAnnotationId() {
  return `annot-${Date.now().toString(36)}-${++counter}`;
}

// --- Colours (placeholders until the visual design is decided) -----------

export const NOTE_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'Yellow', rgb: [1, 0.85, 0.2] },
  { name: 'Green', rgb: [0.55, 0.85, 0.35] },
  { name: 'Blue', rgb: [0.4, 0.75, 1] },
  { name: 'Pink', rgb: [1, 0.55, 0.75] },
];

export const HIGHLIGHT_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'Yellow', rgb: hex('#FFD60A') },
  { name: 'Green', rgb: hex('#7BDB8F') },
  { name: 'Blue', rgb: hex('#79B8FF') },
  { name: 'Pink', rgb: hex('#FF9ECF') },
];

/** Content colours are written as hex for readability, stored as 0..1 RGB. */
function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000) as Rgb;
}

/**
 * New links are this blue and underlined (content colour, saved in the PDF; the
 * same value as the --link token the app's own links use). They can be recoloured.
 */
export const LINK_COLOR: Rgb = hex('#1155CC');

/** Text box backgrounds: white and light tints (content colours, saved in the PDF). */
export const BACKGROUND_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'White', rgb: [1, 1, 1] },
  { name: 'Light yellow', rgb: hex('#FFF3B0') },
  { name: 'Light blue', rgb: hex('#D6E6FF') },
  { name: 'Light green', rgb: hex('#D5F2DD') },
];

export const STAMP_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'Green', rgb: [0.08, 0.45, 0.16] },
  { name: 'Blue', rgb: [0.1, 0.35, 0.8] },
  { name: 'Red', rgb: [0.8, 0.1, 0.1] },
  { name: 'Gray', rgb: [0.35, 0.35, 0.35] },
];

export const INK_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'Black', rgb: [0, 0, 0] },
  { name: 'Red', rgb: [0.85, 0.15, 0.15] },
  { name: 'Blue', rgb: [0.1, 0.35, 0.85] },
  { name: 'Green', rgb: [0.1, 0.6, 0.25] },
  { name: 'Yellow', rgb: [1, 0.85, 0] },
];

export function rgbToCss([r, g, b]: Rgb) {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

export function sameRgb(a: Rgb | null, b: Rgb | null) {
  if (!a || !b) return a === b;
  return a.every((v, i) => Math.abs(v - b[i]) < 0.002);
}

// --- Geometry --------------------------------------------------------------

export function normRect(a: Point, b: Point): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Bounding box of the annotation's visible area, including stroke. */
export function bounds(a: Annotation): Rect {
  switch (a.type) {
    case 'highlight':
      return unionRects(a.rects);
    case 'ink': {
      const r = unionRects(a.paths.flat().map((p) => [p[0], p[1], p[0], p[1]] as Rect));
      return pad(r, a.width / 2);
    }
    case 'shape': {
      const r = normRect(a.from, a.to);
      // Arrowheads stick out beyond the line's end.
      const extra = a.shape === 'arrow' ? arrowSize(a.width) : 0;
      return pad(r, a.width / 2 + extra);
    }
    case 'image':
      return a.angle ? turnedBounds(a) : a.rect;
    default:
      return a.rect;
  }
}

/**
 * Counter-clockwise turn (degrees, PDF space) of a boxed annotation's upright
 * content: the page rotation it was made for, less its own clockwise turn.
 */
export function contentTurn(a: { rotate: number; angle?: number }) {
  return a.rotate - (a.angle ?? 0);
}

/** Box around a turned image: its upright box turned about the center of `rect`. */
function turnedBounds(a: ImageAnnotation): Rect {
  const [w, h] = uprightSize(a);
  const cx = (a.rect[0] + a.rect[2]) / 2;
  const cy = (a.rect[1] + a.rect[3]) / 2;
  const t = (contentTurn(a) * Math.PI) / 180;
  const ex = (Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * h) / 2;
  const ey = (Math.abs(Math.sin(t)) * w + Math.abs(Math.cos(t)) * h) / 2;
  return [round(cx - ex), round(cy - ey), round(cx + ex), round(cy + ey)];
}

export function unionRects(rects: Rect[]): Rect {
  if (rects.length === 0) return [0, 0, 0, 0];
  return [
    Math.min(...rects.map((r) => r[0])),
    Math.min(...rects.map((r) => r[1])),
    Math.max(...rects.map((r) => r[2])),
    Math.max(...rects.map((r) => r[3])),
  ];
}

function pad(r: Rect, d: number): Rect {
  return [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
}

export function arrowSize(width: number) {
  return Math.max(6, width * 4);
}

/** The two arrowhead wing points for a line from `from` to `to` (any coordinate space). */
export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  return [
    [to[0] - size * Math.cos(angle - spread), to[1] - size * Math.sin(angle - spread)],
    [to[0] - size * Math.cos(angle + spread), to[1] - size * Math.sin(angle + spread)],
  ];
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  const mv = (p: Point): Point => [round(p[0] + dx), round(p[1] + dy)];
  switch (a.type) {
    case 'highlight':
      return { ...a, rects: a.rects.map((r) => [round(r[0] + dx), round(r[1] + dy), round(r[2] + dx), round(r[3] + dy)]) };
    case 'ink':
      return { ...a, paths: a.paths.map((path) => path.map(mv)) };
    case 'shape':
      return { ...a, from: mv(a.from), to: mv(a.to) };
    default:
      return { ...a, rect: [round(a.rect[0] + dx), round(a.rect[1] + dy), round(a.rect[2] + dx), round(a.rect[3] + dy)] };
  }
}

/** Map the annotation's geometry from rectangle `src` onto rectangle `dst` (for resizing). */
export function remap(a: Annotation, src: Rect, dst: Rect): Annotation {
  const sx = (dst[2] - dst[0]) / (src[2] - src[0] || 1);
  const sy = (dst[3] - dst[1]) / (src[3] - src[1] || 1);
  const map = (p: Point): Point => [round(dst[0] + (p[0] - src[0]) * sx), round(dst[1] + (p[1] - src[1]) * sy)];
  switch (a.type) {
    case 'highlight':
      return { ...a, rects: a.rects.map((r) => normRect(map([r[0], r[1]]), map([r[2], r[3]]))) };
    case 'ink':
      return { ...a, paths: a.paths.map((path) => path.map(map)) };
    case 'shape':
      return { ...a, from: map(a.from), to: map(a.to) };
    default:
      return { ...a, rect: normRect(map([a.rect[0], a.rect[1]]), map([a.rect[2], a.rect[3]])) };
  }
}

export function round(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Merge selection rectangles into one rectangle per text line. Rectangles
 * whose vertical ranges overlap by more than half are on the same line.
 */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = rects.filter((r) => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5).sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  const lines: Rect[] = [];
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l[3], r[3]) - Math.max(l[1], r[1]);
      return overlap > 0.5 * Math.min(l[3] - l[1], r[3] - r[1]);
    });
    if (line) {
      line[0] = Math.min(line[0], r[0]);
      line[1] = Math.min(line[1], r[1]);
      line[2] = Math.max(line[2], r[2]);
      line[3] = Math.max(line[3], r[3]);
    } else {
      lines.push([...r]);
    }
  }
  return lines.map((l) => l.map(round) as Rect);
}

/** Drop points closer than `minDist` to the previous kept point (keeps the last point). */
export function simplifyPath(points: Point[], minDist: number): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function describe(a: Annotation): string {
  switch (a.type) {
    case 'highlight':
      return 'Highlight';
    case 'ink':
      return 'Drawing';
    case 'shape':
      return { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' }[a.shape];
    case 'text':
      return 'Text';
    case 'stamp':
      return 'Stamp';
    case 'note':
      return 'Comment';
    case 'image':
      return a.role === 'signature' ? 'Signature' : 'Image';
  }
}

// --- Stamps ------------------------------------------------------------------

export const STAMPS: { label: string; color: Rgb }[] = [
  { label: 'APPROVED', color: [0.08, 0.45, 0.16] },
  { label: 'COMPLETED', color: [0.08, 0.45, 0.16] },
  { label: 'FOR REVIEW', color: [0.1, 0.35, 0.8] },
  { label: 'DRAFT', color: [0.35, 0.35, 0.35] },
  { label: 'CONFIDENTIAL', color: [0.8, 0.1, 0.1] },
  { label: 'REJECTED', color: [0.8, 0.1, 0.1] },
  { label: 'VOID', color: [0.8, 0.1, 0.1] },
];

/** Stamp text size relative to the stamp's height. */
export const STAMP_TEXT_RATIO = 0.5;
