// Groups a page's text runs into lines and blocks (paragraphs, headings, single
// lines), the units a person points at. Works in each baseline direction's own
// frame, so turned text groups like upright text. Reading order is the order
// the content draws them in (producers write text in reading order; checked
// on the fixtures, multi-column included).
import type { PageContent, Point, Quad, TextRun } from './interpret';

export interface TextLine {
  runs: TextRun[];
  text: string;
  /** Baseline position across the direction (larger is higher), and extent along it. */
  v: number;
  u0: number;
  u1: number;
  size: number;
}

export interface TextBlock {
  /** Index into the page's text runs of every run in the block (whitespace-only runs on its lines too). */
  runs: number[];
  lines: TextLine[];
  text: string;
  /** Degrees, counter-clockwise. */
  angle: number;
  /** The block's box in page space (turned with the text). */
  quad: Quad;
  /** Most used font, size and color (by characters). */
  font: string;
  size: number;
  color: [number, number, number] | null;
  /** Position in reading order. */
  order: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
/** Gap along a line, in ems, beyond which text is a separate piece (a table cell, another column). */
const GAP_EM = 1;

export function groupBlocks(content: PageContent): TextBlock[] {
  const runs = content.text.map((r, i) => ({ r, i })).filter(({ r }) => !r.invisible && r.glyphs.length);
  const byAngle = new Map<number, typeof runs>();
  for (const x of runs) {
    const a = Math.round(x.r.angle * 2) / 2;
    const key = [...byAngle.keys()].find((k) => Math.abs(k - a) < 1) ?? a;
    byAngle.set(key, [...(byAngle.get(key) ?? []), x]);
  }
  const blocks: (TextBlock & { first: number })[] = [];
  for (const [angle, list] of byAngle) {
    const u: Point = [Math.cos(rad(angle)), Math.sin(rad(angle))];
    const v: Point = [-u[1], u[0]];
    const dot = (p: Point, d: Point) => p[0] * d[0] + p[1] * d[1];
    type L = TextLine & { idx: number[]; first: number; blank: boolean; script?: boolean };
    const lines: L[] = [];
    const measured = list.map(({ r, i }) => {
      const us = r.glyphs.flatMap((g) => g.quad.map((p) => dot(p, u)));
      const bottom = Math.min(...r.glyphs.map((g) => dot(g.quad[0], v)));
      return { r, i, u0: Math.min(...us), u1: Math.max(...us), v: bottom - r.font.descent * r.size, blank: !r.glyphs.some((g) => g.text.trim()) };
    });
    // Lines: runs on one baseline, close along it.
    for (const m of measured.filter((x) => !x.blank)) {
      const s = m.r.size;
      // A gap of more than an em starts a new line piece (table cells, columns); word gaps are smaller.
      const line = lines.find((l) => Math.abs(l.v - m.v) < 0.35 * Math.max(s, l.size) && m.u0 - l.u1 < GAP_EM * Math.max(s, l.size) && l.u0 - m.u1 < GAP_EM * Math.max(s, l.size));
      if (line) {
        line.runs.push(m.r);
        line.idx.push(m.i);
        line.u0 = Math.min(line.u0, m.u0);
        line.u1 = Math.max(line.u1, m.u1);
        line.size = Math.max(line.size, s);
      } else lines.push({ runs: [m.r], idx: [m.i], text: '', v: m.v, u0: m.u0, u1: m.u1, size: s, first: m.i, blank: false });
    }
    // Superscripts and subscripts: a short line of smaller text, raised or lowered next to a
    // line of larger text, belongs to that line.
    for (const small of [...lines].sort((a, b) => a.size - b.size)) {
      if (small.runs.reduce((n, r) => n + r.glyphs.length, 0) > 4) continue;
      const host = lines.find(
        (l) =>
          l !== small &&
          small.size <= 0.85 * l.size &&
          small.v - l.v > -0.45 * l.size &&
          small.v - l.v < 0.6 * l.size &&
          small.u0 - l.u1 < 0.6 * l.size &&
          l.u0 - small.u1 < 0.6 * l.size,
      );
      if (!host) continue;
      host.runs.push(...small.runs);
      host.idx.push(...small.idx);
      host.u0 = Math.min(host.u0, small.u0);
      host.u1 = Math.max(host.u1, small.u1);
      host.script = true;
      host.first = Math.min(host.first, small.first);
      lines.splice(lines.indexOf(small), 1);
    }
    // Whitespace-only runs join the line they sit on (they go when it goes).
    for (const m of measured.filter((x) => x.blank)) {
      const line = lines.find((l) => Math.abs(l.v - m.v) < 0.35 * l.size && m.u0 <= l.u1 + l.size && m.u1 >= l.u0 - l.size);
      if (line) {
        line.runs.push(m.r);
        line.idx.push(m.i);
      }
    }
    for (const l of lines) l.text = lineText(l.runs, u);
    // Blocks: lines stacked with even spacing, overlapping along the baseline, similar size.
    const sorted = [...lines].sort((a, b) => b.v - a.v || a.u0 - b.u0);
    type B = { lines: L[]; spacing: number | null };
    const groups: B[] = [];
    for (const l of sorted) {
      let best: B | null = null;
      let bestDv = Infinity;
      for (const b of groups) {
        const last = b.lines[b.lines.length - 1];
        const dv = last.v - l.v;
        const size = Math.max(last.size, l.size);
        if (dv < 0.5 * size || dv > 1.75 * size) continue;
        if (Math.max(last.size, l.size) / Math.min(last.size, l.size) > 1.2) continue;
        // Even spacing; a line with a superscript or subscript may sit a little lower.
        const slack = last.script || l.script ? 0.45 : 0.2;
        if (b.spacing !== null && (dv - b.spacing > slack * size || b.spacing - dv > 0.2 * size)) continue;
        if (!(l.u0 < last.u1 && l.u1 > last.u0)) continue;
        if (dv < bestDv) {
          best = b;
          bestDv = dv;
        }
      }
      if (best) {
        best.spacing ??= bestDv;
        best.lines.push(l);
      } else groups.push({ lines: [l], spacing: null });
    }
    for (const g of groups) {
      const all = g.lines.flatMap((l) => l.runs);
      const glyphPts = all.flatMap((r) => r.glyphs.flatMap((gl) => gl.quad));
      const us = glyphPts.map((p) => dot(p, u));
      const vs = glyphPts.map((p) => dot(p, v));
      const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      const at = (a: number, b: number): Point => [a * u[0] + b * v[0], a * u[1] + b * v[1]];
      const weight = new Map<string, number>();
      for (const r of all) {
        const k = JSON.stringify([r.font.name, Math.round(r.size * 10) / 10, r.color]);
        weight.set(k, (weight.get(k) ?? 0) + r.glyphs.length);
      }
      const [font, size, color] = JSON.parse([...weight].sort((a, b) => b[1] - a[1])[0][0]);
      blocks.push({
        runs: g.lines.flatMap((l) => l.idx).sort((a, b) => a - b),
        lines: g.lines,
        text: g.lines.map((l) => l.text).join('\n'),
        angle,
        quad: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)],
        font,
        size,
        color,
        order: 0,
        first: Math.min(...g.lines.map((l) => l.first)),
      });
    }
  }
  blocks.sort((a, b) => a.first - b.first);
  return blocks.map(({ first: _, ...b }, order) => ({ ...b, order }));
}

/** A line's text: runs along the baseline, a space where there's a visible gap. */
function lineText(runs: TextRun[], u: Point) {
  const glyphs = runs
    .flatMap((r) => r.glyphs.map((g) => ({ g, size: r.size })))
    .map((x) => ({ ...x, a: x.g.quad[0][0] * u[0] + x.g.quad[0][1] * u[1], b: x.g.quad[1][0] * u[0] + x.g.quad[1][1] * u[1] }))
    .sort((p, q) => p.a - q.a);
  let s = '';
  let end = -Infinity;
  for (const x of glyphs) {
    if (s && x.a - end > 0.15 * x.size && !/\s$/.test(s) && !/^\s/.test(x.g.text)) s += ' ';
    s += x.g.text;
    end = Math.max(end, x.b);
  }
  return s.replace(/\s+/g, ' ').trim();
}
