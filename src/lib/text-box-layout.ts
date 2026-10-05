// Single-style text layout: the rules text boxes had before rich text. The
// app now lays out with text-rich-layout.ts, which must reproduce these
// exactly for single-style text (tests compare them); shared bits (padding,
// bars) live here. No DOM. Coordinates are points in the
// box's own upright frame: origin at its top-left, y down.
import type { TextAlign } from './annotations';

export type Measure = (text: string) => number;

/** Inner padding of text boxes, in points. */
export const TEXT_PADDING = 3;

/** Greedy word wrap. Long words break between characters. Empty lines are kept. `ends` marks each paragraph's last line. */
export function wrapParagraphs(text: string, measure: Measure, maxWidth: number): { lines: string[]; ends: boolean[] } {
  const fits = (t: string) => measure(t) <= maxWidth;
  const lines: string[] = [];
  const ends: boolean[] = [];
  const push = (line: string, end: boolean) => {
    lines.push(line);
    ends.push(end);
  };
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/).filter(Boolean)) {
      if (/^\s+$/.test(word)) {
        if (line) line += word;
        continue;
      }
      if (fits((line + word).trimEnd())) {
        line += word;
        continue;
      }
      if (line.trim()) push(line.trimEnd(), false);
      line = '';
      if (fits(word)) {
        line = word;
        continue;
      }
      // A single word wider than the box: split it between characters.
      for (const ch of word) {
        if (line && !fits(line + ch)) {
          push(line, false);
          line = '';
        }
        line += ch;
      }
    }
    push(line.trimEnd(), true);
  }
  return { lines, ends };
}

export interface LineBox {
  text: string;
  /** Left edge of the line's text. */
  x: number;
  /** Baseline. */
  y: number;
  /** Width of the text as drawn (justification included). */
  width: number;
  /** Extra space added after each space between words (justified lines), else 0. */
  wordSpacing: number;
  /** How many leading spaces the line has (they are never stretched). */
  indent: number;
}

export interface PlaceOptions {
  /** Box width (padding included). */
  width: number;
  size: number;
  /** Line height as a multiple of the size. */
  lineSpacing: number;
  align: TextAlign;
  /** Font ascent and descent, in em (for where the first baseline sits). */
  ascent: number;
  descent: number;
  padding?: number;
}

/** Baseline of the first line from the box top: the line box is centered on the font's ascent + descent, like CSS. */
export function firstBaseline(size: number, lineSpacing: number, ascent: number, descent: number, padding = TEXT_PADDING) {
  return padding + (lineSpacing * size - (ascent + descent) * size) / 2 + ascent * size;
}

/** Height of a box holding `lineCount` lines. */
export function boxHeight(lineCount: number, size: number, lineSpacing: number, padding = TEXT_PADDING) {
  return Math.max(1, lineCount) * size * lineSpacing + 2 * padding;
}

/**
 * Where each line goes. Justified lines spread the extra room over the spaces
 * between words; a paragraph's last line (and a line with one word) stays left.
 */
export function placeLines(lines: readonly string[], ends: readonly boolean[] | undefined, measure: Measure, o: PlaceOptions): LineBox[] {
  const pad = o.padding ?? TEXT_PADDING;
  const inner = Math.max(0, o.width - 2 * pad);
  const top = firstBaseline(o.size, o.lineSpacing, o.ascent, o.descent, pad);
  return lines.map((text, i) => {
    const natural = measure(text);
    const y = top + i * o.size * o.lineSpacing;
    const indent = text.length - text.trimStart().length;
    const gaps = countGaps(text);
    const lastOfParagraph = ends ? ends[i] !== false : true;
    if (o.align === 'justify' && !lastOfParagraph && gaps > 0 && natural < inner) {
      return { text, x: pad, y, width: inner, wordSpacing: (inner - natural) / gaps, indent };
    }
    const free = Math.max(0, inner - natural);
    const offset = o.align === 'center' ? free / 2 : o.align === 'right' ? free : 0;
    return { text, x: pad + offset, y, width: natural, wordSpacing: 0, indent };
  });
}

/** Spaces between words: every space after the line's first non-space character. */
export function countGaps(text: string) {
  const body = text.trimStart();
  let n = 0;
  for (const ch of body) if (ch === ' ') n++;
  return n;
}

/**
 * Split a line into runs at each space between words, for drawing justified
 * text: each run ends with its space, so a run's x is the sum of the earlier
 * runs' widths plus `wordSpacing` per earlier run.
 */
export function wordRuns(line: LineBox, measure: Measure): { text: string; x: number }[] {
  if (!line.wordSpacing) return [{ text: line.text, x: line.x }];
  const lead = line.text.slice(0, line.indent);
  const parts = line.text.slice(line.indent).split(/(?<= )/);
  const runs: { text: string; x: number }[] = [];
  let x = line.x;
  parts.forEach((part, i) => {
    const text = i === 0 ? lead + part : part;
    runs.push({ text, x });
    x += measure(text) + (part.endsWith(' ') ? line.wordSpacing : 0);
  });
  return runs;
}

export interface DecorationMetrics {
  underline: { offset: number; thickness: number };
  strike: { offset: number; thickness: number };
}

/** A filled bar in box coordinates. */
export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Underline and strikethrough bars: across each line's text (spaces between
 * words included), never past its last character. Empty lines get none.
 */
export function decorationBars(lines: readonly LineBox[], size: number, m: DecorationMetrics, flags: { underline?: boolean; strike?: boolean }): Bar[] {
  const bars: Bar[] = [];
  for (const l of lines) {
    if (!l.text.trim() || l.width <= 0) continue;
    if (flags.underline) bars.push({ x: l.x, y: l.y + m.underline.offset * size, w: l.width, h: m.underline.thickness * size });
    if (flags.strike) bars.push({ x: l.x, y: l.y - m.strike.offset * size, w: l.width, h: m.strike.thickness * size });
  }
  return bars;
}

