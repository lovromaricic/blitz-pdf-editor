// Outline and fill of closed shapes (rectangles, ellipses): either may be
// "none", but not both (a shape nobody could see). The outline's color and
// thickness are kept while it's off, so choosing a color brings it back as it
// was. Lines and arrows are only an outline: none of this applies to them.
import { sameRgb, type Rgb, type ShapeAnnotation } from './annotations';

export const NEEDS_FILL_OR_OUTLINE = 'A shape needs a fill or an outline.';

/** The outline and fill settings a shape (or the Shapes tool's next shape) has. */
export interface ShapeStyle {
  color: Rgb;
  fill: Rgb | null;
  /** No outline: nothing is drawn around the shape (color and width are kept for later). */
  noOutline?: boolean;
}

/** Rectangles and ellipses have a fill and an optional outline. */
export const isClosed = (s: Pick<ShapeAnnotation, 'shape'>) => s.shape === 'rect' || s.shape === 'ellipse';

export const hasOutline = (s: Pick<ShapeStyle, 'noOutline'>) => !s.noOutline;

/** Set the outline: a color (on, at its kept thickness) or null (off). 'invisible' when there'd be neither fill nor outline. */
export function withOutline<T extends ShapeStyle>(s: T, color: Rgb | null): T | 'invisible' {
  if (color === null) return s.fill === null ? 'invisible' : { ...s, noOutline: true };
  const { noOutline: _, ...rest } = s;
  return { ...rest, color } as T;
}

/** Set the fill: a color or null (none). 'invisible' when there'd be neither fill nor outline. */
export function withFill<T extends ShapeStyle>(s: T, fill: Rgb | null): T | 'invisible' {
  if (fill === null && s.noOutline) return 'invisible';
  return { ...s, fill };
}

/**
 * The Outline row for several shapes: one color, "no outline" for all
 * (value null), or mixed (some with an outline and some without, or
 * different colors).
 */
export function outlineOf(shapes: readonly ShapeStyle[]): { value: Rgb | null; mixed: boolean } {
  if (!shapes.length) return { value: null, mixed: true };
  if (shapes.every((s) => s.noOutline)) return { value: null, mixed: false };
  if (shapes.some((s) => s.noOutline)) return { value: null, mixed: true };
  const first = shapes[0].color;
  return shapes.every((s) => sameRgb(s.color, first)) ? { value: first, mixed: false } : { value: null, mixed: true };
}
