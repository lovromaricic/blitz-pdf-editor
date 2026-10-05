// Deleting an object never leaves a focus ring around the canvas: focus goes to
// the editor's <main> (a non-visual sink), and rings show only for Tab.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

/** Opening is over: focus moved to the editor and the first fit-width zoom has stopped scrolling. */
async function settled(page: Page) {
  await expect(page.locator('#editor-main')).toBeFocused();
  await quiet(page);
}

/** The view has stopped scrolling (a zoom or layout change has settled). */
async function quiet(page: Page) {
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}

test('Backspace on a selected object moves focus to the sink, with no ring on the canvas', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  const canvas = page.locator('#document-view');
  await expect(canvas).toBeVisible({ timeout: 15000 }); // the first open can be slow while the dev server is busy
  await settled(page);

  // Place a stamp, then select it with the mouse, the usual way.
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Stamp', exact: true }).click();
  const pageBox = (await page.locator('.page[data-index="0"]').boundingBox())!;
  const at = { x: pageBox.x + pageBox.width / 2, y: pageBox.y + 200 };
  await page.mouse.click(at.x, at.y);
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.click(pageBox.x + 40, pageBox.y + pageBox.height - 60); // empty spot: focuses the canvas
  const stamps = page.locator('.box-hit[data-kind="stamp"]');
  await expect(stamps).toHaveCount(1);
  await quiet(page);
  await stamps.first().click(); // the stamp
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __viewer: { selectedAnnot: unknown } }).__viewer.selectedAnnot)).toBe(true);

  await page.keyboard.press('Backspace');
  await expect(stamps).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('editor-main');
  expect(await canvas.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('editor-main')!).outlineStyle)).toBe('none');
  await expect(page.locator('[aria-live="polite"]', { hasText: 'Stamp deleted' })).toHaveCount(1);

  // Tab: the next control shows its ring.
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    return { id: a.id, tag: a.tagName, visible: a.matches(':focus-visible'), outline: getComputedStyle(a).outlineStyle };
  });
  expect(ring.tag).not.toBe('BODY');
  expect(ring.visible).toBe(true);
  expect(ring.outline).toBe('solid');
  expect(await canvas.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
});

test('the canvas shows its ring only when reached with Tab', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  const canvas = page.locator('#document-view');
  await expect(canvas).toBeVisible({ timeout: 15000 }); // the first open can be slow while the dev server is busy
  const outline = () => canvas.evaluate((el) => getComputedStyle(el).outlineStyle);
  await settled(page);

  // Clicked, then keys pressed (scrolling, undo): no ring.
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(canvas).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Backspace');
  expect(await outline()).toBe('none');

  // Reached with Tab: ring.
  await page.getByRole('button', { name: '+ Add pages' }).focus();
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  expect(await outline()).toBe('solid');
});
