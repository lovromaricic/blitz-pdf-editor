// A text block of the PDF becomes one of our text boxes, looking as it did:
// the same words and lines, baselines on the original ones, the same size,
// colour and alignment, in the closest bundled font (Arimo, Tinos and Cousine
// are metric-compatible with Arial, Times and Courier, so lines wrap alike).
// The box takes the block's width, so it wraps like before; when wrapping
// wouldn't give the same lines, each original line becomes its own paragraph.
import { newAnnotationId, rectFromUpright, type Rect, type TextAnnotation, type TextParagraph, type TextRun } from './annotations';
import type { Conversion, ConvLine, FontClass } from './pdf/content/edit';
import { TEXT_PADDING } from './text-box-layout';
import { layoutTextAnnotation, plainText } from './text-rich';
import { DEFAULT_LINE_SPACING } from './text-format';
import type { RichEnv } from './text-rich-layout';

export const FAMILY_FOR: Record<FontClass, string> = { sans: 'arimo', serif: 'tinos', mono: 'cousine' };
export const FAMILY_LABEL: Record<FontClass, string> = { sans: 'Arimo', serif: 'Tinos', mono: 'Cousine' };

/** Room added to the box's width so rounding never wraps a line early (points). */
const SLACK = 0.5;

const runsOf = (l: ConvLine): TextRun[] =>
  l.runs.map((r) => ({ text: r.text, font: FAMILY_FOR[r.family], size: r.size, color: r.color, ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) }));

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The lines joined into one paragraph (a space between them, none after a hyphen). */
function joined(lines: ConvLine[]): TextParagraph {
  const runs: TextRun[] = [];
  lines.forEach((l, i) => {
    const rs = runsOf(l);
    if (i > 0 && runs.length && !/-$/.test(runs[runs.length - 1].text)) runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text + ' ' };
    runs.push(...rs);
  });
  return { runs };
}

export interface Converted {
  box: TextAnnotation;
  /** Whether each original line had to become its own paragraph (wrapping gave other lines). */
  hardBreaks: boolean;
}

/** The text box for a block (upright text). `page` keeps the box inside the page as shown. */
export function textBoxFromConversion(c: Conversion, page: Rect, env: RichEnv): Converted {
  const pad = TEXT_PADDING;
  const u0 = Math.min(...c.lines.map((l) => l.left));
  const u1 = Math.max(...c.lines.map((l) => l.right));
  // Our layout doesn't kern, so a line can measure a little wider than it was drawn: the box
  // takes the widest line as we measure it (the alignment below keeps the original edges).
  const natural = Math.max(...c.lines.map((l) => runsOf(l).reduce((n, r, i, all) => n + env.measure(r, i === all.length - 1 ? r.text.trimEnd() : r.text), 0)));
  const width = Math.min(Math.max(u1 - u0, natural) + 2 * pad + SLACK, page[2] - page[0]);
  const lineSpacing = c.gap ? Math.round((c.gap / c.size) * 1000) / 1000 : DEFAULT_LINE_SPACING;
  const first = c.lines[0].runs[0];
  const base: TextAnnotation = {
    id: newAnnotationId(),
    type: 'text',
    rotate: 0,
    rect: [0, 0, width, 100],
    color: first?.color ?? [0, 0, 0],
    opacity: 1,
    text: '',
    font: FAMILY_FOR[c.family],
    size: c.size,
    ...(first?.bold ? { bold: true } : {}),
    ...(first?.italic ? { italic: true } : {}),
    align: c.align,
    lineSpacing,
    background: null,
    fromPdf: true,
  };
  const layout = (a: TextAnnotation, paragraphs: TextParagraph[]) => layoutTextAnnotation({ ...a, paragraphs, text: plainText(paragraphs) }, env);
  const want = c.lines.map((l) => flat(l.runs.map((r) => r.text).join('')));

  let box = base;
  let paragraphs = [joined(c.lines)];
  let laid = layout(box, paragraphs);
  let hardBreaks = false;
  if (laid.lines.length !== want.length || laid.lines.some((l, i) => flat(l.text) !== want[i])) {
    // Wrapping gives other lines: keep the original ones (justification can't stretch a paragraph's last line).
    hardBreaks = true;
    paragraphs = c.lines.map((l) => ({ runs: runsOf(l) }));
    if (box.align === 'justify') box = { ...box, align: 'left' };
    laid = layout(box, paragraphs);
  }
  // Placed so the first baseline is the original first baseline, and the lines start where they did.
  const x = c.align === 'right' ? u1 + pad - width : c.align === 'center' ? (u0 + u1) / 2 - width / 2 : u0 - pad;
  const left = Math.min(Math.max(x, page[0]), page[2] - width);
  const top = c.lines[0].baseline + laid.lines[0].baseline;
  const text = plainText(paragraphs);
  return { box: { ...box, paragraphs, text, rect: rectFromUpright([left, top], width, laid.height, 0) }, hardBreaks };
}
