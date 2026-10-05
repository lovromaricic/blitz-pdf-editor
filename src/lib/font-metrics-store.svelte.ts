// Font metrics in the browser: read from the same font files the editor shows
// and the PDF embeds (fetched once; the browser has them cached by then).
import { faceKey, fontMetrics } from './font-catalog';
import type { RichEnv } from './text-rich-layout';
import { ensureFont, FONT_URLS, measureStyled, type TextStyle } from './fonts';
import { FALLBACK_STRIKE_OFFSET, FALLBACK_UNDERLINE, parseFontMetrics, textWidth, type FontMetrics } from './font-metrics';
import type { DecorationMetrics, Measure } from './text-box-layout';

const loaded = new Map<string, FontMetrics>();
const pending = new Map<string, Promise<FontMetrics | null>>();

/** Bumps when metrics arrive, so text drawn with the stand-in measure is laid out again. */
export const metricsState = $state({ version: 0 });

const keyOf = (s: TextStyle) => faceKey(s.font, s.bold, s.italic);

export function loadMetrics(style: TextStyle): Promise<FontMetrics | null> {
  const key = keyOf(style);
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const url = FONT_URLS[key];
      if (!url) return null;
      try {
        const m = parseFontMetrics(new Uint8Array(await (await fetch(url)).arrayBuffer()));
        loaded.set(key, m);
        metricsState.version++;
        return m;
      } catch {
        pending.delete(key);
        return null;
      }
    })();
    pending.set(key, p);
  }
  return p;
}

/** Metrics for every style a font offers. */
export function loadFontMetrics(font: string) {
  return Promise.all([false, true].flatMap((bold) => [false, true].map((italic) => loadMetrics({ font, bold, italic }))));
}

export function metricsFor(style: TextStyle): FontMetrics | undefined {
  return loaded.get(keyOf(style));
}

/** Measure text in this style and size (points). Until the metrics are in, the browser measures (close, not exact). */
export function textMeasure(style: TextStyle, size: number): Measure {
  const m = metricsFor(style);
  if (m) return (t) => textWidth(m, t, size);
  void loadMetrics(style);
  return (t) => measureStyled(t, style, size);
}

export function decorationMetrics(style: TextStyle): DecorationMetrics {
  const m = metricsFor(style);
  return m ? { underline: m.underline, strike: m.strike } : { underline: FALLBACK_UNDERLINE, strike: { offset: FALLBACK_STRIKE_OFFSET, thickness: FALLBACK_UNDERLINE.thickness } };
}

/** Load a text font for display and its metrics for layout. */
export async function ensureTextFont(font: string) {
  const [ok] = await Promise.all([ensureFont(font), loadFontMetrics(font)]);
  return ok;
}

/** Measuring for the rich text layout on screen: the font files' own metrics (the browser's measure until they arrive). */
export const screenEnv: RichEnv = {
  measure: (run, text) => {
    const m = metricsFor(run);
    if (m) return textWidth(m, text, run.size);
    void loadMetrics(run);
    return measureStyled(text, run, run.size);
  },
  vertical: (run) => {
    const [ascent, descent] = fontMetrics(run.font);
    return { ascent, descent };
  },
  decoration: (run) => decorationMetrics(run),
};
