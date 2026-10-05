// What the interpreter needs to know about a font to place its glyphs: how a
// string splits into character codes, each code's advance width, its Unicode
// text, and the font's ascent and descent. Simple fonts (Type1, TrueType,
// Type3) and composite fonts (Type0 with CIDFontType0/2) are supported;
// anything the font doesn't tell us reliably is listed in `problems`.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFObject } from '@cantoo/pdf-lib';
import { Encodings, Font, FontNames } from '@cantoo/pdf-lib/standard-fonts';

export interface FontInfo {
  /** Without the subset prefix ("ABCDEF+"). */
  name: string;
  subtype: string;
  embedded: boolean;
  vertical: boolean;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
  /** Ascent and descent in text space units per 1 unit of font size (0.9, -0.2…). */
  ascent: number;
  descent: number;
  /** Type3: glyph space to text space. Others: 1/1000. */
  scale: number;
  /** Split a string into codes. */
  codes(bytes: Uint8Array): { code: number; len: number }[];
  /** Advance width in glyph space (1000 per em for non-Type3). */
  width(code: number): number;
  unicode(code: number): string;
  problems: string[];
}

const lookup = (o: PDFObject | undefined, ctx: { lookup(o: PDFObject): PDFObject | undefined }) => (o instanceof PDFRef ? ctx.lookup(o) : o);

function streamBytes(s: PDFObject | undefined): Uint8Array | null {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s instanceof PDFStream) return (s as PDFStream & { getContents(): Uint8Array }).getContents();
  return null;
}

const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);
const numOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

// --- Encodings and glyph names ---------------------------------------------------------------

type Mapping = Record<number, [number, string]>;
const WIN: Mapping = (Encodings.WinAnsi as unknown as { unicodeMappings: Mapping }).unicodeMappings;
const SYM: Mapping = (Encodings.Symbol as unknown as { unicodeMappings: Mapping }).unicodeMappings;
const DING: Mapping = (Encodings.ZapfDingbats as unknown as { unicodeMappings: Mapping }).unicodeMappings;

const invert = (m: Mapping) => {
  const byCode = new Map<number, { uni: number; name: string }>();
  const byName = new Map<string, number>();
  for (const [uni, [code, name]] of Object.entries(m)) {
    if (!byCode.has(code)) byCode.set(code, { uni: Number(uni), name });
    if (!byName.has(name)) byName.set(name, Number(uni));
  }
  return { byCode, byName };
};
const WIN_I = invert(WIN);
const SYM_I = invert(SYM);
const DING_I = invert(DING);

/** Glyph names outside WinAnsi that matter for Latin text (Croatian, other European letters). */
const EXTRA_NAMES: Record<string, number> = {
  Dcroat: 0x110, dcroat: 0x111, Ccaron: 0x10c, ccaron: 0x10d, Cacute: 0x106, cacute: 0x107, Lslash: 0x141, lslash: 0x142,
  Scaron: 0x160, scaron: 0x161, Zcaron: 0x17d, zcaron: 0x17e, dotlessi: 0x131, fi: 0xfb01, fl: 0xfb02, Euro: 0x20ac,
  Ecaron: 0x11a, ecaron: 0x11b, Rcaron: 0x158, rcaron: 0x159, Ncaron: 0x147, ncaron: 0x148, Tcaron: 0x164, tcaron: 0x165,
  Uring: 0x16e, uring: 0x16f, Aogonek: 0x104, aogonek: 0x105, Eogonek: 0x118, eogonek: 0x119, Zdotaccent: 0x17b, zdotaccent: 0x17c,
  Nacute: 0x143, nacute: 0x144, Sacute: 0x15a, sacute: 0x15b, Zacute: 0x179, zacute: 0x17a, Gbreve: 0x11e, gbreve: 0x11f,
  Idotaccent: 0x130, Scedilla: 0x15e, scedilla: 0x15f, Ohungarumlaut: 0x150, ohungarumlaut: 0x151, Uhungarumlaut: 0x170, uhungarumlaut: 0x171,
  minus: 0x2212, nbspace: 0xa0, sfthyphen: 0xad,
};

export function glyphNameToUnicode(name: string): string {
  const base = name.split('.')[0];
  const known = WIN_I.byName.get(base) ?? EXTRA_NAMES[base] ?? SYM_I.byName.get(base) ?? DING_I.byName.get(base);
  if (known !== undefined) return String.fromCodePoint(known);
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(base);
  if (m) return m[1].match(/.{4}/g)!.map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  if (base.length === 1) return base;
  return '';
}

/** Mac OS Roman, codes 128–255. */
const MAC_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
/** Standard encoding, where it differs from ASCII / WinAnsi in the codes that matter. */
const STANDARD_DIFF: Record<number, string> = { 0x27: 'quoteright', 0x60: 'quoteleft' };

