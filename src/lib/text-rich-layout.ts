// Layout for rich text boxes: paragraphs of runs, each run with its own font,
// size and style. The editor, printing and the saved PDF all use this, with
// widths from the font files (font-metrics.ts), so line breaks and positions
// are the same everywhere. No DOM. Coordinates are points in the box's own
// upright frame: origin at its top-left, y down.
//
// Lines stack like CSS inline layout (which the editor's editing surface also
// uses): every run's line box is its size × line spacing, centered on the
// font's ascent + descent; a line reaches from the highest of those to the
// lowest, with all runs on one baseline. A line in one font and size is
// therefore exactly size × line spacing tall, as text boxes always were.
import type { TextAlign, TextParagraph, TextRun } from './annotations';
import { TEXT_PADDING, type Bar, type DecorationMetrics } from './text-box-layout';

export interface RichEnv {
  /**
   * Changes when the measurements change (fonts' metrics arriving): line
   * layouts cached per paragraph are only reused within one epoch.
   */
  readonly epoch?: number;
  /** Width of `text` set in `run`'s font and size, in points (no kerning: widths add up). */
  measure(run: TextRun, text: string): number;
  /** The font's ascent and descent per em (as browsers use for line boxes). */
  vertical(run: TextRun): { ascent: number; descent: number };
  /** Underline and strikethrough position and thickness per em. */
  decoration(run: TextRun): DecorationMetrics;
}

export interface RichOptions {
  /** Box width (padding included). */
  width: number;
  align: TextAlign;
  lineSpacing: number;
  padding?: number;
  /**
   * Each paragraph is exactly one line, as given (text boxes from before rich
   * text keep their stored line breaks). `ends` then marks which lines end a
   * paragraph (for justification); missing means all of them.
   */
  given?: boolean;
  ends?: readonly boolean[];
}

/** One run's part of a line. */
export interface Segment {
  run: TextRun;
  text: string;
  /** Left edge (justification included). */
  x: number;
  /** Width as drawn (extra space after its spaces included, when justified). */
  width: number;
  /** Extra space after each space between words (justified lines), else 0. */
  wordSpacing: number;
  /** Leading spaces of the line in this segment (never stretched). */
  indent: number;
}

export interface RichLine {
  segments: Segment[];
  /** The line's plain text. */
  text: string;
  /** Left edge of the text and its width as drawn. */
  x: number;
  width: number;
  top: number;
  height: number;
  baseline: number;
  /** Ends a paragraph (a manual line break or the end of the text). */
  end: boolean;
  /** The run whose size sets an empty line's height. */
  styleRun: TextRun;
}

export interface RichLayout {
  lines: RichLine[];
  /**
   * The same lines grouped by paragraph, without vertical positions. A
   * paragraph that didn't change keeps the very same array (cached), so the
   * editor can redraw only the paragraph being typed in.
   */
  blocks: readonly PlacedLine[][];
  /** Underline and strikethrough, per run segment, in that run's color. */
  bars: (Bar & { run: TextRun })[];
  /** Height of the box that fits the text (padding included). */
  height: number;
}

interface Piece {
  run: TextRun;
  text: string;
}

const SPACE = /\s/;

function width(env: RichEnv, pieces: readonly Piece[]) {
  let w = 0;
  for (const p of pieces) w += env.measure(p.run, p.text);
  return w;
}

/** Remove trailing white space (it never takes room at the end of a line). */
function trimEnd(pieces: Piece[]): Piece[] {
  const out = pieces.slice();
  while (out.length) {
    const last = out[out.length - 1];
    const t = last.text.replace(/\s+$/, '');
    if (t) {
      out[out.length - 1] = { run: last.run, text: t };
      break;
    }
    out.pop();
  }
  return out;
}

/** Merge neighbouring pieces of the same run. */
function merge(pieces: readonly Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.run === p.run) out[out.length - 1] = { run: p.run, text: last.text + p.text };
    else if (p.text) out.push({ ...p });
  }
  return out;
}

/** A paragraph as words (non-space pieces, possibly across runs) and spaces. */
function tokens(paragraph: TextParagraph): { space: boolean; pieces: Piece[] }[] {
  const out: { space: boolean; pieces: Piece[] }[] = [];
  for (const run of paragraph.runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      const space = SPACE.test(part[0]);
      const last = out[out.length - 1];
      if (last && last.space === space) last.pieces.push({ run, text: part });
      else out.push({ space, pieces: [{ run, text: part }] });
    }
  }
  return out;
}

