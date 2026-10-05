import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFontMetrics, textWidth } from '../src/lib/font-metrics';
import { boxHeight, countGaps, decorationBars, firstBaseline, placeLines, TEXT_PADDING, wordRuns, wrapParagraphs } from '../src/lib/text-box-layout';

const font = (path: string) => parseFontMetrics(new Uint8Array(readFileSync(`node_modules/@expo-google-fonts/${path}`)));
const arimo = font('arimo/400Regular/Arimo_400Regular.ttf');
const SIZE = 12;
const measure = (t: string) => textWidth(arimo, t, SIZE);
const ARIMO: [number, number] = [0.905, 0.212];
const opts = (align: 'left' | 'center' | 'right' | 'justify', width = 200, lineSpacing = 1.25) => ({ width, size: SIZE, lineSpacing, align, ascent: ARIMO[0], descent: ARIMO[1] });

describe('font metrics', () => {
  it('read widths, underline and strikethrough from the font file', () => {
    // Arimo is metric-compatible with Arial: "M" is 0.833 em, a space 0.278 em.
    expect(arimo.advance('M'.codePointAt(0)!)).toBeCloseTo(0.833, 3);
    expect(arimo.advance(32)).toBeCloseTo(0.278, 3);
    expect(arimo.underline.offset).toBeCloseTo(0.106, 3);
    expect(arimo.underline.thickness).toBeCloseTo(0.073, 3);
    expect(arimo.strike.offset).toBeCloseTo(0.259, 3);
  });

  it('measure Croatian letters in every style', () => {
    for (const path of ['arimo/400Regular/Arimo_400Regular.ttf', 'arimo/700Bold/Arimo_700Bold.ttf', 'arimo/400Regular_Italic/Arimo_400Regular_Italic.ttf', 'arimo/700Bold_Italic/Arimo_700Bold_Italic.ttf']) {
      const m = font(path);
      for (const ch of 'čćđšžČĆĐŠŽ') expect(m.advance(ch.codePointAt(0)!), `${ch} in ${path}`).toBeGreaterThan(0.3);
    }
  });

  it('do not break on right-to-left text or characters the font lacks', () => {
    expect(Number.isFinite(measure('שלום عربي 😀'))).toBe(true);
    const { lines } = wrapParagraphs('שלום עולם مرحبا بالعالم', measure, 60);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('wrapping', () => {
  it('breaks between words, keeps manual breaks and marks paragraph ends', () => {
    const { lines, ends } = wrapParagraphs('The quick brown fox jumps over the lazy dog\nEnd', measure, 120);
    expect(lines.every((l) => measure(l) <= 120)).toBe(true);
    expect(lines.join(' ')).toBe('The quick brown fox jumps over the lazy dog End');
    expect(ends).toEqual([...lines.slice(0, -2).map(() => false), true, true]);
  });

  it('splits a word longer than the box between characters', () => {
    const { lines } = wrapParagraphs('Supercalifragilisticexpialidocious', measure, 60);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => measure(l) <= 60)).toBe(true);
  });

  it('keeps empty lines', () => {
    expect(wrapParagraphs('a\n\nb', measure, 100)).toEqual({ lines: ['a', '', 'b'], ends: [true, true, true] });
  });
});

describe('alignment', () => {
  const inner = 200 - 2 * TEXT_PADDING;
  const w = measure('Hello world');

  it('places a line left, centered or right inside the padding', () => {
    expect(placeLines(['Hello world'], [true], measure, opts('left'))[0].x).toBe(TEXT_PADDING);
    expect(placeLines(['Hello world'], [true], measure, opts('center'))[0].x).toBeCloseTo(TEXT_PADDING + (inner - w) / 2);
    expect(placeLines(['Hello world'], [true], measure, opts('right'))[0].x).toBeCloseTo(TEXT_PADDING + inner - w);
  });

  it('justifies by spreading the room over the spaces between words', () => {
    const [line] = placeLines(['one two three'], [false], measure, opts('justify'));
    expect(line.width).toBeCloseTo(inner);
    expect(line.wordSpacing).toBeCloseTo((inner - measure('one two three')) / 2);
    const runs = wordRuns(line, measure);
    expect(runs.map((r) => r.text)).toEqual(['one ', 'two ', 'three']);
    // The last word ends exactly at the right padding.
    expect(runs[2].x + measure('three')).toBeCloseTo(TEXT_PADDING + inner);
  });

  it('leaves the last line of a paragraph, a one-word line and leading spaces unstretched', () => {
    const lines = placeLines(['first line here', 'last line', 'alone', '  indented line'], [false, true, false, false], measure, opts('justify'));
    expect(lines[0].wordSpacing).toBeGreaterThan(0);
    expect(lines[1]).toMatchObject({ wordSpacing: 0, x: TEXT_PADDING });
    expect(lines[2]).toMatchObject({ wordSpacing: 0, x: TEXT_PADDING });
    expect(countGaps('  indented line')).toBe(1);
    expect(lines[3].wordSpacing).toBeCloseTo(inner - measure('  indented line'));
  });

  it('never justifies text from before alignment existed (no paragraph ends stored)', () => {
    expect(placeLines(['a b c'], undefined, measure, opts('justify'))[0].wordSpacing).toBe(0);
  });
});

describe('line spacing', () => {
  it('places baselines one line height apart, the first centered like CSS', () => {
    for (const spacing of [1, 1.15, 1.25, 1.5, 2]) {
      const lines = placeLines(['a', 'b', 'c'], [false, false, true], measure, opts('left', 200, spacing));
      expect(lines[0].y).toBeCloseTo(firstBaseline(SIZE, spacing, ...ARIMO));
      expect(lines[2].y - lines[0].y).toBeCloseTo(2 * SIZE * spacing);
    }
    // The default (1.25) puts the first baseline where text boxes always had it.
    expect(firstBaseline(12, 1.25, ...ARIMO)).toBeCloseTo(3 + (15 - 1.117 * 12) / 2 + 0.905 * 12);
    expect(boxHeight(3, 12, 2)).toBe(3 * 24 + 6);
  });
});

describe('underline and strikethrough', () => {
  const m = { underline: arimo.underline, strike: arimo.strike };

  it('run under / through the text of each line, scaled with the size', () => {
    const lines = placeLines(['Hello world', ''], [false, true], measure, opts('center'));
    const bars = decorationBars(lines, SIZE, m, { underline: true, strike: true });
    expect(bars).toHaveLength(2); // none for the empty line
    const [u, s] = bars;
    expect(u.x).toBeCloseTo(lines[0].x);
    expect(u.w).toBeCloseTo(measure('Hello world')); // not past the last character
    expect(u.y).toBeCloseTo(lines[0].y + 0.106 * SIZE, 2);
    expect(u.h).toBeCloseTo(0.073 * SIZE, 2);
    expect(s.y).toBeCloseTo(lines[0].y - 0.259 * SIZE, 2);
  });

  it('span the whole width of a justified line, spaces included', () => {
    const lines = placeLines(['one two three'], [false], measure, opts('justify'));
    const [u] = decorationBars(lines, SIZE, m, { underline: true });
    expect(u.w).toBeCloseTo(200 - 2 * TEXT_PADDING);
  });

  it('fall back to 0.1 em below and 0.07 em thick without post values', () => {
    const lines = placeLines(['x'], [true], measure, opts('left'));
    const [u] = decorationBars(lines, 10, { underline: { offset: 0.1, thickness: 0.07 }, strike: { offset: 0.3, thickness: 0.07 } }, { underline: true });
    expect([u.y - lines[0].y, u.h]).toEqual([1, expect.closeTo(0.7)]);
  });
});
