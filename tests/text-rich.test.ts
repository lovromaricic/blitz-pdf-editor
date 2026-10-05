import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import type { Rgb, TextAnnotation, TextParagraph, TextRun } from '../src/lib/annotations';
import { faceKey, fontMetrics } from '../src/lib/font-catalog';
import { parseFontMetrics, textWidth, type FontMetrics } from '../src/lib/font-metrics';
import { decorationBars, placeLines, TEXT_PADDING, wrapParagraphs } from '../src/lib/text-box-layout';
import { layoutRich, type RichEnv } from '../src/lib/text-rich-layout';
import { baseRun, formatAllRuns, layoutTextAnnotation, normalize, plainText, toRich } from '../src/lib/text-rich';
import { assemble } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';

// --- Real fonts, as the editor and the PDF writer use them ---------------------------

const DIRS: Record<string, string> = { '': '400Regular', bold: '700Bold', italic: '400Regular_Italic', 'bold-italic': '700Bold_Italic' };
function fontFile(key: string) {
  const m = /^([a-z0-9-]+?)(?:-(bold-italic|bold|italic))?$/.exec(key)!;
  const dir = `node_modules/@expo-google-fonts/${m[1]}/${DIRS[m[2] ?? '']}`;
  return `${dir}/${readdirSync(dir).find((f) => f.endsWith('.ttf'))}`;
}
const metricsCache = new Map<string, FontMetrics>();
function metrics(run: { font: string; bold?: boolean; italic?: boolean }) {
  const key = faceKey(run.font, run.bold, run.italic);
  if (!metricsCache.has(key)) metricsCache.set(key, parseFontMetrics(new Uint8Array(readFileSync(fontFile(key)))));
  return metricsCache.get(key)!;
}
const env: RichEnv = {
  measure: (run, text) => textWidth(metrics(run), text, run.size),
  vertical: (run) => {
    const [ascent, descent] = fontMetrics(run.font);
    return { ascent, descent };
  },
  decoration: (run) => metrics(run),
};

const BLACK: Rgb = [0, 0, 0];
const run = (text: string, over: Partial<TextRun> = {}): TextRun => ({ text, font: 'roboto', size: 12, color: BLACK, ...over });
const para = (...runs: TextRun[]): TextParagraph => ({ runs });

function box(over: Partial<TextAnnotation>): TextAnnotation {
  return { id: 'b', type: 'text', text: '', font: 'roboto', size: 12, color: BLACK, opacity: 1, rotate: 0, rect: [0, 0, 200, 100], ...over };
}

// --- Migration ------------------------------------------------------------------------

