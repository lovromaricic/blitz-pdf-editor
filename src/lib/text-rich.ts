// The rich text model of text boxes: paragraphs of runs. Converting boxes
// from before rich text, plain text, formatting all runs, and the one entry
// point that lays out any text box. No DOM.
import { LINK_COLOR, sameRgb, uprightSize, type Rgb, type TextAnnotation, type TextLink, type TextParagraph, type TextRun } from './annotations';
import { alignOf, lineSpacingOf } from './text-format';
import { layoutRich, type RichEnv, type RichLayout } from './text-rich-layout';

/** Run formatting (everything but the text). */
export type RunFormat = Omit<TextRun, 'text'>;

/** The box's base style as a run: what all text of a box from before rich text looks like. */
export function baseRun(a: TextAnnotation, text = ''): TextRun {
  return {
    text,
    font: a.font,
    size: a.size,
    color: a.color,
    ...(a.bold ? { bold: true } : {}),
    ...(a.italic ? { italic: true } : {}),
    ...(a.underline ? { underline: true } : {}),
    ...(a.strike ? { strike: true } : {}),
  };
}

/** Plain text in one format: one paragraph per line, each a single run. */
export function plainParagraphs(text: string, format: RunFormat): TextParagraph[] {
  return text.split('\n').map((line) => ({ runs: [{ ...format, text: line }] }));
}

/** A box's content as paragraphs (a box from before rich text: its text in its one style). */
export function paragraphsOf(a: TextAnnotation): TextParagraph[] {
  return a.paragraphs ?? plainParagraphs(a.text, baseRun(a));
}

export function plainText(paragraphs: readonly TextParagraph[]): string {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

const sameLink = (a?: TextLink, b?: TextLink) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === 'url' ? a.href === (b as typeof a).href : a.pageId === (b as Extract<TextLink, { kind: 'page' }>).pageId));

export function sameFormat(a: RunFormat, b: RunFormat): boolean {
  return (
    a.font === b.font &&
    a.size === b.size &&
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    sameRgb(a.color, b.color) &&
    sameLink(a.link, b.link)
  );
}

/** A paragraph's list fields, only when it's a list item (a plain paragraph has none). */
export function listOf(p: TextParagraph): Pick<TextParagraph, 'list' | 'level'> {
  if (!p.list) return {};
  return p.level ? { list: p.list, level: p.level } : { list: p.list };
}

/** Merge neighbouring runs with the same format and drop empty ones (an empty paragraph keeps one). */
export function normalize(paragraphs: readonly TextParagraph[]): TextParagraph[] {
  return paragraphs.map((p) => {
    const runs: TextRun[] = [];
    for (const r of p.runs) {
      const last = runs[runs.length - 1];
      if (!r.text) continue;
      if (last && sameFormat(last, r)) runs[runs.length - 1] = { ...last, text: last.text + r.text };
      else runs.push({ ...r });
    }
    return { ...listOf(p), runs: runs.length ? runs : [{ ...p.runs[p.runs.length - 1], text: '' }] };
  });
}

/** Set formatting on every run (the whole box selected, not being edited). */
export function formatAllRuns(paragraphs: readonly TextParagraph[], changes: Partial<RunFormat>): TextParagraph[] {
  return normalize(paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, ...changes })) })));
}

/** How a new link looks: link blue, underlined (both can be changed afterwards). */
export function linkStyle(f: RunFormat, link: TextLink): RunFormat {
  return { ...f, link, color: LINK_COLOR, underline: true };
}

/**
 * The format without its link. Text still in the link look (link blue) goes
 * back to `color` without the underline; text recoloured since keeps its look.
 */
export function unlinkStyle(f: RunFormat, color: Rgb): RunFormat {
  const { link: _l, ...rest } = f;
  if (!sameRgb(f.color, LINK_COLOR)) return rest;
  const { underline: _u, ...plain } = rest;
  return { ...plain, color };
}

/**
 * Take out links to pages that are gone (deleted). Returns the box unchanged
 * when it has none, and how many links were removed.
 */
export function dropPageLinks(a: TextAnnotation, gone: (pageId: string) => boolean): { annot: TextAnnotation; removed: number } {
  if (!a.paragraphs) return { annot: a, removed: 0 };
  let removed = 0;
  const paragraphs = a.paragraphs.map((p) => {
    let previous: TextLink | undefined;
    const runs = p.runs.map((r) => {
      const dead = r.link?.kind === 'page' && gone(r.link.pageId);
      if (dead && !sameLink(previous, r.link)) removed++;
      previous = r.link;
      return dead ? { ...unlinkStyle(r, a.color), text: r.text } : r;
    });
    return runs.some((r, i) => r !== p.runs[i]) ? { ...p, runs } : p;
  });
  return removed ? { annot: { ...a, paragraphs: normalize(paragraphs) }, removed } : { annot: a, removed: 0 };
}

/** Keys that are run formatting (not box settings). */
export const RUN_KEYS = ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'color'] as const;

/**
 * Convert a box from before rich text to the rich model: one run per
 * paragraph, in its style. Its look doesn't change (same wrapping rules).
 */
export function toRich(a: TextAnnotation): TextAnnotation {
  if (a.paragraphs) return a;
  const { lines: _lines, ends: _ends, ...rest } = a;
  return { ...rest, paragraphs: paragraphsOf(a) };
}

/**
 * Lay out any text box. Rich boxes wrap with the layout engine; boxes from
 * before rich text keep their stored line breaks, so they look exactly as before.
 */
export function layoutTextAnnotation(a: TextAnnotation, env: RichEnv): RichLayout {
  const [width] = uprightSize(a);
  const options = { width, align: alignOf(a), lineSpacing: lineSpacingOf(a) };
  if (a.paragraphs) return layoutRich(a.paragraphs, options, env);
  const base = baseRun(a);
  return layoutRich(
    (a.lines ?? a.text.split('\n')).map((line) => ({ runs: [{ ...base, text: line }] })),
    { ...options, given: true, ends: a.ends },
    env,
  );
}

/** Every run format used in a box (for loading fonts before drawing or saving). */
export function runsOf(a: TextAnnotation): TextRun[] {
  return paragraphsOf(a).flatMap((p) => p.runs);
}
