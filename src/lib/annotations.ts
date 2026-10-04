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

export type Annotation = HighlightAnnotation | InkAnnotation | ShapeAnnotation;

let counter = 0;
export function newAnnotationId() {
  return `annot-${Date.now().toString(36)}-${++counter}`;
}

// --- Colours (placeholders until the visual design is decided) -----------

export const HIGHLIGHT_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'Yellow', rgb: [1, 0.92, 0.23] },
  { name: 'Green', rgb: [0.55, 0.85, 0.35] },
  { name: 'Blue', rgb: [0.4, 0.75, 1] },
  { name: 'Pink', rgb: [1, 0.55, 0.75] },
  { name: 'Orange', rgb: [1, 0.65, 0.2] },
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
  }
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
  if (a.type === 'highlight') return 'Highlight';
  if (a.type === 'ink') return 'Drawing';
  return { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' }[a.shape];
}