describe('boxes from before rich text', () => {
  const TEXTS = [
    'Plain text that wraps over a couple of lines in the box.',
    'Justified text spreads its words across the line, except the last.\nSecond paragraph.',
    'Supercalifragilisticexpialidocious and more',
    'Čačić, Đurđa, šžć ĆŽŠ in every font',
    'a\n\nb',
  ];
  const STYLES: Partial<TextAnnotation>[] = [
    { font: 'roboto', size: 12 },
    { font: 'lora', size: 15, italic: true, underline: true, align: 'center' },
    { font: 'arimo', size: 10, bold: true, strike: true, align: 'right', lineSpacing: 1.5 },
    { font: 'tinos', size: 13, align: 'justify', lineSpacing: 2 },
  ];

  it('become one run per paragraph, in their style', () => {
    const legacy = box({ text: 'One\nTwo', lines: ['One', 'Two'], bold: true, color: [1, 0, 0] });
    const rich = toRich(legacy);
    expect(rich.paragraphs).toEqual([{ runs: [{ ...baseRun(legacy), text: 'One' }] }, { runs: [{ ...baseRun(legacy), text: 'Two' }] }]);
    expect(rich.lines).toBeUndefined();
    expect(plainText(rich.paragraphs!)).toBe('One\nTwo');
  });

  it('are laid out exactly as before, unconverted and converted (lines, positions, bars, height)', () => {
    for (const style of STYLES) {
      for (const text of TEXTS) {
        const a = box({ ...style, text });
        const r = baseRun(a);
        const measure = (t: string) => env.measure(r, t);
        // The layout before rich text.
        const { lines, ends } = wrapParagraphs(text, measure, 200 - 2 * TEXT_PADDING);
        const [ascent, descent] = fontMetrics(a.font);
        const old = placeLines(lines, ends, measure, { width: 200, size: a.size, lineSpacing: a.lineSpacing ?? 1.25, align: a.align ?? 'left', ascent, descent });
        const oldBars = decorationBars(old, a.size, metrics(r), a);

        for (const layout of [layoutTextAnnotation({ ...a, lines, ends }, env), layoutTextAnnotation(toRich({ ...a, lines, ends }), env)]) {
          expect(layout.lines.map((l) => l.text)).toEqual(lines);
          layout.lines.forEach((l, i) => {
            expect(l.baseline).toBeCloseTo(old[i].y, 6);
            expect(l.x).toBeCloseTo(old[i].x, 6);
            expect(l.width).toBeCloseTo(old[i].width, 6);
            expect(l.segments[0]?.wordSpacing ?? 0).toBeCloseTo(old[i].wordSpacing, 6);
          });
          expect(layout.bars.map((b) => [b.x, b.y, b.w, b.h])).toEqual(oldBars.map((b) => [b.x, b.y, b.w, b.h].map((v) => expect.closeTo(v, 6))));
          expect(layout.height).toBeCloseTo(lines.length * a.size * (a.lineSpacing ?? 1.25) + 2 * TEXT_PADDING, 6);
        }
      }
    }
  });

  it('keep stored line breaks that differ from today\'s wrapping until edited', () => {
    const a = box({ text: 'Stored line breaks win', lines: ['Stored', 'line breaks win'] });
    expect(layoutTextAnnotation(a, env).lines.map((l) => l.text)).toEqual(['Stored', 'line breaks win']);
  });
});

// --- Wrapping and baselines with several runs ---------------------------------------------

const opts = { width: 200, align: 'left' as const, lineSpacing: 1.25 };

describe('wrapping across runs', () => {
  it('keeps a word whose letters are in different runs together', () => {
    const p = para(run('Some text then a word '), run('Hel', { bold: true }), run('lo', { italic: true }), run(' that continues on and on'));
    const { lines } = layoutRich([p], { ...opts, width: 120 }, env);
    expect(lines.map((l) => l.text).join('|')).not.toMatch(/Hel\|lo/);
    expect(lines.some((l) => l.text.includes('Hello'))).toBe(true);
    // The pieces of "Hello" sit side by side, each in its run.
    const line = lines.find((l) => l.text.includes('Hello'))!;
    const hel = line.segments.find((s) => s.text.endsWith('Hel'))!;
    const lo = line.segments.find((s) => s.text.startsWith('lo'))!;
    expect(lo.x).toBeCloseTo(hel.x + env.measure(hel.run, hel.text));
  });

  it('breaks at spaces in any run, and never leaves a line wider than the box', () => {
    const p = para(run('Mixed sizes '), run('BIG WORDS ', { size: 24 }), run('and small ones again', { size: 9 }));
    const { lines } = layoutRich([p], { ...opts, width: 150 }, env);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(150 - 2 * TEXT_PADDING + 1e-9);
    expect(lines.map((l) => l.text).join(' ')).toBe('Mixed sizes BIG WORDS and small ones again');
  });

  it('splits a word longer than the box between characters, across runs', () => {
    const p = para(run('Supercali', { size: 20 }), run('fragilistic', { size: 20, bold: true }));
    const { lines } = layoutRich([p], { ...opts, width: 80 }, env);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.map((l) => l.text).join('')).toBe('Supercalifragilistic');
  });

  it('keeps manual line breaks and empty paragraphs', () => {
    const { lines } = layoutRich([para(run('One')), para(run('', { size: 30 })), para(run('Two'))], opts, env);
    expect(lines.map((l) => [l.text, l.end])).toEqual([['One', true], ['', true], ['Two', true]]);
    // The empty paragraph is as tall as its own (30 pt) run.
    expect(lines[1].height).toBeCloseTo(30 * 1.25);
  });
});

