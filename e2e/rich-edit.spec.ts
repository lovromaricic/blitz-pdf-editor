// Formatting inside a text box: partial selections, the Mixed state, the
// typing style, paste, and undo within one editing session.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

async function newBox(page: Page, text: string) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.type(text);
  return editor;
}

/** The box's runs as drawn: [text, bold, italic, font-size px] per span. */
const runsShown = (page: Page) =>
  page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line > span').evaluateAll((spans) =>
    spans.map((s) => {
      const cs = getComputedStyle(s);
      return [s.textContent, cs.fontWeight === '700', cs.fontStyle === 'italic', Math.round(parseFloat(cs.fontSize))];
    }),
  );
/** Start and end of the line: Home/End elsewhere; on a Mac they scroll instead, so ⌘← / ⌘→. */
const MAC = process.platform === 'darwin';
const lineStart = (page: Page) => page.keyboard.press(MAC ? 'Meta+ArrowLeft' : 'Home');
const lineEnd = (page: Page) => page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End');

/**
 * Keyboard selection, then a beat (as a person leaves between keys) so the
 * browser has delivered its selection change before the next action.
 */
async function selectChars(page: Page, key: 'Shift+ArrowLeft' | 'Shift+ArrowRight', n: number) {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await page.waitForTimeout(50);
}

const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as Record<string, any>).__doc.history.undoLabel);

test('formats only the selected words; the panel shows Mixed for a mixed selection', async ({ page }) => {
  await newBox(page, 'Hello world');
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await selectChars(page, 'Shift+ArrowLeft', 5);
  await panel.getByRole('button', { name: 'Bold' }).click();
  // Focus stays in the text (so you can keep typing).
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
  await expect.poll(() => runsShown(page)).toEqual([['Hello ', false, false, expect.any(Number)], ['world', true, false, expect.any(Number)]]);
  await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'mixed');
  // Size on part of the text: Mixed in the size field.
  await lineStart(page);
  await selectChars(page, 'Shift+ArrowRight', 5);
  await panel.getByRole('button', { name: 'Larger' }).click();
  await panel.getByRole('button', { name: 'Larger' }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(panel.getByLabel('Size (pt)')).toHaveAttribute('placeholder', 'Mixed');
  await page.keyboard.press('Escape');
  expect(await undoLabel(page)).toBe('Add text');
  const shown = await runsShown(page);
  expect(shown.map((r) => r[0]).join('')).toBe('Hello world');
  expect(shown[0][3]).toBeGreaterThan(shown[shown.length - 1][3] as number);
});

test('a format chosen at the caret applies to what is typed next (typing style)', async ({ page }) => {
  await newBox(page, 'Plain');
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Italic' }).click();
  await expect(panel.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type(' slanted');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' both');
  await expect.poll(() => runsShown(page)).toEqual([
    ['Plain', false, false, expect.any(Number)],
    [' slanted', false, true, expect.any(Number)],
    [' both', true, true, expect.any(Number)],
  ]);
  // Enter keeps the typing style on the new line.
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  await expect.poll(async () => (await runsShown(page)).at(-1)).toEqual(['next', true, true, expect.any(Number)]);
});

test('paste is plain text (formatting from other apps is dropped); copying between our boxes keeps it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const editor = await newBox(page, 'Start ');
  // From another app: HTML with bold and a link. Only the text arrives, in the typing style.
  await page.evaluate(async () => {
    const html = new Blob(['<b>Bold</b> <a href="https://evil.example">link</a><script>alert(1)</script>'], { type: 'text/html' });
    const text = new Blob(['Bold link'], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
  });
  await page.keyboard.press('ControlOrMeta+v');
  await expect(editor).toHaveText('Start Bold link');
  expect(await editor.evaluate((el) => el.querySelectorAll('b, a, script, [href]').length)).toBe(0);
  await expect.poll(() => runsShown(page)).toEqual([['Start Bold link', false, false, expect.any(Number)]]);
  // Writing the clipboard above briefly took focus from the editor. ProseMirror treats a caret
  // at the very start within 200 ms of focus as the browser resetting it, and puts it back.
  await page.waitForTimeout(250);

  // Inside our boxes: make "Bold" bold, copy it, paste at the end: it stays bold.
  await lineStart(page);
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await selectChars(page, 'Shift+ArrowRight', 4);
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.press('ControlOrMeta+c');
  await lineEnd(page);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(editor).toHaveText('Start Bold linkBold');
  await expect.poll(async () => (await runsShown(page)).at(-1)).toEqual(['Bold', true, false, expect.any(Number)]);
});

test('undo inside an editing session goes step by step; the session is one undo step in the document', async ({ page }) => {
  const editor = await newBox(page, 'First');
  await page.keyboard.press('Escape');
  expect(await undoLabel(page)).toBe('Add text');
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').dblclick();
  await expect(editor).toBeFocused();
  await lineEnd(page);
  await page.keyboard.type(' second');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+u');
  await page.keyboard.press('ControlOrMeta+z'); // undoes the underline only
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .bar')).toHaveCount(0);
  await expect(editor).toHaveText('First second');
  await page.keyboard.press('ControlOrMeta+z'); // then the typing
  await expect(editor).toHaveText('First');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveText('First second');
  await page.keyboard.press('Escape');
  expect(await undoLabel(page)).toBe('Edit text');
  // One undo in the document brings back the box as it was before the session.
  await page.evaluate(() => (window as unknown as Record<string, any>).__doc.undo());
  await expect.poll(async () => (await runsShown(page)).map((r) => r[0]).join('')).toBe('First');
});

test('input methods (IME): the text being composed shows, then lands in the box', async ({ page }) => {
  const editor = await newBox(page, 'Abc ');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ć', selectionStart: 1, selectionEnd: 1 });
  // While composing, the surface's own text is visible (with the input method's marking), the box's is hidden.
  await expect(page.locator('.rich-editor')).toHaveClass(/composing/);
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .text')).toHaveCSS('visibility', 'hidden');
  await cdp.send('Input.imeSetComposition', { text: 'ćč', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: 'ćč' });
  await expect(page.locator('.rich-editor')).not.toHaveClass(/composing/);
  await expect(editor).toHaveText('Abc ćč');
  await expect.poll(() => runsShown(page)).toEqual([['Abc ćč', false, false, expect.any(Number)]]);
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .text')).toHaveCSS('visibility', 'visible');
});
