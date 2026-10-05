// Text widths and line positions read straight from a font file (cmap, hmtx,
// head, post, OS/2), so the editor and the saved PDF measure text with exactly
// the same numbers. No kerning and no ligatures on either side: the screen
// turns them off in CSS, the PDF embeds fonts with those features off. No DOM.

export interface FontMetrics {
  /** Advance width of a character, in em. */
  advance(codePoint: number): number;
  /** Underline: top edge below the baseline (positive = below) and thickness, in em. */
  underline: { offset: number; thickness: number };
  /** Strikethrough: top edge above the baseline and thickness, in em. */
  strike: { offset: number; thickness: number };
}

/** When a font has no usable post / OS/2 values. */
export const FALLBACK_UNDERLINE = { offset: 0.1, thickness: 0.07 };
export const FALLBACK_STRIKE_OFFSET = 0.3;

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function parseFontMetrics(bytes: Uint8Array): FontMetrics {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // A collection: use its first font.
  const start = tag(v, 0) === 'ttcf' ? v.getUint32(12) : 0;
  const tables = new Map<string, number>();
  const count = v.getUint16(start + 4);
  for (let i = 0; i < count; i++) {
    const r = start + 12 + i * 16;
    tables.set(tag(v, r), v.getUint32(r + 8));
  }
  const at = (name: string) => {
    const o = tables.get(name);
    if (o === undefined) throw new Error(`Font has no ${name} table`);
    return o;
  };

  const upm = v.getUint16(at('head') + 18);
  const numberOfHMetrics = v.getUint16(at('hhea') + 34);
  const hmtx = at('hmtx');
  const advanceOfGlyph = (gid: number) => v.getUint16(hmtx + 4 * Math.min(gid, numberOfHMetrics - 1)) / upm;
  const glyphOf = cmapLookup(v, at('cmap'));

  const cache = new Map<number, number>();
  const advance = (cp: number) => {
    let w = cache.get(cp);
    if (w === undefined) {
      w = advanceOfGlyph(glyphOf(cp));
      cache.set(cp, w);
    }
    return w;
  };

  let underline = FALLBACK_UNDERLINE;
  const post = tables.get('post');
  if (post !== undefined) {
    const position = v.getInt16(post + 8) / upm;
    const thickness = v.getInt16(post + 10) / upm;
    if (thickness > 0 && position < 0) underline = { offset: -position, thickness };
  }
  let strike = { offset: FALLBACK_STRIKE_OFFSET, thickness: underline.thickness };
  const os2 = tables.get('OS/2');
  if (os2 !== undefined) {
    const size = v.getInt16(os2 + 26) / upm;
    const position = v.getInt16(os2 + 28) / upm;
    if (size > 0 && position > 0) strike = { offset: position, thickness: size };
  }
  return { advance, underline, strike };
}

/** Glyph id for a code point from the best Unicode cmap subtable (format 12, else 4); 0 (.notdef) if missing. */
function cmapLookup(v: DataView, cmap: number): (cp: number) => number {
  const n = v.getUint16(cmap + 2);
  let best: { offset: number; format: number } | null = null;
  for (let i = 0; i < n; i++) {
    const r = cmap + 4 + i * 8;
    const platform = v.getUint16(r);
    const encoding = v.getUint16(r + 2);
    const offset = cmap + v.getUint32(r + 4);
    const format = v.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!best || (format === 12 && best.format !== 12)) best = { offset, format };
  }
  if (!best) return () => 0;
  const o = best.offset;
  if (best.format === 12) {
    const groups = v.getUint32(o + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = o + 16 + mid * 12;
        const startCode = v.getUint32(g);
        const endCode = v.getUint32(g + 4);
        if (cp < startCode) hi = mid - 1;
        else if (cp > endCode) lo = mid + 1;
        else return v.getUint32(g + 8) + (cp - startCode);
      }
      return 0;
    };
  }
  const segX2 = v.getUint16(o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segX2; i += 2) {
      if (cp > v.getUint16(ends + i)) continue;
      const startCode = v.getUint16(starts + i);
      if (cp < startCode) return 0;
      const delta = v.getInt16(deltas + i);
      const ro = v.getUint16(rangeOffsets + i);
      if (ro === 0) return (cp + delta) & 0xffff;
      const gid = v.getUint16(rangeOffsets + i + ro + 2 * (cp - startCode));
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };
}

/** Width of `text` at `size` points (no kerning, no ligatures). */
export function textWidth(m: FontMetrics, text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += m.advance(ch.codePointAt(0)!);
  return w * size;
}