describe('baselines and line height with mixed sizes', () => {
  it('puts all runs on one baseline; a line is as tall as its tallest run (one font)', () => {
    const { lines } = layoutRich([para(run('small '), run('BIG', { size: 30 }), run(' small'))], opts, env);
    const [l] = lines;
    expect(l.height).toBeCloseTo(30 * 1.25);
    const [ascent, descent] = fontMetrics('roboto');
    expect(l.baseline).toBeCloseTo(TEXT_PADDING + ascent * 30 + (1.25 * 30 - (ascent + descent) * 30) / 2);
  });

  it('follows the CSS line box with different fonts (each run centered on its own ascent + descent)', () => {
    const { lines } = layoutRich([para(run('Roboto ', { size: 20 }), run('Great Vibes', { font: 'great-vibes', size: 20 }))], opts, env);
    const r = fontMetrics('roboto');
    const g = fontMetrics('great-vibes');
    const above = Math.max(...[r, g].map(([A, D]) => A * 20 + (25 - (A + D) * 20) / 2));
    const below = Math.max(...[r, g].map(([A, D]) => D * 20 + (25 - (A + D) * 20) / 2));
    expect(lines[0].height).toBeCloseTo(above + below);
    expect(lines[0].height).toBeGreaterThanOrEqual(25);
  });

  it('stacks lines: each starts where the previous ended', () => {
    const { lines, height } = layoutRich([para(run('Line one is long enough to wrap onto two lines'), run(' and BIG', { size: 28 }))], { ...opts, width: 160 }, env);
    for (let i = 1; i < lines.length; i++) expect(lines[i].top).toBeCloseTo(lines[i - 1].top + lines[i - 1].height);
    expect(height).toBeCloseTo(lines.at(-1)!.top + lines.at(-1)!.height + TEXT_PADDING);
  });
});

describe('justification with several runs', () => {
  const paragraph = para(run('Justified text '), run('with bold words ', { bold: true }), run('and a ', { size: 16 }), run('colored tail that wraps around', { color: [1, 0, 0] }));
  const { lines } = layoutRich([paragraph], { ...opts, width: 180, align: 'justify' }, env);

  it('spreads the room over every space between words, in every run, up to the right padding', () => {
    for (const l of lines.slice(0, -1)) {
      const last = l.segments.at(-1)!;
      expect(last.x + last.width).toBeCloseTo(180 - TEXT_PADDING, 6);
      // Segments follow each other without gaps or overlaps.
      for (let i = 1; i < l.segments.length; i++) expect(l.segments[i].x).toBeCloseTo(l.segments[i - 1].x + l.segments[i - 1].width, 6);
    }
  });

  it('leaves the last line of the paragraph unstretched', () => {
    expect(lines.at(-1)!.segments.every((s) => s.wordSpacing === 0)).toBe(true);
    expect(lines.at(-1)!.x).toBe(TEXT_PADDING);
  });
});

describe('underline and strikethrough per run', () => {
  it('cover each formatted segment in its run\'s size and color, never past the text', () => {
    const { lines, bars } = layoutRich([para(run('plain '), run('under', { underline: true, color: [0, 0, 1] }), run(' big strike', { size: 20, strike: true }))], opts, env);
    expect(bars).toHaveLength(2);
    const [u, s] = bars;
    const seg = lines[0].segments.find((x) => x.run.underline)!;
    expect([u.x, u.w]).toEqual([seg.x, seg.width]);
    expect(u.run.color).toEqual([0, 0, 1]);
    expect(u.y).toBeCloseTo(lines[0].baseline + metrics(seg.run).underline.offset * 12);
    expect(s.h).toBeCloseTo(metrics({ font: 'roboto' }).strike.thickness * 20);
    expect(s.x + s.w).toBeCloseTo(lines[0].x + lines[0].width);
  });
});

