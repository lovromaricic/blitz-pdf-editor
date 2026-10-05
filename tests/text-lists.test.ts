// Lists in text boxes: numbering, hanging-indent geometry, alignment, saving.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextParagraph } from '../src/lib/annotations';
import { alphabetic, listLabel, listNumbers, roman } from '../src/lib/list-numbering';
import { layoutTextAnnotation } from '../src/lib/text-rich';
import { BULLET_EM, LIST_INDENT_EM, MARKER_GAP_EM, linkAreas } from '../src/lib/text-rich-layout';
import { TEXT_PADDING } from '../src/lib/text-box-layout';
import { assemble } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';
import { box, CASES, env, fontFile, metrics, run } from './rich-layout-cases';

const item = (text: string, list?: 'bullet' | 'number', level = 0, over = {}): TextParagraph => ({ runs: [run(text, over)], ...(list ? { list } : {}), ...(level ? { level } : {}) });
const r = (v: number) => Math.round(v * 1e4) / 1e4;

describe('boxes without lists', () => {
  it('lay out exactly as before lists existed (recorded baseline)', () => {
    const baseline = JSON.parse(readFileSync('tests/fixtures/rich-layout-baseline.json', 'utf8'));
    for (const [name, a] of Object.entries(CASES)) {
      const l = layoutTextAnnotation(a, env);
      expect(l.markers).toEqual([]);
      const now = {
        height: r(l.height),
        lines: l.lines.map((ln) => ({ text: ln.text, x: r(ln.x), width: r(ln.width), top: r(ln.top), height: r(ln.height), baseline: r(ln.baseline), end: ln.end, segments: ln.segments.map((s) => [s.text, r(s.x), r(s.width), r(s.wordSpacing), s.indent]) })),
        bars: l.bars.map((b) => [r(b.x), r(b.y), r(b.w), r(b.h)]),
        links: linkAreas(l, env.measure).map((x) => [r(x.x), r(x.y), r(x.w), r(x.h)]),
      };
      expect(now, name).toEqual(baseline[name]);
    }
  });
});

