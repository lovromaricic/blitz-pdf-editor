// Closing a document right after opening it (while the landing screen is still
// fading out) brings back a landing screen that takes files again.
import { expect, test } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

const pdf = async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return Buffer.from(await d.save());
};

test('a file chosen after a quick open-and-close opens', async ({ page }) => {
  await page.goto('/');
  // Wait for the falling-paper scene: the opening animation (and its fade-out) needs it.
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __paperScene?: unknown }).__paperScene), { timeout: 15000 }).toBe(true);
  // Close the document the moment it opens, while Home is still on its way out.
  await page.evaluate(async () => {
    const path = '/src/lib/app-state.svelte.ts';
    const { app, closeDocument } = await import(/* @vite-ignore */ path);
    const wait = () => {
      if (app.doc) closeDocument();
      else requestAnimationFrame(wait);
    };
    wait();
  });
  await page.locator('input[type=file]').first().setInputFiles({ name: 'first.pdf', mimeType: 'application/pdf', buffer: await pdf() });
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/open-files.svelte.ts';
    return (await import(/* @vite-ignore */ path)).opening.busy;
  })).toBe(false);
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeEnabled();
  await expect(page.locator('.page[data-index="0"]')).toBeHidden();

  // Home takes the next file.
  await page.locator('input[type=file]').first().setInputFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: await pdf() });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
});
