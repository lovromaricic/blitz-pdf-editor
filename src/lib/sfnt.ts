// Just enough of the OpenType / TrueType file format to use fonts from the
// user's computer: the embedding permission (OS/2 fsType), vertical metrics,
// names, and taking one font out of a collection (.ttc / .otc). No DOM.

interface TableRecord {
  tag: string;
  offset: number;
  length: number;
  checksum: number;
}

const tagAt = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

function tables(v: DataView, start: number): Map<string, TableRecord> {
  const n = v.getUint16(start + 4);
  const out = new Map<string, TableRecord>();
  for (let i = 0; i < n; i++) {
    const r = start + 12 + i * 16;
    out.set(tagAt(v, r), { tag: tagAt(v, r), checksum: v.getUint32(r + 4), offset: v.getUint32(r + 8), length: v.getUint32(r + 12) });
  }
  return out;
}

export function isCollection(bytes: Uint8Array) {
  return bytes.length >= 12 && tagAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0) === 'ttcf';
}

/** Start offset of each font in a collection (just [0] for a single font). */
function fontStarts(v: DataView): number[] {
  if (tagAt(v, 0) !== 'ttcf') return [0];
  const n = v.getUint32(8);
  return Array.from({ length: n }, (_, i) => v.getUint32(12 + i * 4));
}

function readName(v: DataView, t: Map<string, TableRecord>, nameId: number): string | null {
  const name = t.get('name');
  if (!name) return null;
  const base = name.offset;
  const count = v.getUint16(base + 2);
  const strings = base + v.getUint16(base + 4);
  let fallback: string | null = null;
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const [platform, , , id, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => v.getUint16(r + k));
    if (id !== nameId) continue;
    const at = strings + offset;
    if (platform === 3 || platform === 0) {
      let s = '';
      for (let k = 0; k < length; k += 2) s += String.fromCharCode(v.getUint16(at + k));
      return s;
    }
    if (platform === 1 && fallback === null) {
      fallback = Array.from({ length }, (_, k) => String.fromCharCode(v.getUint8(at + k))).join('');
    }
  }
  return fallback;
}

export interface FontFacts {
  postscriptName: string | null;
  /** OS/2 fsType (0 when the table is missing, which means installable). */
  fsType: number;
  unitsPerEm: number;
  /** hhea ascent and descent per em (descent positive). */
  ascent: number;
  descent: number;
}

/** Facts about a single font file (not a collection). */
export function fontFacts(bytes: Uint8Array): FontFacts {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tables(v, 0);
  const os2 = t.get('OS/2');
  const head = t.get('head');
  const hhea = t.get('hhea');
  const unitsPerEm = head ? v.getUint16(head.offset + 18) : 1000;
  return {
    postscriptName: readName(v, t, 6),
    fsType: os2 ? v.getUint16(os2.offset + 8) : 0,
    unitsPerEm,
    ascent: hhea ? v.getInt16(hhea.offset + 4) / unitsPerEm : 0.9,
    descent: hhea ? -v.getInt16(hhea.offset + 6) / unitsPerEm : 0.25,
  };
}

export type EmbeddingVerdict = { ok: true } | { ok: false; reason: 'restricted' | 'bitmap-only' | 'no-subsetting' };

/**
 * Whether the font's maker allows embedding it in documents the way we do
 * (as a subset of outlines). fsType bits: 0x0002 restricted license, 0x0004
 * preview & print, 0x0008 editable (the least restrictive set bit wins),
 * 0x0100 no subsetting, 0x0200 bitmap embedding only.
 */
export function embeddingAllowed(fsType: number): EmbeddingVerdict {
  const restricted = (fsType & 0x0002) !== 0 && (fsType & 0x000c) === 0;
  if (restricted) return { ok: false, reason: 'restricted' };
  if (fsType & 0x0200) return { ok: false, reason: 'bitmap-only' };
  if (fsType & 0x0100) return { ok: false, reason: 'no-subsetting' };
  return { ok: true };
}

/**
 * Take one font out of a collection as a standalone font file, picked by its
 * PostScript name (or the first font). A single font file comes back as is.
 */
export function extractFont(bytes: Uint8Array, postscriptName?: string): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tagAt(v, 0) !== 'ttcf') return bytes;
  const starts = fontStarts(v);
  const start = starts.find((s) => readName(v, tables(v, s), 6) === postscriptName) ?? starts[0];
  const list = [...tables(v, start).values()];

  const headerSize = 12 + list.length * 16;
  const pad = (n: number) => (n + 3) & ~3;
  const size = list.reduce((n, t) => n + pad(t.length), headerSize);
  const out = new Uint8Array(size);
  const w = new DataView(out.buffer);
  // Offset table: same sfnt version and search fields as the original font.
  out.set(bytes.subarray(start, start + 12), 0);
  let offset = headerSize;
  list.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) w.setUint8(r + k, t.tag.charCodeAt(k));
    w.setUint32(r + 4, t.checksum);
    w.setUint32(r + 8, offset);
    w.setUint32(r + 12, t.length);
    out.set(bytes.subarray(t.offset, t.offset + t.length), offset);
    offset += pad(t.length);
  });
  return out;
}
