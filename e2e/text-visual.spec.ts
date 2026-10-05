// The editor and the saved PDF (rendered by PDF.js) must agree for a text box
// with every option on: justified, bold, underline, strikethrough, background,
// line spacing 1.5 and 60% opacity, with Croatian letters. Positions within ~1px.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

test.use({ deviceScaleFactor: 1 });

/** App modules, imported by URL inside the page (served by the dev server). */
declare function load(path: string): Promise<any>;

async function openBlank(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { load: (p: string) => Promise<unknown> }).load = (p: string) => import(/* @vite-ignore */ p);
  });
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
}

/** The element's position once it has stopped moving (two equal readings 250 ms apart). */
async function settled(page: Page, selector: string) {
  let last = '';
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate((sel) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      const p = document.querySelector('.page[data-index="0"]')!.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), px: r.left - p.left, py: r.top - p.top };
    }, selector);
    const key = JSON.stringify(r);
    if (key === last) return r;
    last = key;
    await page.waitForTimeout(250);
  }
  return JSON.parse(last);
}

/** Ink (text and bars) masks and the background colour of two same-sized images. */
async function compare(page: Page, editorPng: Buffer, pdfPng: string) {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [ea, pb] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ea.width, pb.width);
      const h = Math.min(ea.height, pb.height);
      const lum = (d: ImageData, x: number, y: number) => {
        const i = (y * d.width + x) * 4;
        return 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      };
      const mask = (d: ImageData) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => lum(d, x, y) < 215));
      const ma = mask(ea);
      const mb = mask(pb);
      // Best shift between the two (rows and columns of ink), within ±4 px.
      const score = (dx: number, dy: number) => {
        let s = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ma[y][x] && mb[y + dy]?.[x + dx]) s++;
        return s;
      };
      let best = { dx: 0, dy: 0, s: -1 };
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const s = score(dx, dy);
        if (s > best.s) best = { dx, dy, s };
      }
      // Coverage, allowing 1 px for anti-aliasing: ink in one image near ink in the other.
      const near = (m: boolean[][], x: number, y: number) => {
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (m[y + j]?.[x + i]) return true;
        return false;
      };
      let inkA = 0, hitA = 0, inkB = 0, hitB = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (ma[y][x]) { inkA++; if (near(mb, x, y)) hitA++; }
        if (mb[y][x]) { inkB++; if (near(ma, x, y)) hitB++; }
      }
      // Background: the average colour of pixels that are clearly not ink in either.
      const avg = (d: ImageData) => {
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
          if (lum(ea, x, y) < 230 || lum(pb, x, y) < 230 || near(ma, x, y) || near(mb, x, y)) continue;
          const i = (y * d.width + x) * 4;
          sum[0] += d.data[i]; sum[1] += d.data[i + 1]; sum[2] += d.data[i + 2]; n++;
        }
        return sum.map((v) => v / Math.max(1, n));
      };
      return { shift: [best.dx, best.dy], cover: [hitA / inkA, hitB / inkB], ink: [inkA, inkB], bg: [avg(ea), avg(pb)] };
    },
    [`data:image/png;base64,${editorPng.toString('base64')}`, pdfPng],
  );
}