/**
 * Greedy word wrap across runs, the same rules as plain text boxes always had:
 * a word that doesn't fit moves to the next line, spaces at the start of a
 * wrapped line are dropped, a word longer than the box breaks between characters.
 */
function wrap(paragraph: TextParagraph, env: RichEnv, maxWidth: number): Piece[][] {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let lineWidth = 0;
  const fits = (w: number) => w <= maxWidth;
  for (const t of tokens(paragraph)) {
    const w = width(env, t.pieces);
    if (t.space) {
      if (line.length) {
        line.push(...t.pieces);
        lineWidth += w;
      }
      continue;
    }
    if (fits(lineWidth + w)) {
      line.push(...t.pieces);
      lineWidth += w;
      continue;
    }
    if (trimEnd(line).length) lines.push(trimEnd(line));
    line = [];
    lineWidth = 0;
    if (fits(w)) {
      line = [...t.pieces];
      lineWidth = w;
      continue;
    }
    // A single word wider than the box: split it between characters.
    for (const p of t.pieces) {
      for (const ch of p.text) {
        const cw = env.measure(p.run, ch);
        if (line.length && !fits(lineWidth + cw)) {
          lines.push(line);
          line = [];
          lineWidth = 0;
        }
        line.push({ run: p.run, text: ch });
        lineWidth += cw;
      }
    }
  }
  lines.push(trimEnd(line));
  return lines.map(merge);
}

/** Spaces between words in the line: every space after its first non-space character. */
function gapsIn(text: string) {
  let n = 0;
  for (const ch of text.trimStart()) if (ch === ' ') n++;
  return n;
}

/** A line without its vertical position (that depends on the paragraphs above it). */
export type PlacedLine = Omit<RichLine, 'top' | 'baseline'> & { above: number };

/** Per environment, per paragraph: its lines for one set of options and one measuring epoch. */
const cache = new WeakMap<RichEnv, WeakMap<TextParagraph, { key: string; lines: PlacedLine[] }>>();

export function layoutRich(paragraphs: readonly TextParagraph[], o: RichOptions, env: RichEnv): RichLayout {
  const pad = o.padding ?? TEXT_PADDING;
  const lines: RichLine[] = [];
  const blocks: PlacedLine[][] = [];
  const bars: RichLayout['bars'] = [];
  let top = pad;
  let perEnv = cache.get(env);
  if (!perEnv) cache.set(env, (perEnv = new WeakMap()));

  paragraphs.forEach((paragraph, pi) => {
    const key = `${env.epoch ?? 0}|${o.width}|${o.align}|${o.lineSpacing}|${pad}|${o.given ? `g${o.ends?.[pi] !== false}` : 'w'}`;
    let hit = perEnv.get(paragraph);
    if (!hit || hit.key !== key) {
      hit = { key, lines: placeParagraph(paragraph, pi, o, env, pad) };
      perEnv.set(paragraph, hit);
    }
    blocks.push(hit.lines);
    for (const l of hit.lines) {
      const baseline = top + l.above;
      lines.push({ ...l, top, baseline });
      for (const s of l.segments) {
        if (!s.run.underline && !s.run.strike) continue;
        const m = env.decoration(s.run);
        if (s.run.underline) bars.push({ run: s.run, x: s.x, y: baseline + m.underline.offset * s.run.size, w: s.width, h: m.underline.thickness * s.run.size });
        if (s.run.strike) bars.push({ run: s.run, x: s.x, y: baseline - m.strike.offset * s.run.size, w: s.width, h: m.strike.thickness * s.run.size });
      }
      top += l.height;
    }
  });
  return { lines, blocks, bars, height: top + pad };
}

