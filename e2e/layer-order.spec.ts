// Layer order: the saved PDF draws overlapping objects (shapes, text boxes,
// highlights, strokes, with transparency) in the same order as the editor,
// before and after reordering.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

async function open(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as W).load = (p: string) => import(/* @vite-ignore */ p);
  });
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'layers.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
}

/** Overlapping objects of every kind, added bottom first. */
async function addObjects(page: Page) {
  await page.evaluate(async () => {
    const w = window as unknown as W;
    const { ensureTextFont } = await w.load('/src/lib/font-metrics-store.svelte.ts');
    const { layoutText } = await w.load('/src/lib/text-layout.ts');
    await ensureTextFont('roboto');
    const pageId = w.__doc.pages[0].id;
    const add = (a: object) => w.__actions.addAnnotation(pageId, a);
    add({ id: 'red', type: 'shape', shape: 'rect', color: [0.8, 0, 0], opacity: 1, width: 2, fill: [0.9, 0.1, 0.1], from: [100, 480], to: [300, 650] });
    add(
      layoutText({ id: 'txt', type: 'text', text: 'Layers', font: 'roboto', size: 14, color: [0, 0, 0], opacity: 1, rotate: 0, background: [0.84, 0.9, 1], rect: [180, 560, 400, 600] }),
    );
    add({ id: 'blue', type: 'shape', shape: 'ellipse', color: [0, 0, 0.7], opacity: 0.5, width: 2, fill: [0.1, 0.2, 0.9], from: [220, 440], to: [420, 640] });
    add({ id: 'hl', type: 'highlight', color: [1, 0.84, 0.04], opacity: 1, rects: [[120, 500, 380, 520]] });
    add({ id: 'ink', type: 'ink', color: [0, 0.5, 0], opacity: 0.8, width: 8, paths: [[[110, 470], [410, 630]]] });
    w.__viewer.setTool('select');
    await w.__viewer.setZoom(1);
    w.__viewer.goToPage(0);
  });
  // Until the view has stopped moving (the zoom re-renders and scrolls).
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
  await page.waitForTimeout(300);
}

/** PDF points where objects overlap (and a few where they don't). */
const SAMPLES: [number, number][] = [
  [150, 600], // red only
  [250, 510], // red + text bg? no: red + highlight + blue
  [260, 580], // red + text background + blue
  [350, 580], // text background + blue
  [350, 510], // highlight + blue
  [300, 550], // red edge, blue, ink nearby
  [200, 520], // red + highlight
  [390, 625], // ink + blue
];

/** Colors at the sample points: in the editor (a screenshot) and in the saved PDF (rendered by PDF.js). */
async function colors(page: Page) {
  const box = (await page.locator('.page[data-index="0"]').boundingBox())!;
  const shot = (await page.screenshot({ clip: box })).toString('base64');
  return page.evaluate(
    async ({ shot, samples }) => {
      const w = window as unknown as W;
      const scale = w.__viewer.scale;
      const pixels = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d')!;
        // Average a 3×3 patch (anti-aliasing at edges differs slightly between renderers).
        return samples.map(([x, y]) => {
          const d = ctx.getImageData(Math.round(x * scale) - 1, Math.round((792 - y) * scale) - 1, 3, 3).data;
          const c = [0, 0, 0];
          for (let i = 0; i < 9; i++) for (let k = 0; k < 3; k++) c[k] += d[i * 4 + k] / 9;
          return c.map(Math.round);
        });
      };
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const ed = document.createElement('canvas');
      ed.width = img.width;
      ed.height = img.height;
      ed.getContext('2d')!.drawImage(img, 0, 0);

      const { writePdf } = await w.load('/src/lib/pdf/pdf-writer.ts');
      const { loadPdf } = await w.load('/src/lib/pdf/pdfjs.ts');
      const { viewportFor, renderToCanvas } = await w.load('/src/lib/pdf/render.ts');
      const pdf = await loadPdf(await writePdf(w.__doc, w.__doc.pages, 'preserve'));
      const pg = await pdf.getPage(1);
      const canvas = (await renderToCanvas(pg, viewportFor(pg, scale, 0)).promise) as HTMLCanvasElement;
      return { editor: pixels(ed), pdf: pixels(canvas) };
    },
    { shot, samples: SAMPLES },
  );
}

const maxDiff = (a: number[][], b: number[][]) => Math.max(...a.flatMap((c, i) => c.map((v, k) => Math.abs(v - b[i][k]))));

test('the saved PDF draws overlapping objects in the editor order, before and after reordering', async ({ page }) => {
  await open(page);
  await addObjects(page);
  const first = await colors(page);
  expect(maxDiff(first.editor, first.pdf), JSON.stringify(first)).toBeLessThanOrEqual(12);

  // Reorder: the half-transparent ellipse to the back, the red rectangle to the front, the text up one.
  await page.evaluate(() => {
    const w = window as unknown as W;
    const id = w.__doc.pages[0].id;
    w.__actions.moveLayer(id, 'blue', 'back');
    w.__actions.moveLayer(id, 'red', 'front');
    w.__actions.moveLayer(id, 'txt', 'forward');
  });
  expect(await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.map((a: { id: string }) => a.id))).toEqual(['blue', 'hl', 'txt', 'ink', 'red']);
  await page.waitForTimeout(300);
  const second = await colors(page);
  expect(maxDiff(second.editor, second.pdf), JSON.stringify(second)).toBeLessThanOrEqual(12);
  // The order really changed what's visible where they overlap.
  expect(maxDiff(first.editor, second.editor)).toBeGreaterThan(40);

  // Undo all three: the first order (and look) is back.
  await page.evaluate(() => {
    const w = window as unknown as W;
    for (let i = 0; i < 3; i++) w.__doc.undo();
  });
  await page.waitForTimeout(300);
  const back = await colors(page);
  expect(maxDiff(back.editor, first.editor)).toBeLessThanOrEqual(3);
});
