// View › Show margins, Smart guides and Margin size: snapping while dragging,
// guide lines, Alt to drag freely; none of it in the saved PDF.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

async function open(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'guides.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.75);
    w.__viewer.goToPage(0);
    const pid = w.__doc.pages[0].id;
    w.__actions.addAnnotation(pid, { id: 'a', type: 'stamp', label: 'A', color: [0.1, 0.35, 0.8], opacity: 1, rotate: 0, rect: [150, 600, 260, 634] });
    w.__actions.addAnnotation(pid, { id: 'b', type: 'stamp', label: 'B', color: [0.8, 0.1, 0.1], opacity: 1, rotate: 0, rect: [330, 450, 440, 480] });
    w.__viewer.setTool('select');
  });
  // Until the view has stopped moving (the zoom re-renders and scrolls).
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
  await page.waitForTimeout(200);
}

async function view(page: Page, item: RegExp | string, sub?: string) {
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  if (sub) await page.getByRole('menuitem', { name: sub }).click();
  await page.getByRole('menu').getByRole(sub ? 'menuitemradio' : 'menuitemcheckbox', { name: item }).click();
}

const rect = (page: Page, id: string) => page.evaluate((id) => (window as unknown as W).__doc.pages[0].annots.find((a: { id: string }) => a.id === id).rect as number[], id);
const scale = (page: Page) => page.evaluate(() => (window as unknown as W).__viewer.scale as number);

/** Drag object `id` by (dx, dy) screen px; `during` runs before the button is released. */
async function drag(page: Page, id: string, dx: number, dy: number, during?: () => Promise<void>, alt = false) {
  const b = (await page.locator(`[data-annot-id="${id}"]`).boundingBox())!;
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(at.x + dx / 2, at.y + dy / 2, { steps: 3 });
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 3 });
  if (during) await during();
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

test('Show margins: drawn on the page; a box dragged near the left margin lands exactly on it, with a guide', async ({ page }) => {
  await open(page);
  await expect(page.locator('.page[data-index="0"] .margin-guide')).toHaveCount(0);
  await view(page, 'Show margins');
  await expect(page.locator('.page[data-index="0"] .margin-guide')).toHaveCount(1);
  await expect(page.locator('.page[data-index="0"] .margin-label')).toHaveText('12.7 mm');
  const s = await scale(page);
  // From x = 150 pt to about 3 px right of the margin (36 pt).
  const dx = (36 - 150) * s + 3;
  await drag(page, 'a', dx, 0, async () => {
    await expect(page.locator('.page[data-index="0"] line.guide')).not.toHaveCount(0);
  });
  await expect(page.locator('.page[data-index="0"] line.guide')).toHaveCount(0);
  expect((await rect(page, 'a'))[0]).toBeCloseTo(36, 1);
  // Margin size: 25.4 mm (radio), and the margin moves with it.
  await view(page, /^25\.4 mm/, 'Margin size');
  await expect(page.locator('.page[data-index="0"] .margin-label')).toHaveText('25.4 mm');
  // Margins off: they pull nothing (and aren't drawn).
  await view(page, 'Show margins');
  await expect(page.locator('.page[data-index="0"] .margin-guide')).toHaveCount(0);
  const before = (await rect(page, 'a'))[0];
  await drag(page, 'a', (72 - before) * s + 3, 0);
  expect((await rect(page, 'a'))[0]).not.toBeCloseTo(72, 1);
});

test('Smart guides: center on the page, line up with another object; Alt drags freely; off: no pull', async ({ page }) => {
  await open(page);
  const s = await scale(page);
  // b's left (330) to within 3 px of a's left (150), far from the page center.
  let a = await rect(page, 'a');
  await drag(page, 'b', (a[0] - 330) * s + 3, 0);
  expect((await rect(page, 'b'))[0]).toBeCloseTo(a[0], 1);
  // a's center (205) to within 4 px of the page center (306).
  await drag(page, 'a', (306 - 205) * s - 4, 0);
  a = await rect(page, 'a');
  expect((a[0] + a[2]) / 2).toBeCloseTo(306, 1);
  // Alt held: the same near-miss stays a near-miss.
  const b0 = (await rect(page, 'b'))[0];
  await drag(page, 'b', 20 * s, 0);
  await drag(page, 'b', (a[0] - (b0 + 20)) * s + 3, 0, undefined, true);
  expect(Math.abs((await rect(page, 'b'))[0] - a[0])).toBeGreaterThan(1);
  // Smart guides off: no pull at all.
  await view(page, 'Smart guides');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  a = await rect(page, 'a');
  await drag(page, 'a', 30 * s, 0);
  await drag(page, 'a', -30 * s + 4, 0);
  const c = await rect(page, 'a');
  expect(Math.abs((c[0] + c[2]) / 2 - 306)).toBeGreaterThan(1);
  // And the menu shows the state.
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Smart guides' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show margins' })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
});

test('guides and margins are never in the saved PDF', async ({ page }) => {
  await open(page);
  const render = () =>
    page.evaluate(async () => {
      const w = window as unknown as W;
      const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
      const { loadPdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdfjs.ts' as string);
      const { renderToCanvas } = await import(/* @vite-ignore */ '/src/lib/pdf/render.ts' as string);
      const pdf = await loadPdf(await writePdf(w.__doc, w.__doc.pages, 'preserve'));
      const pg = await pdf.getPage(1);
      const canvas = await renderToCanvas(pg, pg.getViewport({ scale: 1 })).promise;
      return canvas!.toDataURL();
    });
  const plain = await render();
  await view(page, 'Show margins');
  // Mid-drag, with a guide showing, the file is the same.
  const b = (await page.locator('[data-annot-id="a"]').boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 22, b.y + 10, { steps: 2 });
  const during = await render();
  await page.mouse.up();
  expect(during).toBe(plain);
  expect(await render()).toBe(plain);
});