for (const [kind, zoom] of [['every option', 1], ['every option', 2], ['rich text, every format mixed', 1], ['rich text, every format mixed', 2]] as const) {
  test(`a text box with ${kind} looks the same in the saved PDF (zoom ${zoom * 100}%)`, async ({ page }) => {
    await openBlank(page);
    const box = await page.evaluate(async ({ zoom, kind }) => {
      const w = window as unknown as Record<string, any>;
      const { ensureTextFont } = await load('/src/lib/font-metrics-store.svelte.ts');
      const { layoutText } = await load('/src/lib/text-layout.ts');
      for (const f of ['roboto', 'lora', 'great-vibes', 'cousine']) await ensureTextFont(f);
      await document.fonts.ready;
      const text = 'Justified text, underlined and struck through: Čačić, Đurđa, šžć ĆŽŠ. It wraps over several lines so justification shows.\nShort last line.';
      const run = (t: string, o: object = {}) => ({ text: t, font: 'roboto', size: 14, color: [0.1, 0.2, 0.6], ...o });
      // Mixed fonts, sizes, bold, italic, underline, strikethrough and colors, across wrapped and justified lines.
      const paragraphs = [
        { runs: [run('Rich text '), run('bold ', { bold: true }), run('italic ', { italic: true, font: 'lora' }), run('BIG', { size: 24, color: [0.8, 0.1, 0.1] }), run(' underlined Čačić ', { underline: true }), run('struck ', { strike: true, color: [0, 0.5, 0.2] }), run('script Đurđa', { font: 'great-vibes', size: 20 }), run(' and mono šžć', { font: 'cousine', size: 11, underline: true, strike: true })] },
        { runs: [run('Short last line.', { italic: true, size: 12 })] },
      ];
      const base = { id: 'all', type: 'text', color: [0.1, 0.2, 0.6], opacity: 0.6, font: 'roboto', bold: true, size: 14, rotate: 0, rect: [80, 600, 380, 700], align: 'justify', lineSpacing: 1.5, background: [1, 0.953, 0.69] };
      const a = kind === 'every option'
        ? layoutText({ ...base, text, lines: [], underline: true, strike: true } as never)
        : layoutText({ ...base, bold: false, text: '', paragraphs } as never);
      w.__actions.addAnnotation(w.__doc.pages[0].id, a);
      await w.__viewer.setZoom(zoom);
      await new Promise((r) => setTimeout(r, 300));
      document.querySelector('.page[data-index="0"] .boxed[data-kind="text"]')!.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((r) => setTimeout(r, 300));
      const r = document.querySelector('.page[data-index="0"] .boxed[data-kind="text"]')!.getBoundingClientRect();
      const p = document.querySelector('.page[data-index="0"]')!.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), px: r.left - p.left, py: r.top - p.top };
    }, { zoom, kind });
    expect(box.h).toBeGreaterThan(50);
    // Wait until nothing moves any more (thumbnails and scrollbars settle), then use that position.
    Object.assign(box, await settled(page, '.page[data-index="0"] .boxed[data-kind="text"]'));
    const margin = 4;
    const editor = await page.screenshot({ clip: { x: box.x - margin, y: box.y - margin, width: box.w + 2 * margin, height: box.h + 2 * margin } });

    // The saved file, rendered by PDF.js at the same scale, same region.
    const pdf = await page.evaluate(async ({ box, margin }) => {
      const w = window as unknown as Record<string, any>;
      const { writePdf } = await load('/src/lib/pdf/pdf-writer.ts');
      const { openDocument } = await load('/src/lib/document.svelte.ts');
      const { viewportFor, renderToCanvas } = await load('/src/lib/pdf/render.ts');
      const bytes = await writePdf(w.__doc, w.__doc.pages, 'preserve');
      const { doc } = await openDocument([{ id: 'saved', name: 'saved.pdf', size: bytes.length, bytes }], async () => null);
      const pg = await doc!.sources.get('saved')!.pdf.getPage(1);
      const canvas = (await renderToCanvas(pg, viewportFor(pg, w.__viewer.scale, 0)).promise)!;
      const out = document.createElement('canvas');
      out.width = box.w + 2 * margin;
      out.height = box.h + 2 * margin;
      out.getContext('2d')!.drawImage(canvas, Math.round(box.px) - margin, Math.round(box.py) - margin, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    }, { box, margin });

    if (process.env.SAVE_VISUAL) {
      const fs = await import('node:fs');
      const tag = `${kind.split(',')[0].replace(/ /g, '-')}-${zoom}`;
      fs.writeFileSync(`tests/tmp/visual-editor-${tag}.png`, editor);
      fs.writeFileSync(`tests/tmp/visual-pdf-${tag}.png`, Buffer.from(pdf.split(',')[1], 'base64'));
    }
    const r = await compare(page, editor, pdf);
    test.info().annotations.push({ type: 'comparison', description: JSON.stringify(r) });
    expect(Math.abs(r.shift[0]), `horizontal shift ${r.shift[0]}`).toBeLessThanOrEqual(1);
    expect(Math.abs(r.shift[1]), `vertical shift ${r.shift[1]}`).toBeLessThanOrEqual(1);
    expect(r.cover[0], 'editor ink found in the PDF').toBeGreaterThan(0.9);
    expect(r.cover[1], 'PDF ink found in the editor').toBeGreaterThan(0.9);
    // Background (with the 60% opacity) the same colour, within a few levels.
    for (let c = 0; c < 3; c++) expect(Math.abs(r.bg[0][c] - r.bg[1][c])).toBeLessThan(6);
  });
}
