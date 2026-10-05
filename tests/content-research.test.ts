// Phase 0 research harness for editing a PDF's original content. Not part of
// the normal run: CONTENT_RESEARCH=1 npx vitest run tests/content-research.test.ts
// For every fixture: block detection (ours, and PDF.js text items grouped the
// same way) against the manifest, our text against PDF.js's, deleting a block
// and an image, and checking the saved file (PDF.js extraction, decoded
// streams, leftovers, the rest of the page unchanged when rendered by Poppler).
import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { interpretPage, pageContentBytes, type PageContent, type TextRun } from '../src/lib/pdf/content/interpret';
import { groupBlocks, type TextBlock } from '../src/lib/pdf/content/blocks';
import { rewriteStream, shownBytes, textRemoval } from '../src/lib/pdf/content/rewrite';
import { collectGarbage } from '../src/lib/pdf/assemble';

const DIR = 'test-fixtures/content';
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const RUN = !!process.env.CONTENT_RESEARCH;

async function load(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return await PDFDocument.load(bytes, { updateMetadata: false, password: '' });
  }
}

async function pdfjsPages(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), isEvalSupported: false, password: '', standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' } as never);
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const tc = await p.getTextContent();
    pages.push(tc.items.filter((x) => 'str' in x) as unknown as { str: string; transform: number[]; width: number; height: number }[]);
  }
  await task.destroy();
  return pages;
}

/** PDF.js text items as pseudo runs, grouped by the same rules (the "PDF.js only" approach). */
function pdfjsBlocks(items: { str: string; transform: number[]; width: number; height: number }[]) {
  const text = items
    .filter((it) => it.str.trim())
    .map((it): TextRun => {
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || it.height;
      const ux = a / (Math.hypot(a, b) || 1);
      const uy = b / (Math.hypot(a, b) || 1);
      const vx = -uy;
      const vy = ux;
      const p = (x: number, y: number): [number, number] => [e + ux * x + vx * y, f + uy * x + vy * y];
      return {
        kind: 'text', at: { forms: [], index: 0 }, op: 'Tj', font: { descent: -0.2, ascent: 0.8, name: '?' } as never, fontKey: '', size,
        angle: (Math.atan2(b, a) * 180) / Math.PI, color: null, invisible: false, advance: 0, tfs: 1, th: 1, marked: [],
        glyphs: [{ code: 0, text: it.str, quad: [p(0, -0.2 * size), p(it.width, -0.2 * size), p(it.width, 0.8 * size), p(0, 0.8 * size)] }],
      };
    });
  return groupBlocks({ text } as PageContent);
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, '');
/** Share of characters in common (multiset), 0..1. */
function similarity(a: string, b: string) {
  const ca = new Map<string, number>();
  for (const ch of norm(a)) ca.set(ch, (ca.get(ch) ?? 0) + 1);
  let common = 0;
  let nb = 0;
  for (const ch of norm(b)) {
    nb++;
    const n = ca.get(ch) ?? 0;
    if (n) {
      common++;
      ca.set(ch, n - 1);
    }
  }
  const na = norm(a).length;
  return na + nb === 0 ? 1 : (2 * common) / (na + nb);
}

function allDecodedStreams(doc: PDFDocument) {
  const out: Uint8Array[] = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (o instanceof PDFRawStream) {
      try {
        out.push(decodePDFRawStream(o).decode());
      } catch {
        out.push(o.getContents());
      }
    } else if (o instanceof PDFStream) out.push((o as PDFStream & { getContents(): Uint8Array }).getContents());
  }
  return out;
}
const contains = (hay: Uint8Array, needle: Uint8Array) => {
  if (!needle.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
};

/** Gray render of page 1 by Poppler (72 dpi). */
function render(bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-'));
  writeFileSync(join(dir, 'in.pdf'), bytes);
  execFileSync('pdftoppm', ['-r', '72', '-gray', '-f', '1', '-l', '1', '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')]);
  const pgm = readFileSync(join(dir, 'out.pgm'));
  const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(pgm.subarray(0, 40).toString('latin1'))!;
  return { w: Number(header[1]), h: Number(header[2]), data: pgm.subarray(header[0].length) };
}