/** One paragraph's lines: wrapped, aligned and justified, with heights (no vertical positions). */
function placeParagraph(paragraph: TextParagraph, pi: number, o: RichOptions, env: RichEnv, pad: number): PlacedLine[] {
  const inner = Math.max(0, o.width - 2 * pad);
  const out: PlacedLine[] = [];
  {
    const fallbackRun = paragraph.runs[paragraph.runs.length - 1];
    const wrapped = o.given ? [merge(paragraph.runs.map((run) => ({ run, text: run.text })))] : wrap(paragraph, env, Math.max(inner, 0.01));
    wrapped.forEach((pieces, li) => {
      const end = o.given ? o.ends?.[pi] !== false : li === wrapped.length - 1;
      const text = pieces.map((p) => p.text).join('');
      const styleRun = pieces[0]?.run ?? fallbackRun;

      // Vertical: each run's line box centered on its ascent + descent, all on one baseline.
      let above = 0;
      let below = 0;
      for (const run of pieces.length ? pieces.map((p) => p.run) : [styleRun]) {
        const { ascent, descent } = env.vertical(run);
        const half = (o.lineSpacing * run.size - (ascent + descent) * run.size) / 2;
        above = Math.max(above, ascent * run.size + half);
        below = Math.max(below, descent * run.size + half);
      }

      // Horizontal: alignment, or justification spread over the spaces between words.
      const widths = pieces.map((p) => env.measure(p.run, p.text));
      const natural = widths.reduce((a, b) => a + b, 0);
      const gaps = gapsIn(text);
      const justify = o.align === 'justify' && !end && gaps > 0 && natural < inner;
      const wordSpacing = justify ? (inner - natural) / gaps : 0;
      const free = Math.max(0, inner - natural);
      const x0 = pad + (justify ? 0 : o.align === 'center' ? free / 2 : o.align === 'right' ? free : 0);

      const segments: Segment[] = [];
      let x = x0;
      let seenText = false;
      pieces.forEach((p, i) => {
        // Leading spaces of the line are never stretched; every later space is.
        let indent = 0;
        let stretched = 0;
        for (const ch of p.text) {
          if (!seenText && SPACE.test(ch)) indent++;
          else {
            if (seenText && ch === ' ') stretched++;
            seenText = true;
          }
        }
        // A space ending the segment before this one's first character was counted there.
        const w = widths[i] + stretched * wordSpacing;
        segments.push({ run: p.run, text: p.text, x, width: w, wordSpacing, indent });
        x += w;
      });
      out.push({ segments, text, x: x0, width: x - x0, height: above + below, above, end, styleRun });
    });
  }
  return out;
}

/**
 * A justified segment cut after each stretched space, for drawing: each piece
 * starts where the previous one ended plus the extra space.
 */
export function segmentRuns(s: Segment, measure: (text: string) => number): { text: string; x: number }[] {
  if (!s.wordSpacing) return [{ text: s.text, x: s.x }];
  const lead = s.text.slice(0, s.indent);
  const parts = s.text.slice(s.indent).split(/(?<= )/);
  const out: { text: string; x: number }[] = [];
  let x = s.x;
  parts.forEach((part, i) => {
    const text = i === 0 ? lead + part : part;
    out.push({ text, x });
    x += measure(text) + (part.endsWith(' ') ? s.wordSpacing : 0);
  });
  return out;
}

/** A link's area on one line, in the box's upright frame (y down). */
export interface LinkArea {
  link: NonNullable<TextRun['link']>;
  x: number;
  y: number;
  w: number;
  h: number;
}

const sameTarget = (a: TextRun['link'], b: TextRun['link']) =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'url' ? a.href === (b as typeof a).href : a.pageId === (b as Extract<typeof b, { kind: 'page' }>).pageId);

/**
 * Where the links are: one rectangle per line per link, covering its
 * neighbouring segments and the line's height. A link broken over two lines
 * has two rectangles. Leading spaces of a line (never part of what you click)
 * are left out; `measure` is the layout's own.
 */
export function linkAreas(layout: Pick<RichLayout, 'lines'>, measure: RichEnv['measure']): LinkArea[] {
  const out: LinkArea[] = [];
  for (const line of layout.lines) {
    let open: LinkArea | null = null;
    for (const s of line.segments) {
      const link = s.run.link;
      if (!link) {
        open = null;
        continue;
      }
      const end = s.x + s.width;
      if (open && sameTarget(open.link, link)) {
        open.w = end - open.x;
        continue;
      }
      if (!s.text.slice(s.indent).trim()) continue; // only spaces: nothing to click yet
      const x = s.indent ? s.x + measure(s.run, s.text.slice(0, s.indent)) : s.x;
      open = { link, x, y: line.top, w: end - x, h: line.height };
      out.push(open);
    }
  }
  return out;
}