/** A simple font's code → glyph name (or Unicode when there's no name). */
function simpleEncoding(fontDict: PDFDict, ctx: PDFDict['context'], symbolic: string | null) {
  const names = new Map<number, string>();
  const unis = new Map<number, string>();
  const enc = lookup(fontDict.get(PDFName.of('Encoding')), ctx);
  const baseName = nameOf(enc) ?? (enc instanceof PDFDict ? nameOf(enc.get(PDFName.of('BaseEncoding'))) : undefined);
  const base = symbolic === 'Symbol' ? SYM_I : symbolic === 'ZapfDingbats' ? DING_I : WIN_I;
  for (let c = 0; c < 256; c++) {
    if (baseName === 'MacRomanEncoding' && c >= 128) {
      unis.set(c, MAC_HIGH[c - 128]);
      continue;
    }
    if (!baseName && !symbolic && STANDARD_DIFF[c]) {
      names.set(c, STANDARD_DIFF[c]);
      continue;
    }
    const e = base.byCode.get(c);
    if (e) {
      names.set(c, e.name);
      unis.set(c, String.fromCodePoint(e.uni));
    }
  }
  if (enc instanceof PDFDict) {
    const diffs = lookup(enc.get(PDFName.of('Differences')), ctx);
    if (diffs instanceof PDFArray) {
      let code = 0;
      for (const d of diffs.asArray()) {
        const v = lookup(d, ctx);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) {
          names.set(code, v.decodeText());
          unis.delete(code);
          code++;
        }
      }
    }
  }
  return { names, unis };
}

// --- CMaps (ToUnicode and embedded encodings) -----------------------------------------------

interface CMap {
  /** Code space: byte lengths that occur, with ranges. */
  space: { len: number; lo: number; hi: number }[];
  map: Map<number, string>;
  cids: Map<number, number>;
  cidRanges: { lo: number; hi: number; cid: number }[];
}

function hexToNum(h: string) {
  return parseInt(h || '0', 16);
}
function hexToText(h: string) {
  if (h.length <= 2) return String.fromCharCode(parseInt(h || '0', 16));
  let s = '';
  for (let k = 0; k + 3 < h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
  return s;
}

export function parseCMap(text: string): CMap {
  const cmap: CMap = { space: [], map: new Map(), cids: new Map(), cidRanges: [] };
  const sections = (kw: string) => [...text.matchAll(new RegExp(`begin${kw}([\\s\\S]*?)end${kw}`, 'g'))].map((m) => m[1]);
  for (const s of sections('codespacerange')) {
    for (const m of s.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) cmap.space.push({ len: m[1].length / 2, lo: hexToNum(m[1]), hi: hexToNum(m[2]) });
  }
  for (const s of sections('bfchar')) {
    for (const m of s.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) cmap.map.set(hexToNum(m[1]), hexToText(m[2]));
  }
  for (const s of sections('bfrange')) {
    for (const m of s.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hexToNum(m[1]);
      const hi = hexToNum(m[2]);
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        items.forEach((h, k) => lo + k <= hi && cmap.map.set(lo + k, hexToText(h)));
      } else {
        const h = m[3].slice(1, -1);
        const start = hexToText(h);
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          const last = start.charCodeAt(start.length - 1) + (c - lo);
          cmap.map.set(c, start.slice(0, -1) + String.fromCharCode(last));
        }
      }
    }
  }
  for (const s of sections('cidchar')) for (const m of s.matchAll(/<([0-9a-fA-F]+)>\s*(\d+)/g)) cmap.cids.set(hexToNum(m[1]), Number(m[2]));
  for (const s of sections('cidrange')) for (const m of s.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\d+)/g)) cmap.cidRanges.push({ lo: hexToNum(m[1]), hi: hexToNum(m[2]), cid: Number(m[3]) });
  return cmap;
}

function splitBySpace(bytes: Uint8Array, space: CMap['space'], fallbackLen: number) {
  const out: { code: number; len: number }[] = [];
  let i = 0;
  while (i < bytes.length) {
    let done = false;
    for (let len = 1; len <= 4 && i + len <= bytes.length; len++) {
      let v = 0;
      for (let k = 0; k < len; k++) v = v * 256 + bytes[i + k];
      if (space.some((s) => s.len === len && v >= s.lo && v <= s.hi)) {
        out.push({ code: v, len });
        i += len;
        done = true;
        break;
      }
    }
    if (!done) {
      const len = Math.min(fallbackLen, bytes.length - i);
      let v = 0;
      for (let k = 0; k < len; k++) v = v * 256 + bytes[i + k];
      out.push({ code: v, len });
      i += len;
    }
  }
  return out;
}

