// Existing text boxes (from before rich text) must look exactly the same.
// The reference images were made with the code before the rich-text model;
// every later version must still match them, in the editor and in the saved
// PDF (rendered with PDF.js), at 100% and 200%.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

test.use({ deviceScaleFactor: 1, viewport: { width: 1600, height: 2400 } });

/** Text boxes as they are stored in documents made before rich text (plain fields, stored lines). */
const LEGACY = [
  { id: 'l1', font: 'roboto', size: 14, text: 'Plain left aligned text that wraps onto a second line here.', align: undefined },
  { id: 'l2', font: 'roboto', size: 12, bold: true, italic: true, underline: true, text: 'Bold italic underlined, centered Čačić Đurđa.', align: 'center' },
  { id: 'l3', font: 'lora', size: 11, strike: true, text: 'Right aligned with strikethrough and a light blue background.', align: 'right', background: [0.84, 0.9, 1] },
  { id: 'l4', font: 'arimo', size: 13, text: 'Justified text spreads its words across the whole line, except the last line.\nNew paragraph.', align: 'justify', lineSpacing: 1.5 },
  { id: 'l5', font: 'sans', size: 16, text: 'Old built-in font, 60% opacity, yellow fill.', opacity: 0.6, background: [1, 0.953, 0.69] },
  // Made in an older version: its lines were measured differently and must stay as stored.
  { id: 'l6', font: 'tinos', size: 12, text: 'Stored line breaks win over today\'s wrapping.', storedLines: ['Stored line breaks', 'win over today\'s', 'wrapping.'] },
] as const;

async function setup(page: Page, zoom: number) {
  await page.addInitScript(() => {
    (window as unknown as { load: (p: string) => Promise<unknown> }).load = (p: string) => import(/* @vite-ignore */ p);
  });
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  await page.evaluate(
    async ({ boxes, zoom }) => {
      const w = window as unknown as Record<string, any>;
      const { ensureTextFont, textMeasure } = await w.load('/src/lib/font-metrics-store.svelte.ts');
      const { wrapParagraphs, boxHeight } = await w.load('/src/lib/text-box-layout.ts');
      // Exactly what the code before rich text stored: plain fields, wrapped lines, paragraph ends, height.
      const layoutText = (a: any) => {
        const width = a.rect[2] - a.rect[0];
        const { lines, ends } = wrapParagraphs(a.text, textMeasure(a, a.size), Math.max(a.size, width - 6));
        const h = boxHeight(lines.length, a.size, a.lineSpacing ?? 1.25);
        return { ...a, lines, ends, rect: [a.rect[0], a.rect[3] - h, a.rect[2], a.rect[3]] };
      };
      const pageId = w.__doc.pages[0].id;
      let top = 800;
      for (const b of boxes as unknown as any[]) {
        await ensureTextFont(b.font);
        const base = { id: b.id, type: 'text', color: [0.1, 0.15, 0.3], opacity: b.opacity ?? 1, font: b.font, size: b.size, bold: b.bold, italic: b.italic, underline: b.underline, strike: b.strike, align: b.align, lineSpacing: b.lineSpacing, background: b.background, text: b.text, lines: [], rotate: 0, rect: [60, top - 40, 300, top] };
        let a = layoutText(base);
        // As stored by an older version: its own line breaks, and a box tall enough for them.
        if (b.storedLines) {
          const h = b.storedLines.length * b.size * 1.25 + 6;
          a = { ...a, lines: b.storedLines, ends: undefined, rect: [a.rect[0], a.rect[3] - h, a.rect[2], a.rect[3]] };
        }
        w.__actions.addAnnotation(pageId, a);
        top = a.rect[1] - 24;
      }
      await document.fonts.ready;
      await w.__viewer.setZoom(zoom);
      w.__viewer.goToPage(0);
      await new Promise((r) => setTimeout(r, 600));
    },
    { boxes: LEGACY, zoom },
  );
}

