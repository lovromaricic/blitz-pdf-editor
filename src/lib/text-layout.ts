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
import { screenEnv } from './font-metrics-store.svelte';
import { baseRun, formatAllRuns, layoutTextAnnotation, paragraphsOf, plainParagraphs, plainText, RUN_KEYS, toRich } from './text-rich';

export const DEFAULT_TEXT_WIDTH = 200;
export const STAMP_HEIGHT = 30;

/**
 * Lay a text box out again (after typing, formatting or resizing): the width
 * stays as the user set it and the height follows the text. A box from before
 * rich text becomes rich text here (one run per paragraph, same look).
 */
export function layoutText(a: TextAnnotation, width = uprightSize(a)[0]): TextAnnotation {
  const rich = toRich(a);
  const sized = { ...rich, rect: rectFromUpright(uprightTopLeft(a), width, 1, a.rotate) };
  const { height } = layoutTextAnnotation(sized, screenEnv);
  return { ...rich, text: plainText(rich.paragraphs!), rect: rectFromUpright(uprightTopLeft(a), width, height, a.rotate) };
}

/**
 * New plain text for a box, typed in the plain text field. Keeps the format
 * when the box has one (a box with mixed formats takes its first run's format
 * until the rich editor arrives).
 */
export function withPlainText(a: TextAnnotation, text: string): TextAnnotation {
  const runs = paragraphsOf(a).flatMap((p) => p.runs);
  const format = runs.find((r) => r.text) ?? runs[0] ?? baseRun(a);
  const { text: _t, ...style } = format;
  return layoutText({ ...toRich(a), text, paragraphs: plainParagraphs(text, style) });
}

/**
 * Formatting for a whole box: box settings (alignment, line spacing,
 * background, opacity) and run formats, which apply to all its text.
 */
export function formatTextBox(a: TextAnnotation, changes: Partial<TextAnnotation>): TextAnnotation {
  const runChanges = Object.fromEntries(Object.entries(changes).filter(([k]) => (RUN_KEYS as readonly string[]).includes(k)));
  const next = { ...a, ...changes };
  if (Object.keys(runChanges).length === 0) return next.paragraphs ? layoutText(next) : next;
  const rich = toRich(next);
  return layoutText({ ...rich, paragraphs: formatAllRuns(rich.paragraphs!, runChanges) });
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
