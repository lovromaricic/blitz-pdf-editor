// The fonts offered for text: open-source (SIL OFL 1.1), bundled with the app
// and fetched from our own server only when used. No DOM: shared by the UI,
// the PDF worker and tests. See THIRD_PARTY_LICENSES.md.

export type FontGroup = 'Sans serif' | 'Serif' | 'Monospace' | 'Handwriting';

export interface FontInfo {
  /** Stable id stored in annotations; also the @expo-google-fonts package name. */
  id: string;
  label: string;
  group: FontGroup;
  bold: boolean;
  italic: boolean;
  /** Ascent and descent per em (hhea, as browsers use for CSS line boxes), to place baselines like the screen does. */
  metrics: [number, number];
}

export const FONT_GROUPS: FontGroup[] = ['Sans serif', 'Serif', 'Monospace', 'Handwriting'];

export const FONTS: FontInfo[] = [
  { id: 'arimo', label: 'Arimo (Arial-style)', group: 'Sans serif', bold: true, italic: true, metrics: [0.905, 0.212] },
  { id: 'roboto', label: 'Roboto', group: 'Sans serif', bold: true, italic: true, metrics: [0.928, 0.244] },
  { id: 'open-sans', label: 'Open Sans', group: 'Sans serif', bold: true, italic: true, metrics: [1.069, 0.293] },
  // Replaces Lato: the Google Fonts build of Lato has no č or đ.
  { id: 'source-sans-3', label: 'Source Sans 3', group: 'Sans serif', bold: true, italic: true, metrics: [1.024, 0.4] },
  { id: 'montserrat', label: 'Montserrat', group: 'Sans serif', bold: true, italic: true, metrics: [0.968, 0.251] },
  { id: 'poppins', label: 'Poppins', group: 'Sans serif', bold: true, italic: true, metrics: [1.05, 0.35] },
  { id: 'inter', label: 'Inter', group: 'Sans serif', bold: true, italic: true, metrics: [0.969, 0.241] },
  { id: 'tinos', label: 'Tinos (Times-style)', group: 'Serif', bold: true, italic: true, metrics: [0.891, 0.216] },
  { id: 'lora', label: 'Lora', group: 'Serif', bold: true, italic: true, metrics: [1.006, 0.274] },
  { id: 'merriweather', label: 'Merriweather', group: 'Serif', bold: true, italic: true, metrics: [0.984, 0.273] },
  { id: 'playfair-display', label: 'Playfair Display', group: 'Serif', bold: true, italic: true, metrics: [1.082, 0.251] },
  { id: 'cousine', label: 'Cousine (Courier-style)', group: 'Monospace', bold: true, italic: true, metrics: [0.833, 0.3] },
  { id: 'caveat', label: 'Caveat', group: 'Handwriting', bold: true, italic: false, metrics: [0.96, 0.3] },
  { id: 'dancing-script', label: 'Dancing Script', group: 'Handwriting', bold: true, italic: false, metrics: [0.92, 0.28] },
  { id: 'great-vibes', label: 'Great Vibes', group: 'Handwriting', bold: false, italic: false, metrics: [0.851, 0.401] },
];

export const HANDWRITING = FONTS.filter((f) => f.group === 'Handwriting');

/** Default for new text. */
export const DEFAULT_FONT = 'arimo';

/**
 * The original three choices, kept working for text made with them and used as
 * the fallback when a font can't be loaded: bundled Noto, which covers Latin
 * (č ć đ š ž), Greek and Cyrillic.
 */
export const BUILTIN_FONTS: Record<string, { label: string; bold: boolean }> = {
  sans: { label: 'Sans serif (built-in)', bold: true },
  serif: { label: 'Serif (built-in)', bold: false },
  mono: { label: 'Monospace (built-in)', bold: false },
};

/** Used when a chosen font can't be loaded. */
export const FALLBACK_FONT = 'sans';

/** Noto's metrics (the built-in fonts). */
const BUILTIN_METRICS: [number, number] = [1.069, 0.293];

export function fontMetrics(id: string): [number, number] {
  return fontInfo(id)?.metrics ?? BUILTIN_METRICS;
}

/** Baseline of the first line of a text box, from the box top (points). Screen, print and PDF all use this. */
export function firstBaseline(font: string, size: number, lineHeight: number, padding: number) {
  const [ascent, descent] = fontMetrics(font);
  return padding + (lineHeight * size - (ascent + descent) * size) / 2 + ascent * size;
}

export function fontInfo(id: string): FontInfo | undefined {
  return FONTS.find((f) => f.id === id);
}

export function fontLabel(id: string): string {
  return fontInfo(id)?.label ?? BUILTIN_FONTS[id]?.label ?? id;
}

export function hasBold(id: string) {
  return fontInfo(id)?.bold ?? BUILTIN_FONTS[id]?.bold ?? false;
}

export function hasItalic(id: string) {
  return fontInfo(id)?.italic ?? false;
}

/** The file ("face") for a font and style. Styles the font lacks fall back to what it has. */
export function faceKey(font: string, bold = false, italic = false): string {
  const b = bold && hasBold(font);
  const i = italic && hasItalic(font);
  return [font, b ? 'bold' : '', i ? 'italic' : ''].filter(Boolean).join('-');
}

/** Folder of each style inside an @expo-google-fonts package. */
export const STYLE_DIRS: Record<string, { bold: boolean; italic: boolean }> = {
  '400Regular': { bold: false, italic: false },
  '400Regular_Italic': { bold: false, italic: true },
  '700Bold': { bold: true, italic: false },
  '700Bold_Italic': { bold: true, italic: true },
};
