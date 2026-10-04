// The comment icon: a speech bubble (rounded box and tail as ONE closed path,
// so its outline has no gaps) with three text lines. Defined once and drawn by
// the screen (SVG), print and export (canvas) and the saved PDF, so they match.
// Coordinates are PDF-style (y up) in a box NOTE_SIZE units wide.
import { NOTE_SIZE } from './annotations';

export type Segment = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

/** Outline width of the bubble, and of its text lines (units of the 22-unit icon). */
export const NOTE_STROKE = 1.5;
export const NOTE_LINE_WIDTH = 1.2;

// Box and tail, in the 22-unit icon.
const X0 = 1;
const X1 = 21;
const Y0 = 6.16;
// Room for half the outline inside the icon's box on every side.
const Y1 = 21;
const R = 2.64;
const TAIL = { left: 5.5, tipX: 4.4, tipY: 1, right: 9.9 };
/** Bezier handle length for a quarter circle. */
const K = 0.5523 * R;

/** The bubble outline: one closed path, clockwise in screen terms, starting on the bottom edge. */
export function bubblePath(): Segment[] {
  return [
    ['M', X0 + R, Y0],
    ['L', TAIL.left, Y0],
    ['L', TAIL.tipX, TAIL.tipY],
    ['L', TAIL.right, Y0],
    ['L', X1 - R, Y0],
    ['C', X1 - R + K, Y0, X1, Y0 + R - K, X1, Y0 + R],
    ['L', X1, Y1 - R],
    ['C', X1, Y1 - R + K, X1 - R + K, Y1, X1 - R, Y1],
    ['L', X0 + R, Y1],
    ['C', X0 + R - K, Y1, X0, Y1 - R + K, X0, Y1 - R],
    ['L', X0, Y0 + R],
    ['C', X0, Y0 + R - K, X0 + R - K, Y0, X0 + R, Y0],
    ['Z'],
  ];
}

/** The three text lines: [x1, y, x2]. */
export const NOTE_LINES: [number, number, number][] = [
  [4.4, 17.6, 17.6],
  [4.4, 13.86, 17.6],
  [4.4, 10.12, 13.2],
];

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** SVG path data, flipped to screen coordinates (y down) in the same 22-unit box. */
export function toSvgPath(segs: Segment[], height = NOTE_SIZE): string {
  const y = (v: number) => fmt(height - v);
  return segs
    .map((s) => {
      switch (s[0]) {
        case 'M':
        case 'L':
          return `${s[0]}${fmt(s[1])} ${y(s[2])}`;
        case 'C':
          return `C${fmt(s[1])} ${y(s[2])} ${fmt(s[3])} ${y(s[4])} ${fmt(s[5])} ${y(s[6])}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

/** PDF path operators (y up), scaled by `k`. */
export function toPdfPath(segs: Segment[], k = 1): string {
  const p = (...v: number[]) => v.map((n) => fmt(n * k)).join(' ');
  return segs
    .map((s) => {
      switch (s[0]) {
        case 'M':
          return `${p(s[1], s[2])} m`;
        case 'L':
          return `${p(s[1], s[2])} l`;
        case 'C':
          return `${p(s[1], s[2], s[3], s[4], s[5], s[6])} c`;
        case 'Z':
          return 'h';
      }
    })
    .join(' ');
}

/** Trace the path on a canvas whose coordinates are already PDF-style (y up, 22-unit box). */
export function traceCanvas(ctx: CanvasRenderingContext2D, segs: Segment[]) {
  ctx.beginPath();
  for (const s of segs) {
    if (s[0] === 'M') ctx.moveTo(s[1], s[2]);
    else if (s[0] === 'L') ctx.lineTo(s[1], s[2]);
    else if (s[0] === 'C') ctx.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
    else ctx.closePath();
  }
}
