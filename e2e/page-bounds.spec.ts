// The hard page boundary: objects dragged past any edge stop at it; a text box
// typed in until it fills the page stops taking lines.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;
// 1x1 red PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function open(page: Page, size: [number, number] = [612, 792]) {
  const doc = await PDFDocument.create();
  doc.addPage(size);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'edge.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.6);
    w.__viewer.goToPage(0);
  });
  await page.waitForTimeout(500);
}

const rectOf = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const w = window as unknown as W;
    const { bounds } = await import(/* @vite-ignore */ '/src/lib/annotations.ts' as string);
    return bounds(w.__doc.pages[0].annots.find((a: { id: string }) => a.id === id));
  }, id);

test('a text box, an image and a shape dragged past each edge stay on the page', async ({ page }) => {
  await open(page);
  await page.evaluate(async (png) => {
    const w = window as unknown as W;
    const { ensureTextFont } = await import(/* @vite-ignore */ '/src/lib/font-metrics-store.svelte.ts' as string);
    const { layoutText } = await import(/* @vite-ignore */ '/src/lib/text-layout.ts' as string);
    await ensureTextFont('roboto');
    const pid = w.__doc.pages[0].id;
    w.__actions.addAnnotation(pid, layoutText({ id: 't', type: 'text', text: 'Edge text', font: 'roboto', size: 14, color: [0, 0, 0], opacity: 1, rotate: 0, rect: [250, 400, 400, 420] }));
    w.__actions.addAnnotation(pid, { id: 'i', type: 'image', role: 'image', color: [0, 0, 0], opacity: 1, dataUrl: png, rotate: 0, angle: 30, rect: [250, 250, 350, 330] });
    w.__actions.addAnnotation(pid, { id: 's', type: 'shape', shape: 'ellipse', color: [0.8, 0, 0], opacity: 1, width: 4, fill: null, from: [250, 550], to: [350, 620] });
    w.__viewer.setTool('select');
  }, PNG);
  const pageBox = (await page.locator('.page[data-index="0"]').boundingBox())!;
  for (const id of ['t', 'i', 's']) {
    for (const [dx, dy] of [[-2000, 0], [2000, 0], [0, -2000], [0, 2000]]) {
      const el = page.locator(`[data-annot-id="${id}"]`);
      const b = (await el.boundingBox())!;
      // Grab it in its middle (a shape by its outline).
      const at = id === 's' ? { x: b.x + 2, y: b.y + b.height / 2 } : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + dx / 4, at.y + dy / 4, { steps: 3 });
      await page.mouse.move(at.x + dx, at.y + dy, { steps: 6 });
      await page.mouse.up();
      const r = await rectOf(page, id);
      expect(r[0], `${id} ${dx},${dy} left`).toBeGreaterThanOrEqual(-0.01);
      expect(r[1], `${id} ${dx},${dy} bottom`).toBeGreaterThanOrEqual(-0.01);
      expect(r[2], `${id} ${dx},${dy} right`).toBeLessThanOrEqual(612.01);
      expect(r[3], `${id} ${dx},${dy} top`).toBeLessThanOrEqual(792.01);
      // And it reached the edge it was dragged to.
      if (dx < 0) expect(r[0]).toBeLessThan(1);
      if (dx > 0) expect(r[2]).toBeGreaterThan(611);
      if (dy > 0) expect(r[1]).toBeLessThan(1);
      if (dy < 0) expect(r[3]).toBeGreaterThan(791);
      // Bring it back to the middle for the next drag.
      await page.evaluate(
        ({ id, r }) => {
          const w = window as unknown as W;
          const a = w.__doc.pages[0].annots.find((x: { id: string }) => x.id === id);
          import(/* @vite-ignore */ '/src/lib/annotations.ts' as string).then(({ translate }) =>
            w.__actions.updateAnnotation(w.__doc.pages[0].id, translate(a, 306 - (r[0] + r[2]) / 2, 396 - (r[1] + r[3]) / 2), 'Move'),
          );
        },
        { id, r },
      );
      await page.waitForTimeout(150);
    }
  }
  // Stopping said so (once a second at most).
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText('Stopped at the page edge');
  void pageBox;
});

test('a text box typed in until the page ends: it moves up, then takes no more lines; a long paste is cut', async ({ page }) => {
  await open(page, [298, 420]); // A6: a small page
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  // Near the bottom right: the new box is narrower than usual so it fits.
  await page.mouse.click(pg.x + pg.width - 40, pg.y + pg.height - 30);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused({ timeout: 15000 });
  const box = () => page.evaluate(() => (document.querySelector('.rich-editor') as HTMLElement).getBoundingClientRect().toJSON());
  const first = await box();
  expect(first.right).toBeLessThanOrEqual(pg.x + pg.width + 1);
  // Many lines: the box moves up as it grows, and stops at the page top.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.type(`Line ${i}`);
    await page.keyboard.press('Enter');
  }
  const full = await box();
  expect(full.top).toBeGreaterThanOrEqual(pg.y - 1);
  expect(full.bottom).toBeLessThanOrEqual(pg.y + pg.height + 1);
  await expect(page.getByText('This text box is full: the page ends here.')).toBeVisible();
  const text = await editor.innerText();
  expect(text).toContain('Line 0'); // nothing already there is lost
  expect(text).not.toContain('Line 59');
  // Typing more adds nothing; a paste is cut too, and nothing is lost.
  const before = await editor.innerText();
  await page.keyboard.type('more');
  await page.keyboard.press('Enter');
  await page.keyboard.type('more');
  const after = await editor.innerText();
  expect(after.split('\n').length).toBeLessThanOrEqual(before.split('\n').length + 1);
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(async () => {
    const w = window as unknown as W;
    const { bounds } = await import(/* @vite-ignore */ '/src/lib/annotations.ts' as string);
    const a = w.__doc.pages[0].annots[0];
    return { r: bounds(a), page: w.__doc.pageBounds(w.__doc.pages[0]) };
  });
  expect(saved.r[1]).toBeGreaterThanOrEqual(saved.page[1] - 0.01);
  expect(saved.r[3]).toBeLessThanOrEqual(saved.page[3] + 0.01);
});

test('a long paste into a box near the page bottom is cut after the last word that fits', async ({ page }) => {
  await open(page, [298, 420]);
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 40, pg.y + pg.height / 2);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused({ timeout: 15000 });
  await page.keyboard.type('Kept text.');
  const long = Array.from({ length: 120 }, (_, i) => `Pasted line number ${i}`).join('\n');
  await editor.evaluate((el, long) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', long);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, long);
  const text = await editor.innerText();
  expect(text.startsWith('Kept text.Pasted line number 0')).toBe(true);
  expect(text).toContain('Pasted line number 5');
  expect(text).not.toContain('Pasted line number 119');
  await expect(page.getByText('This text box is full: the page ends here.')).toBeVisible();
  const r = await page.evaluate(() => (document.querySelector('.rich-editor') as HTMLElement).getBoundingClientRect().toJSON());
  expect(r.bottom).toBeLessThanOrEqual(pg.y + pg.height + 1);
  expect(r.top).toBeGreaterThanOrEqual(pg.y - 1);
});