// --- The font ---------------------------------------------------------------------------------

const STANDARD: Record<string, FontNames> = {
  Helvetica: FontNames.Helvetica, 'Helvetica-Bold': FontNames.HelveticaBold, 'Helvetica-Oblique': FontNames.HelveticaOblique,
  'Helvetica-BoldOblique': FontNames.HelveticaBoldOblique, 'Times-Roman': FontNames.TimesRoman, 'Times-Bold': FontNames.TimesRomanBold,
  'Times-Italic': FontNames.TimesRomanItalic, 'Times-BoldItalic': FontNames.TimesRomanBoldItalic, Courier: FontNames.Courier,
  'Courier-Bold': FontNames.CourierBold, 'Courier-Oblique': FontNames.CourierOblique, 'Courier-BoldOblique': FontNames.CourierBoldOblique,
  Symbol: FontNames.Symbol, ZapfDingbats: FontNames.ZapfDingbats,
  // Common aliases.
  Arial: FontNames.Helvetica, 'Arial,Bold': FontNames.HelveticaBold, ArialMT: FontNames.Helvetica, TimesNewRoman: FontNames.TimesRoman,
  'TimesNewRomanPSMT': FontNames.TimesRoman, CourierNew: FontNames.Courier,
};
const afmCache = new Map<string, Font>();
const afm = (n: FontNames) => {
  let f = afmCache.get(n);
  if (!f) afmCache.set(n, (f = Font.load(n)));
  return f;
};

