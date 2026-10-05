// The Text panel while a text box is being typed in: it stays (chosen from the
// selection, not from focus), its controls change the text without ending the
// edit or losing the selection, and the whole session is one undo step.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

const MAC = process.platform === 'darwin';

async function savedBox(page: Page, text: string) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused({ timeout: 15000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  return { editor, hit: page.locator('.page[data-index="0"] .box-hit[data-kind="text"]') };
}

const panelTitle = (page: Page) => page.getByRole('complementary', { name: 'Properties' }).locator('h2').first();
const domSelection = (page: Page) => page.evaluate(() => window.getSelection()!.toString());
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as Record<string, any>).__doc.history.undoLabel);
const runsShown = (page: Page) =>
  page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line > span').evaluateAll((spans) => spans.map((s) => [s.textContent, getComputedStyle(s).fontWeight === '700']));

/** Drag across the edit field with the mouse, from x fraction a to b of its first line. */
async function dragSelect(page: Page, a: number, b: number) {
  const box = (await page.locator('.rich-surface p').first().boundingBox())!;
  const y = box.y + 8;
  await page.mouse.move(box.x + box.width * a, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * b, y, { steps: 4 });
  await page.mouse.up();
}

test('editing keeps the Text panel; Bold and Underline change the selected text and keep focus and selection; one undo step', async ({ page }) => {
  const { editor, hit } = await savedBox(page, 'Alpha beta gamma');
  await hit.dblclick();
  await expect(editor).toBeFocused();
  await expect(panelTitle(page)).toHaveText('Text');

  // Select some text with the mouse (this used to switch the panel to Document).
  await dragSelect(page, 0.02, 0.4);
  const selected = await domSelection(page);
  expect(selected.length).toBeGreaterThan(2);
  await expect(panelTitle(page)).toHaveText('Text');

  const panel = page.getByRole('complementary', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Bold' }).click();
  await panel.getByRole('button', { name: 'Underline' }).click();
  await expect.poll(() => runsShown(page)).toContainEqual([expect.any(String), true]);
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .bar')).toHaveCount(1);
  await expect(editor).toBeFocused();
  expect(await domSelection(page)).toBe(selected);
  await expect(panelTitle(page)).toHaveText('Text');

  // Click the canvas background: editing ends, as one undo step.
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x - 12, pg.y + 200);
  await expect(editor).toBeHidden();
  expect(await undoLabel(page)).toBe('Edit text');
  await page.evaluate(() => (window as unknown as Record<string, any>).__doc.undo());
  await expect.poll(() => runsShown(page)).toEqual([['Alpha beta gamma', false]]);
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .bar')).toHaveCount(0);
});

test('box settings changed while editing apply live, undo inside the session, and save with it as one step', async ({ page }) => {
  const { editor, hit } = await savedBox(page, 'One two three four five six seven eight nine ten');
  const before = await undoLabel(page);
  await hit.dblclick();
  await expect(editor).toBeFocused();
  const panel = page.getByRole('complementary', { name: 'Properties' });
  const firstPad = () => page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line').first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  const left = await firstPad();

  await panel.getByRole('radio', { name: 'Align right' }).click();
  await expect.poll(firstPad).toBeGreaterThan(left);
  await expect(editor).toBeFocused();
  // A select needs focus; used with the mouse it hands focus back to the text.
  await panel.getByLabel('Line spacing').selectOption('2');
  await expect(editor).toBeFocused();
  await panel.getByRole('radiogroup', { name: 'Background' }).getByRole('radio', { name: 'Light yellow' }).click();
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"]')).toHaveCSS('background-color', 'rgb(255, 243, 176)');
  await expect(editor).toBeFocused();
  // Nothing is in the document's history yet: it's all one editing session.
  expect(await undoLabel(page)).toBe(before);

  // Undo and redo inside the session step through those changes.
  await page.keyboard.press('ControlOrMeta+z'); // background
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('ControlOrMeta+z'); // line spacing
  await page.keyboard.press('ControlOrMeta+z'); // alignment
  await expect.poll(firstPad).toBeCloseTo(left, 1);
  await page.keyboard.press(MAC ? 'Meta+Shift+z' : 'Control+y'); // alignment again
  await expect.poll(firstPad).toBeGreaterThan(left);

  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  expect(await undoLabel(page)).toBe('Edit text');
  await page.evaluate(() => (window as unknown as Record<string, any>).__doc.undo());
  await expect.poll(firstPad).toBeCloseTo(left, 1);
});

test('Tab goes from the text to the panel, Shift+Tab comes back; shortcuts still work', async ({ page }) => {
  const { editor, hit } = await savedBox(page, 'Keyboard only');
  await hit.focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeFocused();
  await expect(panelTitle(page)).toHaveText('Text');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+b');
  await expect.poll(() => runsShown(page)).toEqual([['Keyboard only', true]]);
  await page.keyboard.press('Tab');
  await expect(page.locator('#tx-font')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'Bold' })).toBeFocused();
  // Keyboard focus in the panel doesn't end the edit.
  await expect(editor).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
  expect(await domSelection(page)).toBe('Keyboard only');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  // No focus left on the page canvas.
  expect(await page.evaluate(() => document.activeElement?.closest('.page') && !document.activeElement.matches('.box-hit'))).toBeFalsy();
});

test('phones: the bottom sheet stays while typing, and tapping its controls keeps the box in edit mode', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  await page.evaluate(() => (window as unknown as Record<string, any>).__viewer.setTool('text'));
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  // A tap before the page is ready to take it does nothing: tap again, as a person would.
  await expect(async () => {
    if (!(await editor.count())) await page.touchscreen.tap(pg.x + 40, pg.y + 60);
    await expect(editor).toBeFocused({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await page.keyboard.type('Phone text');
  await page.keyboard.press('ControlOrMeta+a');
  const sheet = page.getByRole('region', { name: /properties/i }).or(page.locator('.sheet')).first();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Bold' }).tap();
  await expect(editor).toBeFocused();
  await expect(sheet.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  expect(await domSelection(page)).toBe('Phone text');
  await context.close();
});
