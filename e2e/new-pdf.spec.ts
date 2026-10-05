// File › New blank PDF…: the dialog, keyboard use, and where focus goes after creating.
import { expect, test } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

test('creates a blank US Letter PDF from the keyboard and moves focus to the editor', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'old.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New blank PDF…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New blank PDF' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Page size')).toBeFocused();
  await dialog.getByLabel('Page size').selectOption('letter');
  await page.keyboard.press('Enter');

  await expect(page).toHaveTitle(/^Untitled\.pdf/);
  await expect(page.locator('.edited')).toHaveCount(0);
  await expect(page.locator('[aria-live="polite"]', { hasText: 'New blank PDF created, 1 page' })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('editor-main');
  expect(await page.locator('#document-view').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  // US Letter, as shown: 8.5 × 11 in at the current zoom.
  const box = (await page.locator('.page[data-index="0"]').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(612 / 792, 2);
  await expect(page.getByRole('complementary', { name: 'Properties' })).toContainText('Untitled.pdf');
});

test('Escape cancels and Create checks the custom size', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'old.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New blank PDF…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New blank PDF' });
  await dialog.getByLabel('Page size').selectOption('custom');
  await dialog.getByLabel('Width').fill('5');
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Width: Too small: at least 12.7 mm.')).toBeVisible();
  await expect(dialog.getByLabel('Width')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveTitle(/^old\.pdf/);
});
