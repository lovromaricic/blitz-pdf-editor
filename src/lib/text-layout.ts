// Browser-side layout for boxed annotations (needs canvas text measurement).
import {
  newAnnotationId,
  rectFromUpright,
  STAMP_TEXT_RATIO,
  uprightSize,
  uprightTopLeft,
  type Point,
  type Rgb,
  type StampAnnotation,
  type TextAnnotation,
} from './annotations';
import { measure } from './fonts';
import { textMeasure } from './font-metrics-store.svelte';
import { boxHeight, TEXT_PADDING, wrapParagraphs } from './text-box-layout';
import { lineSpacingOf } from './text-format';

export const DEFAULT_TEXT_WIDTH = 200;
export const STAMP_HEIGHT = 30;

/**
 * Re-wrap text to the box width (or `width`) with the font's own metrics, and
 * fit the box height to the lines. The width stays as the user set it.
 */
export function layoutText(a: TextAnnotation, width = uprightSize(a)[0]): TextAnnotation {
  const { lines, ends } = wrapParagraphs(a.text, textMeasure(a, a.size), Math.max(a.size, width - 2 * TEXT_PADDING));
  const height = boxHeight(lines.length, a.size, lineSpacingOf(a));
  return { ...a, lines, ends, rect: rectFromUpright(uprightTopLeft(a), width, height, a.rotate) };
}

/** A stamp sized to its label, centered on `center` (PDF space). */
export function makeStamp(label: string, color: Rgb, center: Point, rotate: number): StampAnnotation {
  const h = STAMP_HEIGHT;
  const w = measure(label, 'sans-bold', h * STAMP_TEXT_RATIO) + h * 1.2;
  const topLeft = topLeftForCenter(center, w, h, rotate);
  return { id: newAnnotationId(), type: 'stamp', color, opacity: 1, rotate, label, rect: rectFromUpright(topLeft, w, h, rotate) };
}

/** Upright top-left corner (PDF space) of a w x h box centered on `center`. */
export function topLeftForCenter(center: Point, w: number, h: number, rotate: number): Point {
  // Build the box at the center, then shift so its middle lands on `center`.
  const rect = rectFromUpright(center, w, h, rotate);
  const dx = center[0] - (rect[0] + rect[2]) / 2;
  const dy = center[1] - (rect[1] + rect[3]) / 2;
  return [center[0] + dx, center[1] + dy];
}
