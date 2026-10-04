// Watermark and page-number placement on a page as displayed (rotation and
// crop applied, y down, points). Pure: the editor, print and the PDF writer all
// use it, so the three agree. Text is Noto Sans Bold for watermarks and Noto
// Sans for numbers; callers supply the width measurement for that font.
import type { Rgb } from './annotations';
import { NUMBER_MARGIN, WATERMARK_SIZES, type NumberPosition, type WatermarkSettings } from './settings';

/** Per-page decoration, resolved from the document settings. Plain data for the worker. */
export interface PageDecoration {
  watermark?: Pick<WatermarkSettings, 'text' | 'size' | 'color' | 'opacity' | 'angle'>;
  number?: { text: string; size: number; position: NumberPosition };
}

export interface PlacedText {
  text: string;
  bold: boolean;
  /** Baseline start, in displayed page points (y down). */
  x: number;
  y: number;
  size: number;
  /** Counter-clockwise on screen, degrees. */
  angle: number;
  color: Rgb;
  opacity: number;
}

const ASCENT = 1.069;
/** Visual middle of capital letters above the baseline, per em. */
const MID_HEIGHT = 0.36;

/** `widthAt1` measures text at size 1 in the given weight. */
export function layoutDecoration(
  width: number,
  height: number,
  deco: PageDecoration,
  widthAt1: (text: string, bold: boolean) => number,
): PlacedText[] {
  const out: PlacedText[] = [];
  const wm = deco.watermark;
  if (wm && wm.text.trim()) {
    const rad = (wm.angle * Math.PI) / 180;
    // Span a share of the diagonal (or width) the text runs along.
    const span = wm.angle === 0 ? width : Math.hypot(width, height);
    const unit = widthAt1(wm.text, true) || 1;
    let size = (span * WATERMARK_SIZES[wm.size]) / unit;
    // Never taller than a quarter of the page.
    size = Math.min(size, height / 4);
    const w = unit * size;
    // Along-text and "up" directions on screen (y down).
    const dir = [Math.cos(rad), -Math.sin(rad)];
    const up = [-Math.sin(rad), -Math.cos(rad)];
    const cx = width / 2;
    const cy = height / 2;
    out.push({
      text: wm.text,
      bold: true,
      x: cx - (w / 2) * dir[0] - MID_HEIGHT * size * up[0],
      y: cy - (w / 2) * dir[1] - MID_HEIGHT * size * up[1],
      size,
      angle: wm.angle,
      color: wm.color,
      opacity: wm.opacity,
    });
  }
  const num = deco.number;
  if (num) {
    const w = widthAt1(num.text, false) * num.size;
    const [vertical, horizontal] = num.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
    const x = horizontal === 'left' ? NUMBER_MARGIN : horizontal === 'right' ? width - NUMBER_MARGIN - w : (width - w) / 2;
    const y = vertical === 'top' ? NUMBER_MARGIN + ASCENT * num.size * 0.75 : height - NUMBER_MARGIN;
    out.push({ text: num.text, bold: false, x, y, size: num.size, angle: 0, color: [0, 0, 0], opacity: 1 });
  }
  return out;
}

/**
 * Map a displayed point (y down, from the top-left of the visible page) to PDF
 * user space, for a page whose crop box is `box` shown with `rotation`.
 */
export function displayedToPdf(x: number, y: number, box: [number, number, number, number], rotation: number): [number, number] {
  const [x0, y0, x1, y1] = box;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [x0 + y, y0 + x];
    case 180:
      return [x1 - x, y0 + y];
    case 270:
      return [x1 - y, y1 - x];
    default:
      return [x0 + x, y1 - y];
  }
}