interface Row {
  file: string;
  ourBlocks: number[];
  pdfjsBlocks: number[];
  expected: number[];
  images: number[];
  expectedImages: number[];
  textSimilarity: number;
  pdfjsItems: number;
  showOps: number;
  problems: string[];
  ms: number;
  delete?: Record<string, unknown>;
  leftovers?: Record<string, unknown>;
}

describe.runIf(RUN)('content editing research', () => {
  const rows: Row[] = [];

  for (const [file, spec] of Object.entries<any>(manifest.files)) {
    it(file, async () => {
      const bytes = new Uint8Array(readFileSync(join(DIR, file)));
      const doc = await load(bytes);
      const t0 = performance.now();
      const contents: PageContent[] = [];
      const blocks: TextBlock[][] = [];
      for (const page of doc.getPages()) {
        const c = interpretPage(page);
        contents.push(c);
        blocks.push(groupBlocks(c));
      }
      const ms = performance.now() - t0;
      const pj = await pdfjsPages(bytes);
      const ours = blocks.map((bs) => bs.map((b) => b.text).join(' ')).join(' ');
      const theirs = pj.map((items) => items.map((i) => i.str).join('')).join(' ');
      const expected = spec.blocks ?? Array(doc.getPageCount()).fill(spec.blocksEach);
      const row: Row = {
        file,
        ourBlocks: blocks.map((b) => b.length),
        pdfjsBlocks: pj.map((items) => pdfjsBlocks(items).length),
        expected,
        images: contents.map((c) => c.images.length),
        expectedImages: spec.images ?? [],
        textSimilarity: Math.round(similarity(ours, theirs) * 1000) / 1000,
        pdfjsItems: pj.reduce((n, p) => n + p.length, 0),
        showOps: contents.reduce((n, c) => n + c.text.length, 0),
        problems: [...new Set(contents.flatMap((c) => [...c.problems, ...c.text.flatMap((t) => t.font.problems)]))],
        ms: Math.round(ms),
      };
      if (spec.order) row.delete = { order: blocks[0].map((b) => b.text.slice(0, 16)) };

      // Delete the largest block and the first image on page 1, save (full rewrite), verify.
      const page = doc.getPage(0);
      const c = contents[0];
      const target = spec.deleteTarget
        ? blocks[0].find((b) => b.text.includes(spec.deleteTarget))
        : [...blocks[0]].sort((a, b) => b.lines.length - a.lines.length || a.order - b.order)[0];
      const image = c.images.find((im) => !im.at.forms.length);
      if (target || image) {
        const ops = c.streams.get('')!;
        const edits = new Map<number, string>();
        const removed: Uint8Array[] = [];
        let inForms = 0;
        for (const i of target?.runs ?? []) {
          const run = c.text[i];
          if (run.at.forms.length) {
            inForms++;
            continue;
          }
          edits.set(run.at.index, textRemoval(ops[run.at.index], run));
          removed.push(...shownBytes(ops[run.at.index]).filter((b) => b.length >= 3));
        }
        let imageBytes = 0;
        if (image) {
          edits.set(image.at.index, '');
          // Drop the XObject from the page's resources when nothing else on the page draws it.
          const stillUsed = ops.some((o, k) => k !== image.at.index && o.op === 'Do' && (o.operands[0] as { name?: string })?.name === image.name);
          const res = page.node.Resources();
          const xo = res?.lookup(PDFName.of('XObject'));
          if (!stillUsed && xo instanceof PDFDict && image.name) {
            const r = xo.get(PDFName.of(image.name));
            const obj = r instanceof PDFRef ? doc.context.lookup(r) : r;
            imageBytes = obj instanceof PDFRawStream ? obj.getContents().length : 0;
            xo.delete(PDFName.of(image.name));
          }
        }
        const before = render(bytes);
        const t1 = performance.now();
        const newContent = rewriteStream(pageContentBytes(page), ops, edits);
        page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(newContent)));
        page.node.delete(PDFName.of('Thumb'));
        collectGarbage(doc);
        let out: Uint8Array;
        try {
          out = await doc.save();
        } catch (e) {
          row.delete = { error: String(e) };
          rows.push(row);
          return;
        }
        const saveMs = performance.now() - t1;
        const after = render(out);
        // Outside the deleted block and image (with a margin), the page must be unchanged.
        const sx = before.w / page.getWidth();
        const boxes = [target?.quad, image?.quad].filter(Boolean).map((q) => {
          const xs = q!.map((p) => p[0] * sx);
          const ys = q!.map((p) => (page.getHeight() - p[1]) * sx);
          return [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
        });
        const rot = page.getRotation().angle % 360;
        let changedOutside = 0;
        let changedInside = 0;
        if (before.w === after.w && rot === 0) {
          for (let y = 0; y < before.h; y++)
            for (let x = 0; x < before.w; x++) {
              const k = y * before.w + x;
              if (Math.abs(before.data[k] - after.data[k]) <= 24) continue;
              if (boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) changedInside++;
              else changedOutside++;
            }
        }
        const reloaded = await load(out);
        const streams = allDecodedStreams(reloaded);
        const pjAfter = await pdfjsPages(out);
        const textAfter = pjAfter[0].map((i) => i.str).join(' ');
        const otherWords = new Set(blocks[0].filter((b) => b !== target).flatMap((b) => b.text.split(/\s+/)));
        const gone = (target?.text.split(/\s+/) ?? []).filter((w) => w.length > 3 && !otherWords.has(w));
        const stillThere = gone.filter((w) => textAfter.split(/\s+/).includes(w));
        const keptOk = blocks[0].filter((b) => b !== target).every((b) => textAfter.replace(/\s+/g, '').includes(b.text.split(/\s+/)[0]));
        const leftBytes = removed.filter((r) => streams.some((s) => contains(s, r))).length;
        const imagesAfter = [...reloaded.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFStream && o.dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image').length;
        const imagesBefore = [...(await load(bytes)).context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFStream && o.dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image').length;
        const raw = new TextDecoder('latin1').decode(out);
        const allText = streams.map((s) => new TextDecoder('latin1').decode(s)).join('\n') + raw;
        row.delete = {
          ...(row.delete ?? {}),
          block: target?.text.slice(0, 40),
          inForms,
          pdfjsStillFinds: stillThere,
          otherBlocksKept: keptOk,
          shownBytesLeftInStreams: leftBytes,
          imagesBefore,
          imagesAfter,
          imageBytesRemoved: imageBytes,
          sizeBefore: bytes.length,
          sizeAfter: out.length,
          changedOutsidePx: rot === 0 ? changedOutside : 'rotated page: not compared',
          changedInsidePx: changedInside,
          saveMs: Math.round(saveMs),
        };
        row.leftovers = {
          oldRevision: spec.oldRevisionText ? allText.includes(spec.oldRevisionText) : undefined,
          hiddenText: spec.hiddenText ? allText.includes(spec.hiddenText) : undefined,
          structTree: !!reloaded.catalog.get(PDFName.of('StructTreeRoot')),
          thumb: [...reloaded.getPages()].some((p) => p.node.has(PDFName.of('Thumb'))),
          xmp: !!reloaded.catalog.get(PDFName.of('Metadata')),
          incrementalSections: (raw.match(/%%EOF/g) ?? []).length,
        };
      }
      rows.push(row);
    }, 120000);
  }

  it('report', () => {
    writeFileSync('docs/research/content-edit-results.json', JSON.stringify(rows, null, 2));
    for (const r of rows) {
      const ok = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      console.log(
        `${r.file.padEnd(28)} ours ${ok(r.ourBlocks, r.expected) ? 'OK ' : 'XX '}${JSON.stringify(r.ourBlocks).slice(0, 30).padEnd(14)} pdfjs ${ok(r.pdfjsBlocks, r.expected) ? 'OK ' : 'XX '}${JSON.stringify(r.pdfjsBlocks).slice(0, 30).padEnd(14)} exp ${JSON.stringify(r.expected).slice(0, 20).padEnd(10)} img ${JSON.stringify(r.images).slice(0, 12)} text ${r.textSimilarity} items/ops ${r.pdfjsItems}/${r.showOps} ${r.ms}ms ${r.problems.join('; ')}`,
      );
      if (r.delete) console.log('   delete', JSON.stringify(r.delete));
      if (r.leftovers) console.log('   leftovers', JSON.stringify(r.leftovers));
    }
  });
});