describe('numbering', () => {
  const nums = (ps: TextParagraph[]) => listNumbers(ps);
  it('continues across consecutive numbered items and restarts after anything else at that level', () => {
    expect(nums([item('a', 'number'), item('b', 'number'), item('c', 'number')])).toEqual([1, 2, 3]);
    expect(nums([item('a', 'number'), item('plain'), item('b', 'number')])).toEqual([1, null, 1]);
    expect(nums([item('a', 'number'), item('dot', 'bullet'), item('b', 'number')])).toEqual([1, null, 1]);
  });

  it('a sublist restarts under each new parent item; deeper items don\'t break the parent count', () => {
    const ps = [item('1', 'number'), item('a', 'number', 1), item('b', 'number', 1), item('2', 'number'), item('a', 'number', 1), item('i', 'number', 2), item('ii', 'number', 2), item('b', 'number', 1), item('i', 'number', 2)];
    expect(nums(ps)).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 1]);
    // A bullet parent restarts the numbered sublist below it too.
    expect(nums([item('1', 'number', 1), item('•', 'bullet'), item('again', 'number', 1)])).toEqual([1, null, 1]);
  });

  it('writes levels as 1. / a. / i., with 10+ items and long alphabets', () => {
    expect(nums(Array.from({ length: 12 }, () => item('x', 'number')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([1, 10, 12].map((n) => listLabel(n, 0))).toEqual(['1.', '10.', '12.']);
    expect([1, 2, 26].map((n) => listLabel(n, 1))).toEqual(['a.', 'b.', 'z.']);
    // After z: aa, ab … az, ba … zz, aaa (as spreadsheet columns and CSS lower-alpha).
    expect([27, 28, 52, 53, 702, 703].map(alphabetic)).toEqual(['aa', 'ab', 'az', 'ba', 'zz', 'aaa']);
    expect([1, 4, 9, 14, 39, 40, 49, 90, 400, 1994, 3999].map(roman)).toEqual(['i', 'iv', 'ix', 'xiv', 'xxxix', 'xl', 'xlix', 'xc', 'cd', 'mcmxciv', 'mmmcmxcix']);
    // Past 3999 there are no standard numerals: digits.
    expect(roman(4000)).toBe('4000');
    expect(listLabel(40, 2)).toBe('xl.');
  });
});

describe('hanging indent and markers', () => {
  for (const size of [10, 16, 28]) {
    it(`indents ${LIST_INDENT_EM} em per level at ${size} pt; wrapped lines align with the text, not the marker`, () => {
      const long = 'A long list item that certainly wraps onto several lines in this box';
      const a = box([item(long, 'bullet', 0, { size }), item(long, 'number', 1, { size }), item(long, 'bullet', 2, { size })], { rect: [0, 0, 300, 100] });
      const l = layoutTextAnnotation(a, env);
      const unit = LIST_INDENT_EM * size;
      for (let level = 0; level < 3; level++) {
        const lines = l.lines.filter((ln) => ln.x === TEXT_PADDING + (level + 1) * unit);
        expect(lines.length, `level ${level}`).toBeGreaterThan(1);
        // Every line of the item fits the narrower width.
        for (const ln of lines) expect(ln.x + ln.width).toBeLessThanOrEqual(300 - TEXT_PADDING + 0.01);
      }
      const [disc, num, square] = l.markers;
      const xHeight = metrics(run('x')).xHeight;
      expect(disc).toMatchObject({ kind: 'disc', size: BULLET_EM * size });
      if (disc.kind !== 'number') {
        expect(disc.cx + disc.size / 2).toBeCloseTo(TEXT_PADDING + unit - MARKER_GAP_EM * size, 6);
        expect(disc.cy).toBeCloseTo(l.lines[0].baseline - (xHeight * size) / 2, 6);
      }
      expect(num).toMatchObject({ kind: 'number', text: 'a.' });
      if (num.kind === 'number') expect(num.right).toBeCloseTo(TEXT_PADDING + 2 * unit - MARKER_GAP_EM * size, 6);
      expect(square.kind).toBe('square');
    });
  }

  it('markers use the item\'s first run (size, color, font), with mixed sizes on the line', () => {
    const p: TextParagraph = { list: 'number', runs: [run('Big ', { size: 24, color: [1, 0, 0], font: 'lora' }), run('small', { size: 10 })] };
    const l = layoutTextAnnotation(box([p]), env);
    const m = l.markers[0];
    expect(m).toMatchObject({ kind: 'number', text: '1.', run: { size: 24, color: [1, 0, 0], font: 'lora' } });
    if (m.kind === 'number') expect(m.baseline).toBe(l.lines[0].baseline);
    expect(l.lines[0].x).toBeCloseTo(TEXT_PADDING + LIST_INDENT_EM * 24, 6);
  });

  it('lists stay left-aligned in centered and right-aligned boxes; justified in justified boxes (last line left)', () => {
    const long = 'Words words words words words words words words words words words words';
    for (const align of ['center', 'right'] as const) {
      const l = layoutTextAnnotation(box([item('Short', 'bullet'), item('Short plain')], { align }), env);
      expect(l.lines[0].x).toBeCloseTo(TEXT_PADDING + LIST_INDENT_EM * 12, 6);
      expect(l.lines[1].x).toBeGreaterThan(l.lines[0].x); // the plain paragraph follows the box
    }
    const j = layoutTextAnnotation(box([item(long, 'number')], { align: 'justify' }), env);
    expect(j.lines.length).toBeGreaterThan(1);
    expect(j.lines[0].segments[0].wordSpacing).toBeGreaterThan(0);
    expect(j.lines.at(-1)!.segments[0].wordSpacing).toBe(0);
  });

  it('empty items keep their marker; line spacing applies as before', () => {
    const l = layoutTextAnnotation(box([item('', 'bullet'), item('Next', 'bullet')], { lineSpacing: 2 }), env);
    expect(l.markers).toHaveLength(2);
    expect(l.lines[0].height).toBeCloseTo(2 * 12, 6);
  });
});

describe('saving lists', () => {
  const fonts = createFontProvider(async (key) => new Uint8Array(readFileSync(fontFile(key))));

  async function save(paragraphs: TextParagraph[], over = {}) {
    const a = box(paragraphs, { rect: [100, 500, 360, 700], ...over });
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    const out = await assemble([{ id: 's', bytes: await src.save() }], [{ pageId: 'p', sourceId: 's', index: 0, rotation: 0, annots: [a] }], 'preserve', { fonts });
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const page = await pdf.getPage(1);
    const text = ((await page.getTextContent()).items as { str: string; transform: number[] }[]).filter((i) => i.str.trim());
    const annots = await page.getAnnotations();
    await pdf.loadingTask.destroy();
    return { a, text, annots };
  }

  it('numbers are real text where the editor draws them, and the item text stays searchable', async () => {
    const { a, text } = await save([item('First', 'number'), item('Second', 'number'), item('Sub', 'number', 1)]);
    const l = layoutTextAnnotation(a, env);
    // Copied or searched, an item reads "1. First".
    expect(text.map((t) => t.str.trim())).toEqual(['1. First', '2. Second', 'a. Sub']);
    const one = text[0];
    const m = l.markers[0];
    if (m.kind !== 'number') throw new Error('number expected');
    expect(one.transform[4]).toBeCloseTo(100 + m.right - env.measure(m.run, '1.'), 1);
    expect(one.transform[5]).toBeCloseTo(700 - m.baseline, 1);
  });

  it('links inside wrapped list items stay clickable over their words', async () => {
    const p: TextParagraph = { list: 'bullet', runs: [run('Read '), run('the long linked words that wrap onto the next line', { link: { kind: 'url', href: 'https://example.com/' } })] };
    const { annots, a } = await save([p], { rect: [100, 500, 220, 700] });
    const links = annots.filter((x: { subtype: string }) => x.subtype === 'Link') as { rect: number[] }[];
    expect(links.length).toBeGreaterThan(1);
    const indentX = 100 + TEXT_PADDING + LIST_INDENT_EM * 12;
    for (const lk of links.slice(1)) expect(lk.rect[0]).toBeCloseTo(indentX, 0);
    void a;
  });

  it('Croatian letters in list items, with numbers, in every font and style', async () => {
    const { FONTS } = await import('../src/lib/font-catalog');
    const text = 'Čačić Ćuk Đurđa šžć ČĆĐŠŽ';
    for (const f of FONTS) {
      const styles = [{}, ...(f.bold ? [{ bold: true }] : []), ...(f.italic ? [{ italic: true }] : []), ...(f.bold && f.italic ? [{ bold: true, italic: true }] : [])];
      for (const s of styles) {
        const m = metrics({ font: f.id, ...s });
        for (const ch of `${text}0123456789.abcdefghijklmnopqrstuvwxyz`) if (ch !== ' ') expect(m.has(ch.codePointAt(0)!), `${f.id} ${JSON.stringify(s)} ${ch}`).toBe(true);
      }
    }
    // And through saving, in a few fonts and styles.
    for (const [font, s] of [['roboto', {}], ['lora', { italic: true }], ['merriweather', { bold: true }]] as const) {
      const { text: saved } = await save([item(text, 'number', 0, { font, ...s }), item(text, 'bullet', 1, { font, ...s })]);
      expect(saved.map((t) => t.str).join(' ')).toContain('Čačić');
      expect(saved.map((t) => t.str).join(' ')).toContain('ČĆĐŠŽ');
    }
  }, 30_000);
});
