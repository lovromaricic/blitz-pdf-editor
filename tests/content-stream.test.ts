import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { latin1, tokenize, writeOperand, ContentSyntaxError, isName, isStr } from '../src/lib/pdf/content/lexer';
import { parseCMap, glyphNameToUnicode } from '../src/lib/pdf/content/fonts';
import { interpretPage, pageContentBytes } from '../src/lib/pdf/content/interpret';
import { groupBlocks } from '../src/lib/pdf/content/blocks';
import { rewriteStream, textRemoval } from '../src/lib/pdf/content/rewrite';

const enc = (s: string) => new TextEncoder().encode(s);

describe('content stream tokenizer', () => {
  it('reads operands of every kind and keeps each operation’s exact byte range', () => {
    const src = '% comment\nq 1 0 0 1 72 -.5 cm /F#201 12 Tf (a\\(b\\)c\\101) Tj <48 65 6C> Tj [(x) -250 <79>] TJ /P <</MCID 3 /ActualText (z)>> BDC EMC Q';
    const ops = tokenize(enc(src));
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'Tf', 'Tj', 'Tj', 'TJ', 'BDC', 'EMC', 'Q']);
    expect(ops[1].operands).toEqual([1, 0, 0, 1, 72, -0.5]);
    expect(isName(ops[2].operands[0]) && ops[2].operands[0].name).toBe('F 1');
    expect(latin1((ops[3].operands[0] as { bytes: Uint8Array }).bytes)).toBe('a(b)cA');
    expect(latin1((ops[4].operands[0] as { bytes: Uint8Array }).bytes)).toBe('Hel');
    for (const o of ops) expect(src.slice(o.start, o.end).endsWith(o.op)).toBe(true);
    expect(src.slice(ops[2].start, ops[2].end)).toBe('/F#201 12 Tf');
  });

  it('finds the end of an inline image even when its data contains "EI"', () => {
    const data = 'xx EI yy\u0000\u0001';
    const src = `q 10 0 0 10 0 0 cm BI /W 2 /H 2 /BPC 8 /CS /G ID ${data}\nEI Q`;
    const ops = tokenize(enc(src));
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'BI', 'Q']);
    expect(ops[2].inline!.dict.get('W')).toBe(2);
  });

  it('refuses malformed content instead of guessing', () => {
    expect(() => tokenize(enc('BT (unterminated Tj ET'))).toThrow(ContentSyntaxError);
    expect(() => tokenize(enc('1 2'))).toThrow(ContentSyntaxError);
  });

  it('writes operands back', () => {
    expect(writeOperand([{ name: 'A B' }, 1.5, { bytes: new Uint8Array([1, 255]), hex: true }])).toBe('[/A#20B 1.5 <01ff>]');
  });
});

describe('fonts', () => {
  it('reads ToUnicode maps: single codes, ranges and arrays', () => {
    const m = parseCMap('begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0020> <0010> <0161> endbfchar 1 beginbfrange <0020> <0022> <0041> endbfrange 1 beginbfrange <0030> <0031> [<0110> <0111>] endbfrange');
    expect([3, 16, 0x20, 0x22, 0x30, 0x31].map((c) => m.map.get(c))).toEqual([' ', 'š', 'A', 'C', 'Đ', 'đ']);
  });
  it('knows Croatian glyph names', () => {
    expect(['Dcroat', 'scaron', 'ccaron', 'cacute', 'zcaron', 'uni0111', 'u0107'].map(glyphNameToUnicode).join('')).toBe('Đščćžđć');
  });
});

describe('removing text keeps everything after it in place', () => {
  it('a removed Tj becomes a move of the same length', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 200]);
    page.drawText('', { font });
    // pdf-lib writes embedded fonts on flush.
    await doc.flush();
    const key = [...(page.node.Resources()!.lookup(PDFName.of('Font')) as never as { keys(): PDFName[] }).keys()][0].asString();
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(`BT ${key} 12 Tf 2 Tc 10 100 Td (Hello) Tj [( Wo) -120 (rld)] TJ (!) Tj ET`)));
    const before = interpretPage(page);
    const ops = before.streams.get('')!;
    const second = before.text[1];
    const edited = rewriteStream(pageContentBytes(page), ops, new Map([[second.at.index, textRemoval(ops[second.at.index], second)]]));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(edited)));
    const after = interpretPage(page);
    expect(after.text.map((r) => r.glyphs.map((g) => g.text).join(''))).toEqual(['Hello', '', '!']);
    const bang = (c: typeof before) => c.text[2].glyphs[0].quad[0];
    expect(bang(after)[0]).toBeCloseTo(bang(before)[0], 6);
    expect(bang(after)[1]).toBeCloseTo(bang(before)[1], 6);
    expect(new TextDecoder().decode(edited)).not.toContain('rld');
  });
});

describe('block detection on the fixtures', () => {
  const manifest = JSON.parse(readFileSync('test-fixtures/content/manifest.json', 'utf8'));
  for (const [file, spec] of Object.entries<{ blocks?: number[]; blocksEach?: number; images?: number[]; order?: string[] }>(manifest.files)) {
    it(file, async () => {
      const bytes = readFileSync(`test-fixtures/content/${file}`);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false, password: '' }).catch(() => PDFDocument.load(bytes, { updateMetadata: false }));
      const pages = doc.getPages().map((p) => interpretPage(p));
      const blocks = pages.map(groupBlocks);
      expect(blocks.map((b) => b.length)).toEqual(spec.blocks ?? pages.map(() => spec.blocksEach));
      if (spec.images?.length === pages.length) expect(pages.map((p) => p.images.length)).toEqual(spec.images);
      if (spec.order) expect(blocks[0].map((b) => spec.order!.findIndex((w) => b.text.startsWith(w)))).toEqual(spec.order.map((_, i) => i));
      expect(pages.flatMap((p) => p.problems)).toEqual([]);
    }, 30000);
  }
});

void isStr;
