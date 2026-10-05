// Deleting original content for real: on the fixtures, the saved file no longer
// has the deleted text (PDF.js extraction, decoded streams), images, hidden copies
// (/ActualText, structure /Alt, XMP) or old revisions; everything else stays.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, PDFStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyzePage, deleteItems, BLOCKED, ContentEditError, NO_CONVERT } from '../src/lib/pdf/content/edit';
import { collectGarbage } from '../src/lib/pdf/gc';

const fixture = (f: string) => new Uint8Array(readFileSync(`test-fixtures/content/${f}`));
const load = (b: Uint8Array) => PDFDocument.load(b, { updateMetadata: false, password: '' });

async function text(bytes: Uint8Array, page = 1) {
  const task = getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' } as never);
  const pdf = await task.promise;
  const t = (await (await pdf.getPage(page)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
  await task.destroy();
  return t;
}

/**
 * Everything in the file as Latin-1 text: the raw bytes plus every stream found
 * in them inflated, whether or not the current revision still refers to it.
 */
async function everything(bytes: Uint8Array) {
  const raw = Buffer.from(bytes).toString('latin1');
  const parts = [raw];
  for (const m of raw.matchAll(/(?<!end)stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      parts.push(inflateSync(Buffer.from(bytes.subarray(start, end))).toString('latin1'));
    } catch {
      // Not deflated (or not a stream): the raw text covers it.
    }
  }
  const doc = await load(bytes);
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (o instanceof PDFRawStream) parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(o).decode()));
  }
  // Text in content is often written as hex strings: decode those too.
  const all = parts.join('\n');
  const hex = [...all.matchAll(/<([0-9A-Fa-f\s]{4,})>/g)].map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
  return all + '\n' + hex.join('\n');
}

async function deleteAndSave(bytes: Uint8Array, pick: (items: ReturnType<typeof analyzePage>['items']) => string[], page = 0) {
  const doc = await load(bytes);
  const before = analyzePage(doc, page);
  const ids = pick(before.items);
  const result = deleteItems(doc, page, ids);
  collectGarbage(doc);
  const out = await doc.save();
  return { out, before, ids, result };
}

const words = (s: string) => s.split(/\s+/).filter((w) => w.length > 3);

describe('deleting text blocks', () => {
  for (const f of ['chrome-article.pdf', 'chrome-croatian-subset.pdf', 'chrome-columns.pdf', 'chrome-table-list.pdf', 'bank-form-hr.pdf', 'rotated-pages.pdf', 'rotated-text.pdf', 'type3-font.pdf', 'form-fields.pdf', 'signed.pdf', 'cid-subset-croatian.pdf']) {
    it(`${f}: the block is gone from the text and the streams, the rest stays`, async () => {
      const bytes = fixture(f);
      const { out, before, ids } = await deleteAndSave(bytes, (items) => {
        const texts = items.filter((i) => i.kind === 'text');
        return [[...texts].sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0) || a.order - b.order)[0].id];
      });
      const target = before.items.find((i) => i.id === ids[0])!;
      const rest = before.items.filter((i) => i.kind === 'text' && i.id !== target.id);
      const after = await text(out);
      // Letters only (superscripts and punctuation are split differently by PDF.js).
      const count = (t: string, w: string) => t.split(/[^\p{L}]+/u).filter((x) => x === w).length;
      // Each word of the block is gone as many times as the block had it (filler sentences repeat).
      const beforeText = await text(bytes);
      const own = target.text!.split(/[^\p{L}]+/u).filter((w) => w.length > 3);
      expect(own.length).toBeGreaterThan(0);
      for (const w of new Set(own)) expect(count(after, w)).toBe(Math.max(0, count(beforeText, w) - count(target.text!, w)));
      for (const r of rest) expect(after.replace(/\s+/g, '')).toContain(r.text!.split(/\s+/)[0]);
      // Re-analyzing the saved file: one block fewer.
      const again = analyzePage(await load(out), 0);
      expect(again.items.filter((i) => i.kind === 'text')).toHaveLength(rest.length);
      // The file is written whole: one revision.
      expect(new TextDecoder('latin1').decode(out).match(/%%EOF/g)).toHaveLength(1);
    }, 30000);
  }

  it('several blocks at once; Croatian letters elsewhere stay intact', async () => {
    const { out, before } = await deleteAndSave(fixture('chrome-croatian-subset.pdf'), (items) => items.filter((i) => i.kind === 'text').slice(0, 2).map((i) => i.id));
    const after = await text(out);
    expect(after).not.toContain('Obavijest');
    expect(after).not.toContain('Poštovani');
    expect(after).toContain('Đurđica Šimić');
    expect(after).toContain('ČĆŽŠĐ čćžšđ');
    expect(before.items.filter((i) => i.kind === 'text')).toHaveLength(5);
  });
});

