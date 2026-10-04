import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import fontkit from '@cantoo/fontkit';
import { PDFDocument } from '@cantoo/pdf-lib';
import { embeddingAllowed, extractFont, fontFacts, isCollection } from '../src/lib/sfnt';

const ROBOTO = new Uint8Array(readFileSync('node_modules/@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf'));
const LORA = new Uint8Array(readFileSync('node_modules/@expo-google-fonts/lora/700Bold/Lora_700Bold.ttf'));

/** A .ttc holding the given fonts (table offsets rewritten, as collections store them). */
function collection(fonts: Uint8Array[]) {
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(12 + fonts.length * 4);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, 0x74746366); // 'ttcf'
  hv.setUint32(4, 0x00010000);
  hv.setUint32(8, fonts.length);
  let at = header.length;
  const dirs = fonts.map((f) => {
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const n = v.getUint16(4);
    const dir = new Uint8Array(f.subarray(0, 12 + n * 16));
    const start = at;
    at += dir.length;
    return { f, v, n, dir, start };
  });
  dirs.forEach((d, i) => hv.setUint32(12 + i * 4, d.start));
  parts.push(header, ...dirs.map((d) => d.dir));
  for (const d of dirs) {
    const dv = new DataView(d.dir.buffer);
    for (let i = 0; i < d.n; i++) {
      const r = 12 + i * 16;
      const off = d.v.getUint32(r + 8);
      const len = d.v.getUint32(r + 12);
      dv.setUint32(r + 8, at);
      const data = new Uint8Array((len + 3) & ~3);
      data.set(d.f.subarray(off, off + len));
      parts.push(data);
      at += data.length;
    }
  }
  const out = new Uint8Array(at);
  let o = 0;
  for (const p of parts) out.set(p, (o += 0, o)), (o += p.length);
  return out;
}

describe('font files', () => {
  it('reads names, metrics and the embedding flag', () => {
    const f = fontFacts(ROBOTO);
    expect(f.postscriptName).toBe('Roboto-Regular');
    expect(f.unitsPerEm).toBeGreaterThan(0);
    expect(f.ascent).toBeCloseTo(0.928, 2);
    expect(f.descent).toBeCloseTo(0.244, 2);
    expect(embeddingAllowed(f.fsType).ok).toBe(true);
  });

  it('decides embedding from fsType', () => {
    expect(embeddingAllowed(0x0000)).toEqual({ ok: true }); // installable
    expect(embeddingAllowed(0x0004)).toEqual({ ok: true }); // preview & print
    expect(embeddingAllowed(0x0008)).toEqual({ ok: true }); // editable
    expect(embeddingAllowed(0x0002)).toEqual({ ok: false, reason: 'restricted' });
    expect(embeddingAllowed(0x0006)).toEqual({ ok: true }); // least restrictive bit wins
    expect(embeddingAllowed(0x0108)).toEqual({ ok: false, reason: 'no-subsetting' });
    expect(embeddingAllowed(0x0204)).toEqual({ ok: false, reason: 'bitmap-only' });
  });

  it('spots a restricted font', () => {
    const copy = ROBOTO.slice();
    const v = new DataView(copy.buffer);
    // Find the OS/2 table and set fsType to "restricted license".
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      if (String.fromCharCode(...copy.subarray(r, r + 4)) === 'OS/2') v.setUint16(v.getUint32(r + 8) + 8, 0x0002);
    }
    expect(embeddingAllowed(fontFacts(copy).fsType)).toEqual({ ok: false, reason: 'restricted' });
  });

  it('takes one font out of a collection, usable for embedding', async () => {
    const ttc = collection([ROBOTO, LORA]);
    expect(isCollection(ttc)).toBe(true);
    const lora = extractFont(ttc, 'Lora-Bold');
    expect(isCollection(lora)).toBe(false);
    expect(fontFacts(lora).postscriptName).toBe('Lora-Bold');
    expect(fontFacts(extractFont(ttc, 'Roboto-Regular')).postscriptName).toBe('Roboto-Regular');
    // fontkit reads it and pdf-lib embeds a subset with Croatian letters.
    const fk = fontkit.create(lora) as { hasGlyphForCodePoint(c: number): boolean };
    expect(fk.hasGlyphForCodePoint('đ'.codePointAt(0)!)).toBe(true);
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(lora, { subset: true });
    doc.addPage().drawText('Đurđica čita', { font, size: 12 });
    expect((await doc.save()).length).toBeGreaterThan(0);
  });

  it('returns a single font file unchanged', () => {
    expect(extractFont(ROBOTO, 'Anything')).toBe(ROBOTO);
  });
});