/** The page area holding the boxes, as drawn in the editor, and as PDF.js draws the saved file. */
async function shots(page: Page) {
  // Wait until the boxes stop moving (thumbnails, scrollbars and fonts settle).
  let previous = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('.page[data-index="0"] .boxed[data-kind="text"]')].map((b) => b.getBoundingClientRect().toJSON())));
    if (now === previous) break;
    previous = now;
    await page.waitForTimeout(250);
  }
  const area = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.page[data-index="0"] .boxed[data-kind="text"]')].map((b) => b.getBoundingClientRect());
    const p = document.querySelector('.page[data-index="0"]')!.getBoundingClientRect();
    const x1 = Math.min(...boxes.map((b) => b.left)) - 4;
    const y1 = Math.min(...boxes.map((b) => b.top)) - 4;
    const x2 = Math.max(...boxes.map((b) => b.right)) + 4;
    const y2 = Math.max(...boxes.map((b) => b.bottom)) + 4;
    return { x: Math.floor(x1), y: Math.floor(y1), w: Math.ceil(x2 - x1), h: Math.ceil(y2 - y1), px: Math.floor(x1) - p.left, py: Math.floor(y1) - p.top };
  });
  const editor = await page.screenshot({ clip: { x: area.x, y: area.y, width: area.w, height: area.h } });
  const pdf = await page.evaluate(async (area) => {
    const w = window as unknown as Record<string, any>;
    const { writePdf } = await w.load('/src/lib/pdf/pdf-writer.ts');
    const { openDocument } = await w.load('/src/lib/document.svelte.ts');
    const { viewportFor, renderToCanvas } = await w.load('/src/lib/pdf/render.ts');
    const bytes = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    const { doc } = await openDocument([{ id: 'saved', name: 'saved.pdf', size: bytes.length, bytes }], async () => null);
    const pg = await doc.sources.get('saved').pdf.getPage(1);
    const canvas = await renderToCanvas(pg, viewportFor(pg, w.__viewer.scale, 0)).promise;
    const out = document.createElement('canvas');
    out.width = area.w;
    out.height = area.h;
    out.getContext('2d')!.drawImage(canvas, Math.round(area.px), Math.round(area.py), area.w, area.h, 0, 0, area.w, area.h);
    return out.toDataURL('image/png').split(',')[1];
  }, area);
  return { editor, pdf: Buffer.from(pdf, 'base64') };
}

/** The largest difference of any color channel between two same-size images (0 = identical). */
async function maxPixelDifference(page: Page, a: Buffer, b: Buffer) {
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
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return 255;
      let max = 0;
      for (let i = 0; i < x.data.length; i++) max = Math.max(max, Math.abs(x.data[i] - y.data[i]));
      return max;
    },
    [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`],
  );
}

for (const zoom of [1, 2]) {
  test(`text boxes from before rich text look unchanged (zoom ${zoom * 100}%)`, async ({ page }) => {
    await setup(page, zoom);
    const { editor, pdf } = await shots(page);
    expect(editor).toMatchSnapshot(`legacy-editor-${zoom}x.png`, { maxDiffPixelRatio: 0.001 });
    expect(pdf).toMatchSnapshot(`legacy-pdf-${zoom}x.png`, { maxDiffPixelRatio: 0.001 });
  });
}

test('converted to rich text (one run per paragraph), boxes look exactly as before', async ({ page }) => {
  await setup(page, 1);
  // Leave out the box whose stored line breaks differ from today's wrapping: converting rewraps it, by design.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const p = w.__doc.pages[0];
    w.__doc.pages = [{ ...p, annots: p.annots.filter((a: { id: string }) => a.id !== 'l6') }];
  });
  await page.waitForTimeout(300);
  const before = await shots(page);
  await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const { toRich } = await w.load('/src/lib/text-rich.ts');
    const p = w.__doc.pages[0];
    w.__doc.pages = [{ ...p, annots: p.annots.map(toRich) }];
    if (!w.__doc.pages[0].annots.every((a: { paragraphs?: unknown }) => a.paragraphs)) throw new Error('not converted');
  });
  await page.waitForTimeout(300);
  const after = await shots(page);
  // Same pixels, allowing the ±1 level noise Chrome sometimes adds to translucent fills.
  expect(await maxPixelDifference(page, before.editor, after.editor), 'editor pixels unchanged').toBeLessThanOrEqual(2);
  expect(await maxPixelDifference(page, before.pdf, after.pdf), 'saved PDF pixels unchanged').toBeLessThanOrEqual(2);
});
