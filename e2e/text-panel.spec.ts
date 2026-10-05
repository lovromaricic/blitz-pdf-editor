// Every Text panel control, and what it does to the text box on the page.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

async function setup(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  // Type a text box with the Text tool.
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
  await page.keyboard.type('Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu');
  await page.keyboard.press('Escape');
  // Select it.
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').click();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toContainText('Text');
}

const box = (page: Page) => page.locator('.page[data-index="0"] .boxed[data-kind="text"]');
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as { __doc: { history: { undoLabel: string } } }).__doc.history.undoLabel);

test('every Text panel control changes the text box on screen', async ({ page }) => {
  await setup(page);
  const panel = page.getByRole('complementary', { name: 'Properties' });
  // Font styles are on each run's span; line spacing on the text block.
  const text = box(page).locator('.line span').first();
  const block = box(page).locator('.text');

  // B, I, U, S
  await panel.getByRole('button', { name: 'Bold' }).click();
  await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await expect(text).toHaveCSS('font-weight', '700');
  expect(await undoLabel(page)).toBe('Bold');
  await panel.getByRole('button', { name: 'Italic' }).click();
  await expect(text).toHaveCSS('font-style', 'italic');
  const lines = await box(page).locator('.line').count();
  await panel.getByRole('button', { name: 'Underline' }).click();
  await expect(box(page).locator('.bar')).toHaveCount(lines);
  await panel.getByRole('button', { name: 'Strikethrough' }).click();
  await expect(box(page).locator('.bar')).toHaveCount(2 * lines); // both on together
  expect(await undoLabel(page)).toBe('Strikethrough');

  // Size: stepper, typing, arrows, and a rejected value.
  const size = panel.getByLabel('Size (pt)');
  await panel.getByRole('button', { name: 'Larger' }).click();
  await expect(size).toHaveValue('13');
  expect(await undoLabel(page)).toBe('Font size');
  await size.fill('20');
  await size.press('Enter');
  await expect(size).toHaveValue('20');
  const px20 = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await size.press('Shift+ArrowUp');
  await expect(size).toHaveValue('30');
  await size.fill('abc');
  await size.blur();
  await expect(panel.getByText('Use a whole number from 6 to 144.')).toBeVisible();
  await expect(size).toHaveValue('30');
  expect(await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo((px20 * 30) / 20, 0);
  await size.fill('14');
  await size.press('Enter');

  // Alignment: a radiogroup with arrow keys.
  const group = panel.getByRole('radiogroup', { name: 'Alignment' });
  await group.getByRole('radio', { name: 'Align center' }).click();
  await expect(group.getByRole('radio', { name: 'Align center' })).toHaveAttribute('aria-checked', 'true');
  expect(await undoLabel(page)).toBe('Align center');
  const firstPad = async () => parseFloat(await box(page).locator('.line').first().evaluate((el) => getComputedStyle(el).paddingLeft));
  const centered = await firstPad();
  await page.keyboard.press('ArrowRight'); // → right
  await expect(group.getByRole('radio', { name: 'Align right' })).toBeFocused();
  await expect(group.getByRole('radio', { name: 'Align right' })).toHaveAttribute('aria-checked', 'true');
  expect(await firstPad()).toBeGreaterThan(centered);
  await page.keyboard.press('ArrowRight'); // → justify
  await expect(box(page).locator('.line span[style*="word-spacing"]').first()).toBeAttached();

  // Line spacing
  await panel.getByLabel('Line spacing').selectOption('2');
  await expect(block).toHaveCSS('line-height', /px$/);
  const lh = await block.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) / parseFloat(getComputedStyle(el).fontSize));
  expect(lh).toBeCloseTo(2, 1);
  expect(await undoLabel(page)).toBe('Line spacing');

  // Color and background
  await panel.getByRole('radiogroup', { name: 'Text color' }).getByRole('radio', { name: 'Red' }).click();
  await expect(text).toHaveCSS('color', 'rgb(217, 38, 38)');
  await panel.getByRole('radiogroup', { name: 'Background' }).getByRole('radio', { name: 'Light yellow' }).click();
  await expect(box(page)).toHaveCSS('background-color', 'rgb(255, 243, 176)');
  expect(await undoLabel(page)).toBe('Background');
  await panel.getByRole('radiogroup', { name: 'Background' }).getByRole('radio', { name: 'None' }).click();
  await expect(box(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  // Opacity applies to the whole box (text and background together).
  const slider = panel.getByLabel(/^Opacity/);
  await slider.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await expect(box(page)).toHaveCSS('opacity', '0.8');

  // Bold on a font without bold: disabled, setting kept.
  await page.evaluate(async () => {
    const w = window as unknown as { __actions: { selectedAnnot: { page: { id: string }; annot: object } | null; updateAnnotation: (p: string, a: object, l: string) => void } };
    const path = '/src/lib/text-layout.ts';
    const { formatTextBox } = await import(/* @vite-ignore */ path);
    const sel = w.__actions.selectedAnnot!;
    w.__actions.updateAnnotation(sel.page.id, formatTextBox(sel.annot, { font: 'great-vibes' }), 'Font');
  });
  await expect(panel.getByRole('button', { name: 'Bold' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('title', 'This font has no bold');
  await expect(text).toHaveCSS('font-weight', '400');
});

test('Ctrl/Cmd+B, I and U style the selected text box, and the box being typed in', async ({ page }) => {
  await setup(page);
  const panel = page.getByRole('complementary', { name: 'Properties' });
  const hit = page.locator('.page[data-index="0"] .box-hit[data-kind="text"]');
  await hit.focus();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  expect(await undoLabel(page)).toBe('Bold');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(panel.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ControlOrMeta+u');
  await expect(panel.getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true');
  // Tooltips name the shortcut where there is one; strikethrough has none.
  await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('title', /^Bold \((Ctrl\+B|⌘B)\)$/);
  await expect(panel.getByRole('button', { name: 'Strikethrough' })).toHaveAttribute('title', 'Strikethrough');

  // While typing: the shortcut formats the selected text, and the box shows it at once.
  await hit.dblclick();
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+u');
  await expect(box(page).locator('.bar')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(box(page).locator('.line span').first()).toHaveCSS('font-weight', '400');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(box(page).locator('.line span').first()).toHaveCSS('font-weight', '400');
  await expect(box(page).locator('.bar')).toHaveCount(0);
  // The whole editing session is one undo step.
  expect(await undoLabel(page)).toBe('Edit text');
});