describe('deleting images', () => {
  const images = async (b: Uint8Array) => [...(await load(b)).context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFStream && o.dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image').length;

  it('the image data leaves the file; the text stays', async () => {
    const bytes = fixture('chrome-article.pdf');
    const { out } = await deleteAndSave(bytes, (items) => items.filter((i) => i.kind === 'image').map((i) => i.id));
    expect(await images(bytes)).toBe(1);
    expect(await images(out)).toBe(0);
    expect(out.length).toBeLessThan(bytes.length - 20000);
    expect(await text(out)).toContain('Library Wing Proposal');
  });

  it('a scan is recognised, and deleting it leaves an empty page', async () => {
    const bytes = fixture('scanned.pdf');
    const doc = await load(bytes);
    const a = analyzePage(doc, 0);
    expect(a.scan).toBe(true);
    expect(a.items[0].coversPage).toBe(true);
    const { out } = await deleteAndSave(bytes, (items) => items.map((i) => i.id));
    expect(await images(out)).toBe(0);
    expect(out.length).toBeLessThan(2000);
  });
});

describe('hidden copies go too', () => {
  it('/ActualText, the structure tree’s /Alt and the XMP metadata of a deleted span', async () => {
    const bytes = fixture('tagged-actualtext.pdf');
    expect(await everything(bytes)).toContain('Confidential figure 4711');
    const { out, result } = await deleteAndSave(bytes, (items) => items.filter((i) => i.text?.includes('Shown words')).map((i) => i.id));
    expect(result.removedMetadata).toBe(true);
    const all = await everything(out);
    expect(all).not.toContain('Confidential figure 4711');
    expect(all).not.toContain('Shown words');
    // The other elements and their text are still there.
    expect(await text(out)).toContain('Visible heading');
    expect(all).toContain('StructTreeRoot');
  });

  it('an earlier revision of the file is not kept', async () => {
    const bytes = fixture('incremental-update.pdf');
    expect(await everything(bytes)).toContain('100 EUR');
    const { out } = await deleteAndSave(bytes, (items) => [items.find((i) => i.text === 'Quote')!.id]);
    expect(await everything(out)).not.toContain('100 EUR');
    expect(await text(out)).toContain('120 EUR');
  });
});

describe('content inside form XObjects', () => {
  async function withForm(drawTwice: boolean) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([300, 300]);
    const p2 = doc.addPage([300, 300]);
    p1.drawText('', { font });
    await doc.flush();
    const fname = [...(p1.node.Resources()!.lookup(PDFName.of('Font')) as never as { keys(): PDFName[] }).keys()][0];
    const ctx = doc.context;
    const fontRef = (p1.node.Resources()!.lookup(PDFName.of('Font')) as never as { get(n: PDFName): unknown }).get(fname);
    const form = ctx.register(ctx.flateStream(`BT ${fname.asString()} 12 Tf 10 10 Td (Shared header) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 40], Resources: ctx.obj({ Font: ctx.obj({ [fname.decodeText()]: fontRef as never }) }) }));
    for (const p of [p1, p2]) {
      p.node.setXObject(PDFName.of('Fm1'), form);
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`q 1 0 0 1 20 200 cm /Fm1 Do Q ${drawTwice ? 'q 1 0 0 1 20 100 cm /Fm1 Do Q' : ''} BT ${fname.asString()} 12 Tf 20 20 Td (Own words) Tj ET`)));
    }
    return new Uint8Array(await doc.save());
  }

  it('drawn once: deleted on this page only (other pages keep the shared original)', async () => {
    const { out } = await deleteAndSave(await withForm(false), (items) => items.filter((i) => i.text === 'Shared header').map((i) => i.id));
    expect(await text(out, 1)).not.toContain('Shared header');
    expect(await text(out, 1)).toContain('Own words');
    expect(await text(out, 2)).toContain('Shared header');
  });

  it('drawn twice on the page: refused, with a reason', async () => {
    const doc = await load(await withForm(true));
    const items = analyzePage(doc, 0).items.filter((i) => i.text === 'Shared header');
    expect(items).toHaveLength(2);
    expect(items[0].blocked).toBe(BLOCKED.repeated);
    expect(() => deleteItems(doc, 0, [items[0].id])).toThrow(ContentEditError);
  });
});

describe('converting text blocks into text boxes: what the analysis says', () => {
  const conv = async (f: string) => analyzePage(await load(fixture(f)), 0).items.filter((i) => i.kind === 'text');
  it('alignment, lines, spacing, font class and size', async () => {
    const items = await conv('chrome-aligned.pdf');
    const by = (start: string) => items.find((i) => i.text!.startsWith(start))!.convert!;
    expect(by('Members').align).toBe('justify');
    expect(by('Members').lines).toHaveLength(4);
    expect(by('Volunteers').align).toBe('center');
    expect(by('The committee').align).toBe('right');
    expect(by('Čitaonica').align).toBe('left');
    expect(by('Čitaonica').lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual([
      'Čitaonica će biti otvorena svakog radnog dana, a đaci mogu posuditi',
      'knjige uz iskaznicu. Šetnja vrtom je dopuštena.',
    ]);
    expect([by('A first').family, by('Questions').family, by('Members').family]).toEqual(['serif', 'mono', 'sans']);
    expect(by('Members').size).toBe(11);
    expect(by('Members').gap).toBeCloseTo(15, 1);
    expect(by('Members').matched).toBe(true);
  });
  it('bold words keep their runs', async () => {
    const p = (await conv('chrome-croatian-subset.pdf')).find((i) => i.text!.startsWith('Čišćenje'))!.convert!;
    const bold = p.lines.flatMap((l) => l.runs).filter((r) => r.bold).map((r) => r.text.trim());
    expect(bold).toEqual(['svakog ponedjeljka', 'prve subote u mjesecu']);
  });
  it('turned text and superscripts can only be deleted, with the reason', async () => {
    const turned = (await conv('rotated-text.pdf')).find((i) => i.text!.startsWith('This line is turned'))!;
    expect(turned.convert).toBeUndefined();
    expect(turned.noConvert).toBe(NO_CONVERT.turned);
    const sup = (await conv('chrome-table-list.pdf')).find((i) => i.text!.startsWith('A first estimate'))!;
    expect(sup.noConvert).toBe(NO_CONVERT.scripts);
    // Text on a turned page is upright in the PDF: that converts.
    expect((await conv('rotated-pages.pdf'))[1].convert?.lines).toHaveLength(3);
  });
  it('a Type3 font maps to a guess, reported as not matched', async () => {
    const t3 = (await conv('type3-font.pdf')).find((i) => i.text === 'HELLO TYPE THREE')!.convert!;
    expect(t3.matched).toBe(false);
  });
});
