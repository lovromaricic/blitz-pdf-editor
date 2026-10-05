// Text boxes without lists, laid out with the real fonts: the regression
// baseline for list support (tests/fixtures/rich-layout-baseline.json was
// recorded before lists existed; text-lists.test.ts checks they still match).
import { readFileSync, readdirSync } from 'node:fs';
import type { Rgb, TextAnnotation, TextParagraph, TextRun } from '../src/lib/annotations';
import { faceKey, fontMetrics } from '../src/lib/font-catalog';
import { parseFontMetrics, textWidth, type FontMetrics } from '../src/lib/font-metrics';
import type { RichEnv } from '../src/lib/text-rich-layout';
import { plainText } from '../src/lib/text-rich';

const DIRS: Record<string, string> = { '': '400Regular', bold: '700Bold', italic: '400Regular_Italic', 'bold-italic': '700Bold_Italic' };
export function fontFile(key: string) {
  const m = /^([a-z0-9-]+?)(?:-(bold-italic|bold|italic))?$/.exec(key)!;
  const dir = `node_modules/@expo-google-fonts/${m[1]}/${DIRS[m[2] ?? '']}`;
  return `${dir}/${readdirSync(dir).find((f) => f.endsWith('.ttf'))}`;
}
const cache = new Map<string, FontMetrics>();
export function metrics(run: { font: string; bold?: boolean; italic?: boolean }) {
  const key = faceKey(run.font, run.bold, run.italic);
  if (!cache.has(key)) cache.set(key, parseFontMetrics(new Uint8Array(readFileSync(fontFile(key)))));
  return cache.get(key)!;
}
export const env: RichEnv = {
  measure: (run, text) => textWidth(metrics(run), text, run.size),
  vertical: (run) => {
    const [ascent, descent] = fontMetrics(run.font);
    return { ascent, descent };
  },
  decoration: (run) => metrics(run),
};

const BLACK: Rgb = [0, 0, 0];
export const run = (text: string, over: Partial<TextRun> = {}): TextRun => ({ text, font: 'roboto', size: 12, color: BLACK, ...over });
export function box(paragraphs: TextParagraph[], over: Partial<TextAnnotation> = {}): TextAnnotation {
  return { id: 'b', type: 'text', text: plainText(paragraphs), paragraphs, font: 'roboto', size: 12, color: BLACK, opacity: 1, rotate: 0, rect: [0, 0, 220, 100], ...over };
}

const words = 'The quick brown fox jumps over the lazy dog near the river bank, Čačić Đurđa šuma.';
export const CASES: Record<string, TextAnnotation> = {
  plain: box([{ runs: [run(words)] }, { runs: [run('')] }, { runs: [run('Second paragraph')] }]),
  mixed: box([{ runs: [run('Small '), run('Big', { size: 24, font: 'lora', bold: true }), run(' and ' + words, { italic: true, underline: true })] }]),
  center: box([{ runs: [run(words, { size: 14 })] }], { align: 'center', lineSpacing: 1.5 }),
  right: box([{ runs: [run(words, { font: 'merriweather', strike: true })] }], { align: 'right' }),
  justify: box([{ runs: [run(words + ' ' + words, { size: 10 })] }, { runs: [run('Last line stays left')] }], { align: 'justify', lineSpacing: 2 }),
  link: box([{ runs: [run('See '), run('the long linked words here', { link: { kind: 'url', href: 'https://example.com/' }, color: [0.07, 0.33, 0.8], underline: true }), run(' after.')] }], { rect: [0, 0, 120, 100] }),
};
