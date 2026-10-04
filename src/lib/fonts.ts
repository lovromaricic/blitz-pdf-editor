// Fonts for text, stamps and form values. The same files are used on screen
// (CSS FontFace) and embedded (subset) into saved PDFs, so text looks the same
// everywhere. Every file is served by the app itself and fetched only when a
// font is first used; nothing comes from a CDN.
//
// - The text fonts (font-catalog.ts) load per family when chosen or hovered.
// - The built-in Noto fonts (sans, serif, mono) back stamps, older text and the
//   fallback when a font can't be loaded.
import sansUrl from '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url';
import sansBoldUrl from '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url';
import serifUrl from '@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url';
import monoUrl from '@expo-google-fonts/noto-sans-mono/400Regular/NotoSansMono_400Regular.ttf?url';
import { BUILTIN_FONTS, faceKey, FONTS, hasBold, hasItalic, STYLE_DIRS } from './font-catalog';

export type FontKey = string;

/** A font and style, as stored on text annotations. */
export interface TextStyle {
  font: string;
  bold?: boolean;
  italic?: boolean;
}

const absolute = (u: string) => new URL(u, document.baseURI).href;

// File URLs only (no fetching): the files are emitted as separate assets.
const catalogFiles = import.meta.glob(
  '/node_modules/@expo-google-fonts/{arimo,roboto,open-sans,source-sans-3,montserrat,poppins,inter,tinos,lora,merriweather,playfair-display,cousine,caveat,dancing-script,great-vibes}/{400Regular,400Regular_Italic,700Bold,700Bold_Italic}/*.ttf',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

/** Absolute URL of every font file, by face key (e.g. "roboto-bold-italic"). The PDF worker fetches from these. */
export const FONT_URLS: Record<FontKey, string> = {
  sans: absolute(sansUrl),
  'sans-bold': absolute(sansBoldUrl),
  serif: absolute(serifUrl),
  mono: absolute(monoUrl),
};
for (const [path, url] of Object.entries(catalogFiles)) {
  const m = /@expo-google-fonts\/([^/]+)\/([^/]+)\//.exec(path);
  const style = m && STYLE_DIRS[m[2]];
  if (m && style) FONT_URLS[faceKey(m[1], style.bold, style.italic)] = absolute(url);
}

const BUILTIN_CSS: Record<string, string> = { sans: 'BlitzSans', serif: 'BlitzSerif', mono: 'BlitzMono' };

/** CSS font-family for a font id. */
export function cssFamily(font: string) {
  return BUILTIN_CSS[font] ?? `Blitz-${font}`;
}

/** Only the styles the font really has: the browser must not fake bold or italic that the PDF won't have. */
export function resolveStyle(style: TextStyle): Required<TextStyle> {
  return { font: style.font, bold: !!style.bold && hasBold(style.font), italic: !!style.italic && hasItalic(style.font) };
}

/** CSS `font` shorthand for canvas drawing and measuring. */
export function cssFontFor(style: TextStyle, sizePx: number) {
  const s = resolveStyle(style);
  return `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${sizePx}px "${cssFamily(s.font)}"`;
}

/** Older API: a face key such as "sans" or "sans-bold". */
export function cssFont(key: FontKey, sizePx: number) {
  return key === 'sans-bold' ? cssFontFor({ font: 'sans', bold: true }, sizePx) : cssFontFor({ font: key }, sizePx);
}

let builtins: Promise<void> | null = null;

/** Register the built-in fonts (stamps, older text, fallback) and wait until they can be used. */
export function loadFonts(): Promise<void> {
  builtins ??= (async () => {
    const faces = [
      new FontFace('BlitzSans', `url(${FONT_URLS.sans})`, { weight: '400' }),
      new FontFace('BlitzSans', `url(${FONT_URLS['sans-bold']})`, { weight: '700' }),
      new FontFace('BlitzSerif', `url(${FONT_URLS.serif})`, { weight: '400' }),
      new FontFace('BlitzMono', `url(${FONT_URLS.mono})`, { weight: '400' }),
    ];
    for (const f of faces) document.fonts.add(f);
    await Promise.all(faces.map((f) => f.load()));
  })();
  return builtins;
}

const families = new Map<string, Promise<boolean>>();

/**
 * Load every style of a font (regular, bold, italic where it has them).
 * Resolves false if it couldn't be loaded; callers then fall back to Sans serif.
 */
export function ensureFont(font: string): Promise<boolean> {
  if (font in BUILTIN_FONTS) return loadFonts().then(() => true, () => false);
  // Fonts from the user's computer are registered (and loaded) when chosen.
  if (font.startsWith('local:')) return families.get(font) ?? Promise.resolve(false);
  let p = families.get(font);
  if (!p) {
    const info = FONTS.find((f) => f.id === font);
    p = (async () => {
      if (!info) return false;
      const styles = [
        { bold: false, italic: false },
        ...(info.bold ? [{ bold: true, italic: false }] : []),
        ...(info.italic ? [{ bold: false, italic: true }] : []),
        ...(info.bold && info.italic ? [{ bold: true, italic: true }] : []),
      ];
      const faces = styles.map(
        (s) =>
          new FontFace(cssFamily(font), `url(${FONT_URLS[faceKey(font, s.bold, s.italic)]})`, {
            weight: s.bold ? '700' : '400',
            style: s.italic ? 'italic' : 'normal',
          }),
      );
      try {
        await Promise.all(faces.map((f) => f.load()));
      } catch {
        families.delete(font); // try again next time
        return false;
      }
      for (const f of faces) document.fonts.add(f);
      return true;
    })();
    families.set(font, p);
  }
  return p;
}

export type FontPreviews = Record<string, { d: string; box: [number, number, number, number]; em: number }>;

let previews: Promise<FontPreviews | null> | null = null;

/** Each font's name drawn in its own typeface (SVG paths, a few KB in all), loaded once. Null if unavailable. */
export function loadFontPreviews(): Promise<FontPreviews | null> {
  previews ??= import('virtual:font-previews').then(
    (m) => m.default,
    () => null,
  );
  return previews;
}

/** A font family registered from elsewhere (the user's computer): its faces are already loaded. */
export function markFamilyLoaded(font: string) {
  families.set(font, Promise.resolve(true));
}

/** Load the fonts that some text needs (before measuring, drawing or printing it). */
export async function ensureFontsFor(styles: Iterable<TextStyle>) {
  await loadFonts();
  await Promise.all([...new Set([...styles].map((s) => s.font))].map(ensureFont));
}

/** Last font chosen for new text in this session (memory only). */
export const lastTextStyle: { font: string; bold: boolean; italic: boolean } = { font: 'arimo', bold: false, italic: false };

export const LINE_HEIGHT = 1.25;
/** Inner padding of text boxes, in points. */
export const TEXT_PADDING = 3;

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width of `text` in points at `size` points (the font must be loaded). */
export function measureStyled(text: string, style: TextStyle, size: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = cssFontFor(style, size);
  return measureCtx.measureText(text).width;
}

/** Older API, by face key (stamps use "sans-bold"). */
export function measure(text: string, key: FontKey, size: number) {
  return measureStyled(text, key === 'sans-bold' ? { font: 'sans', bold: true } : { font: key }, size);
}

/** Greedy word wrap. Long words break between characters. Empty lines are kept. */
export function wrapText(text: string, style: TextStyle, size: number, maxWidth: number): string[] {
  const fits = (t: string) => measureStyled(t, style, size) <= maxWidth;
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
