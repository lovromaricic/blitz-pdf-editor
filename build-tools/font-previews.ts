// `virtual:font-previews`: each catalog font's name drawn in its own typeface,
// as an SVG path made from the glyph outlines at build time. The picker can show
// every name in its font without downloading any font, and no modified copies
// of the fonts are shipped (several have a Reserved Font Name under the OFL).
// Loaded only when the font picker opens.
import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import fontkit, { type Font } from '@cantoo/fontkit';
import { FONTS } from '../src/lib/font-catalog.ts';

const VIRTUAL = 'virtual:font-previews';
const RESOLVED = '\0' + VIRTUAL;

export interface Preview {
  /** SVG path, in font units, y pointing down, baseline at 0. */
  d: string;
  /** viewBox: x, y, width, height. */
  box: [number, number, number, number];
  /** Font units per em, to draw it at the surrounding font size. */
  em: number;
}

function preview(id: string, label: string): Preview {
  const dir = `node_modules/@expo-google-fonts/${id}/400Regular`;
  const font = fontkit.create(readFileSync(`${dir}/${readdirSync(dir).find((n) => n.endsWith('.ttf'))}`)) as Font;
  const run = font.layout(label);
  let x = 0;
  const parts: string[] = [];
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions![i];
    // Flip y (fonts are y-up) and move each glyph to its pen position.
    const path = glyph.path.scale(1, -1).translate(x + pos.xOffset, -pos.yOffset);
    parts.push(path.toSVG());
    x += pos.xAdvance;
  });
  // Round to whole font units: plenty of precision, much smaller output.
  const d = parts.join('').replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n))));
  return { d, box: [0, -font.ascent, Math.ceil(x), font.ascent - font.descent], em: font.unitsPerEm };
}

export function fontPreviews(): Plugin {
  let code: string | null = null;
  return {
    name: 'blitz-font-previews',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      code ??= `export default ${JSON.stringify(Object.fromEntries(FONTS.map((f) => [f.id, preview(f.id, f.label)])))};`;
      return code;
    },
  };
}
