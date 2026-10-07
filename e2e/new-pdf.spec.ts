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

test('a new blank PDF opens with the margins shown (25 mm); opened files, added pages and PDFs from images don’t', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'old.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  const guide = page.locator('.page[data-index="0"] .margin-guide');
  // An opened file: no margins, nor after adding a blank page.
  await expect(guide).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Record<string, any>).__actions.insertBlank());
  await expect(page.locator('.page[data-index="1"]')).toBeVisible();
  await expect(page.locator('.margin-guide')).toHaveCount(0);
  // (Saved, so the new document doesn't ask about unsaved changes first.)
  await page.evaluate(() => (window as unknown as Record<string, any>).__doc.markSaved());

  // A new blank PDF: shown, at the default size.
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New blank PDF…/ }).click();
  await page.getByRole('dialog', { name: 'New blank PDF' }).getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveTitle(/^Untitled\.pdf/);
  await expect(guide).toHaveCount(1);
  await expect(page.locator('.page[data-index="0"] .margin-label')).toHaveText('25 mm');
  // The View menu shows it and turns it off as usual.
  const view = async () => page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  await view();
  const item = page.getByRole('menuitemcheckbox', { name: 'Show margins' });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await item.click();
  await expect(guide).toHaveCount(0);

  // A PDF made from images: no margins.
  await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    w.__doc.markSaved();
    const c = new OffscreenCanvas(80, 60);
    c.getContext('2d')!.fillRect(0, 0, 80, 60);
    const file = new File([await c.convertToBlob({ type: 'image/png' })], 'pic.png', { type: 'image/png' });
    await w.__actions.createFromImages([file], { pageSize: 'a4', margin: 0 });
  });
  await expect(page).toHaveTitle(/pic\.pdf/);
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  await expect(page.locator('.margin-guide')).toHaveCount(0);
});