describe('model helpers', () => {
  it('merge neighbouring runs with the same format and keep one run in an empty paragraph', () => {
    expect(normalize([para(run('a'), run('b'), run('c', { bold: true })), para(run('', { size: 20 }))])).toEqual([
      para(run('ab'), run('c', { bold: true })),
      para(run('', { size: 20 })),
    ]);
  });

  it('format all runs at once (the whole box)', () => {
    expect(formatAllRuns([para(run('a'), run('b', { bold: true }))], { underline: true })).toEqual([para(run('a', { underline: true }), run('b', { bold: true, underline: true }))]);
  });
});

// --- Export positions ---------------------------------------------------------------------

describe('saving rich text', () => {
  const fonts = createFontProvider(async (key) => new Uint8Array(readFileSync(fontFile(key))));

  it('draws each run in its own font, size and color, where the layout puts it', async () => {
    const paragraphs = [para(run('Plain '), run('Bold', { bold: true, color: [1, 0, 0] }), run(' Big Čačić', { size: 20, font: 'lora', italic: true }))];
    const a = box({ paragraphs, text: plainText(paragraphs), rect: [100, 600, 400, 640], background: [1, 1, 0.8] });
    const layout = layoutTextAnnotation(a, env);
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    const out = await assemble([{ id: 's', bytes: await src.save() }], [{ sourceId: 's', index: 0, rotation: 0, annots: [a] }], 'preserve', { fonts });
    const doc = await PDFDocument.load(out);
    const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
    const ap = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as PDFRawStream;
    const group = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('Tx0')) as PDFRawStream;
    const content = new TextDecoder('latin1').decode(decodePDFRawStream(group).decode());
    const h = 40;
    const shown = [...content.matchAll(/([\d. ]+) rg \/(F\d) ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => ({ color: m[1], font: m[2], size: +m[3], x: +m[4], y: +m[5] }));
    const segs = layout.lines[0].segments;
    expect(shown).toHaveLength(segs.length);
    shown.forEach((s, i) => {
      expect(s.size).toBe(segs[i].run.size);
      expect(s.x).toBeCloseTo(segs[i].x, 2);
      expect(s.y).toBeCloseTo(h - layout.lines[0].baseline, 2);
    });
    expect(shown[1].color).toBe('1 0 0');
    // Three faces: Roboto, Roboto Bold, Lora Italic, each embedded as a subset.
    expect(new Set(shown.map((s) => s.font)).size).toBe(3);
    expect(content.indexOf(' re f')).toBeLessThan(content.indexOf('BT'));
    const names = doc.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font') ? [String(o.get(PDFName.of('BaseFont')))] : []));
    expect(names.some((n) => /Roboto-Bold/.test(n)) && names.some((n) => /Lora-Italic/.test(n))).toBe(true);
  });
});

describe('Croatian letters', () => {
  it('exist in every font and every style it offers (no missing-glyph boxes)', async () => {
    const { FONTS } = await import('../src/lib/font-catalog');
    const missing: string[] = [];
    for (const f of FONTS) {
      const styles = [{}, ...(f.bold ? [{ bold: true }] : []), ...(f.italic ? [{ italic: true }] : []), ...(f.bold && f.italic ? [{ bold: true, italic: true }] : [])];
      for (const s of styles) {
        const m = metrics({ font: f.id, ...s });
        for (const ch of 'čćđšžČĆĐŠŽ') if (!m.has(ch.codePointAt(0)!)) missing.push(`${f.id} ${JSON.stringify(s)} ${ch}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
