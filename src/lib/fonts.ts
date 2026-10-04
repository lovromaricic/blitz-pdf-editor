// Fonts for text, stamps and form values. Noto covers Latin (incl. č ć đ š ž),
// Greek and Cyrillic, which the 14 built-in PDF fonts can't. The same files are
// used on screen (CSS @font-face) and embedded (subset) into saved PDFs, so
// text looks the same everywhere. Files are fetched only when first used.
import sansUrl from '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url';
import sansBoldUrl from '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url';
import serifUrl from '@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url';
import monoUrl from '@expo-google-fonts/noto-sans-mono/400Regular/NotoSansMono_400Regular.ttf?url';

import type { FontFamily } from './annotations';

export type { FontFamily };
export type FontKey = FontFamily | 'sans-bold';

export const FONT_LABELS: Record<FontFamily, string> = { sans: 'Sans serif', serif: 'Serif', mono: 'Monospace' };

const absolute = (u: string) => new URL(u, document.baseURI).href;

/** Absolute URLs so the PDF worker can fetch them too. */
export const FONT_URLS: Record<FontKey, string> = {
  sans: absolute(sansUrl),
  'sans-bold': absolute(sansBoldUrl),
  serif: absolute(serifUrl),
  mono: absolute(monoUrl),
};

/** CSS font-family names used on screen. */
export const CSS_FAMILY: Record<FontKey, string> = {
  sans: 'BlitzSans',
  'sans-bold': 'BlitzSans',
  serif: 'BlitzSerif',
  mono: 'BlitzMono',
};

export function cssFont(key: FontKey, sizePx: number) {
  return `${key === 'sans-bold' ? 'bold ' : ''}${sizePx}px ${CSS_FAMILY[key]}`;
}

let registered: Promise<void> | null = null;

/** Register the fonts with the browser and wait until they can be measured and drawn. */
export function loadFonts(): Promise<void> {
  registered ??= (async () => {
    const faces = [
      new FontFace('BlitzSans', `url(${FONT_URLS.sans})`, { weight: '400' }),
      new FontFace('BlitzSans', `url(${FONT_URLS['sans-bold']})`, { weight: '700' }),
      new FontFace('BlitzSerif', `url(${FONT_URLS.serif})`, { weight: '400' }),
      new FontFace('BlitzMono', `url(${FONT_URLS.mono})`, { weight: '400' }),
    ];
    for (const f of faces) document.fonts.add(f);
    await Promise.all(faces.map((f) => f.load()));
  })();
  return registered;
}

export const LINE_HEIGHT = 1.25;
/** Inner padding of text boxes, in points. */
export const TEXT_PADDING = 3;

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width of `text` in points at `size` points (fonts must be loaded). */
export function measure(text: string, key: FontKey, size: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = cssFont(key, size);
  return measureCtx.measureText(text).width;
}

/** Greedy word wrap. Long words break between characters. Empty lines are kept. */
export function wrapText(text: string, key: FontKey, size: number, maxWidth: number): string[] {
  const fits = (t: string) => measure(t, key, size) <= maxWidth;
  const lines: string[] = [];
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
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      if (fits(word)) {
        line = word;
        continue;
      }
      // A single word wider than the box: split it between characters.
      for (const ch of word) {
        if (line && !fits(line + ch)) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