export function loadFont(fontDict: PDFDict): FontInfo {
  const ctx = fontDict.context;
  const subtype = nameOf(fontDict.get(PDFName.of('Subtype'))) ?? 'Type1';
  const problems: string[] = [];
  const rawName = nameOf(fontDict.get(PDFName.of('BaseFont'))) ?? (subtype === 'Type3' ? 'Type3' : 'Unknown');
  const name = rawName.replace(/^[A-Z]{6}\+/, '');

  const composite = subtype === 'Type0';
  const desc0 = composite ? (lookup(fontDict.get(PDFName.of('DescendantFonts')), ctx) as PDFArray | undefined) : undefined;
  const cidFont = desc0 ? (lookup(desc0.get(0), ctx) as PDFDict | undefined) : undefined;
  const descriptor = lookup((cidFont ?? fontDict).get(PDFName.of('FontDescriptor')), ctx) as PDFDict | undefined;
  const flags = numOf(descriptor?.get(PDFName.of('Flags'))) ?? 0;
  const embedded = !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.has(PDFName.of(k)));
  const lname = name.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(lname) || (numOf(descriptor?.get(PDFName.of('FontWeight'))) ?? 400) >= 600 || !!(flags & (1 << 18));
  const italic = /italic|oblique/.test(lname) || !!(flags & 64);
  const mono = /mono|courier|consol|cousine|code/.test(lname) || !!(flags & 1);
  const serif = !mono && (/times|serif|georgia|garamond|tinos|roman|cambria|book|minion|palatino/.test(lname) ? !/sans/.test(lname) : !!(flags & 2));

  let ascent = (numOf(descriptor?.get(PDFName.of('Ascent'))) ?? 0) / 1000;
  let descent = (numOf(descriptor?.get(PDFName.of('Descent'))) ?? 0) / 1000;

  // Unicode: ToUnicode first.
  const tu = streamBytes(lookup(fontDict.get(PDFName.of('ToUnicode')), ctx));
  const toUni = tu ? parseCMap(latin1(tu)) : null;

  if (composite) {
    const encObj = lookup(fontDict.get(PDFName.of('Encoding')), ctx);
    const encName = nameOf(encObj);
    let codeMap: CMap | null = null;
    if (encObj instanceof PDFStream) codeMap = parseCMap(latin1(streamBytes(encObj) ?? new Uint8Array()));
    else if (encName !== 'Identity-H' && encName !== 'Identity-V') problems.push(`CMap ${encName ?? '?'} is not embedded: widths and text may be approximate`);
    const vertical = encName === 'Identity-V' || (encName ?? '').endsWith('-V');
    const dw = numOf(cidFont?.get(PDFName.of('DW'))) ?? 1000;
    const widths = new Map<number, number>();
    const w = lookup(cidFont?.get(PDFName.of('W')), ctx);
    if (w instanceof PDFArray) {
      const a = w.asArray().map((x) => lookup(x, ctx));
      for (let k = 0; k < a.length; ) {
        const first = numOf(a[k]);
        const next = a[k + 1];
        if (first === undefined) break;
        if (next instanceof PDFArray) {
          next.asArray().forEach((x, j) => widths.set(first + j, numOf(lookup(x, ctx)) ?? dw));
          k += 2;
        } else {
          const last = numOf(next) ?? first;
          const wv = numOf(a[k + 2]) ?? dw;
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, wv);
          k += 3;
        }
      }
    }
    const cidOf = (code: number) => {
      if (!codeMap) return code;
      const direct = codeMap.cids.get(code);
      if (direct !== undefined) return direct;
      const r = codeMap.cidRanges.find((x) => code >= x.lo && code <= x.hi);
      return r ? r.cid + code - r.lo : 0;
    };
    if (!toUni) problems.push('no ToUnicode map: the text of this font cannot be read');
    if (!ascent) ascent = 0.88;
    if (!descent) descent = -0.22;
    return {
      name, subtype: `Type0/${nameOf(cidFont?.get(PDFName.of('Subtype'))) ?? '?'}`, embedded, vertical, bold, italic, serif, mono, ascent, descent, scale: 0.001, problems,
      codes: (b) => (codeMap?.space.length ? splitBySpace(b, codeMap.space, 2) : splitBySpace(b, [{ len: 2, lo: 0, hi: 0xffff }], 2)),
      width: (code) => widths.get(cidOf(code)) ?? dw,
      unicode: (code) => toUni?.map.get(code) ?? '',
    };
  }

  // Simple fonts.
  const std = STANDARD[rawName] ?? STANDARD[name];
  const symbolic = std === FontNames.Symbol ? 'Symbol' : std === FontNames.ZapfDingbats ? 'ZapfDingbats' : null;
  const { names, unis } = simpleEncoding(fontDict, ctx, symbolic);
  const first = numOf(fontDict.get(PDFName.of('FirstChar'))) ?? 0;
  const wArr = lookup(fontDict.get(PDFName.of('Widths')), ctx);
  const widths = wArr instanceof PDFArray ? wArr.asArray().map((x) => numOf(lookup(x, ctx)) ?? 0) : null;
  const missing = numOf(descriptor?.get(PDFName.of('MissingWidth'))) ?? 0;
  let scale = 0.001;
  if (subtype === 'Type3') {
    const fm = lookup(fontDict.get(PDFName.of('FontMatrix')), ctx);
    const m = fm instanceof PDFArray ? fm.asArray().map((x) => numOf(lookup(x, ctx)) ?? 0) : [0.001];
    scale = m[0] || 0.001;
    const bb = lookup(fontDict.get(PDFName.of('FontBBox')), ctx);
    const box = bb instanceof PDFArray ? bb.asArray().map((x) => numOf(lookup(x, ctx)) ?? 0) : [0, 0, 0, 0];
    const k = Math.abs(m[3] ?? scale);
    if (box[3] !== box[1]) {
      ascent = box[3] * k;
      descent = Math.min(0, box[1] * k);
    }
  }
  if (!widths && !std) problems.push('no widths: glyph positions are approximate');
  const stdFont = std ? afm(std) : null;
  if (!ascent && stdFont) {
    ascent = (stdFont.Ascender ?? 718) / 1000;
    descent = (stdFont.Descender ?? -207) / 1000;
  }
  if (!ascent) ascent = 0.88;
  if (!descent) descent = -0.22;
  if (!toUni && subtype === 'Type3' && names.size === 0) problems.push('no ToUnicode map: the text of this font cannot be read');
  return {
    name, subtype, embedded, vertical: false, bold, italic, serif, mono, ascent, descent, scale, problems,
    codes: (b) => Array.from(b, (code) => ({ code, len: 1 })),
    width: (code) => {
      if (widths && code >= first && code < first + widths.length) return widths[code - first];
      if (stdFont) {
        const n = names.get(code);
        const w = n ? stdFont.getWidthOfGlyph(n) : undefined;
        if (typeof w === 'number') return w;
      }
      return missing || (widths ? 0 : 500);
    },
    unicode: (code) => {
      const fromMap = toUni?.map.get(code);
      if (fromMap !== undefined) return fromMap;
      const u = unis.get(code);
      if (u !== undefined) return u;
      const n = names.get(code);
      return n ? glyphNameToUnicode(n) : '';
    },
  };
}

function latin1(b: Uint8Array) {
  let s = '';
  for (let k = 0; k < b.length; k += 8192) s += String.fromCharCode(...b.subarray(k, k + 8192));
  return s;
}

/** A readable name for a font resource (for the panel). */
export function fontLabel(f: FontInfo) {
  return f.name.replace(/[-,](Bold|Italic|Regular|Oblique|BoldItalic|BoldOblique|Roman|MT|PSMT)+$/i, '') || f.name;
}

