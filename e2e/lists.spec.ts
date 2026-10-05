// Lists while typing in a text box: keys, autoformat, the panel's List row, links and bold in items.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

async function newBox(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'lists.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.waitForTimeout(400);
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 60, pg.y + 120);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused({ timeout: 15000 });
  return editor;
}

/** The box's paragraphs as list kind, level and text (from the editing surface's model, via the DOM). */
const items = (page: Page) =>
  page.locator('.rich-surface p').evaluateAll((ps) => ps.map((p) => `${(p as HTMLElement).dataset.list ?? '-'}${(p as HTMLElement).dataset.level ?? 0}:${p.textContent}`));
const saved = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__doc.pages[0].annots[0].paragraphs.map((p: { list?: string; level?: number; runs: { text: string }[] }) => `${p.list ?? '-'}${p.level ?? 0}:${p.runs.map((r) => r.text).join('')}`));
const live = (page: Page) => page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)');
const markers = (page: Page) => page.locator('.page[data-index="0"] .boxed[data-kind="text"] svg.markers > *');

test('a three-level mixed list made with the keyboard: autoformat, Enter, Tab, Shift+Tab, Enter on empty', async ({ page }) => {
  await newBox(page);
  await page.keyboard.type('Shopping');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. ');
  await expect(live(page)).toHaveText('Numbered list');
  await page.keyboard.type('Fruit');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(live(page)).toHaveText('Level 2');
  await page.keyboard.type('Apples');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Pears');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Ripe Čačić');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(live(page)).toHaveText('Level 1');
  await page.keyboard.type('Bread');
  // Bullets inside: Cmd/Ctrl+Shift+8 on a new item one level in.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+Shift+8');
  await page.keyboard.type('Rye');
  // Enter on an empty item steps out: level 1 → 0 → plain paragraph.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Done');
  expect(await items(page)).toEqual([
    '-0:Shopping',
    'number0:Fruit',
    'number1:Apples',
    'number1:Pears',
    'number2:Ripe Čačić',
    'number0:Bread',
    'bullet1:Rye',
    '-0:Done',
  ]);
  // Markers drawn on the box: 1. a. b. i. 2. as text, and Rye (a level-1 bullet) as a hollow circle.
  await expect(markers(page)).toHaveCount(6);
  const texts = await page.locator('.page[data-index="0"] svg.markers text').allTextContents();
  expect(texts).toEqual(['1.', 'a.', 'b.', 'i.', '2.']);
  await expect(page.locator('.page[data-index="0"] svg.markers circle')).toHaveCount(1);
  // Screen readers: list items with levels.
  await expect(page.locator('.rich-surface p[role="listitem"]')).toHaveCount(6);
  await expect(page.locator('.rich-surface p[role="listitem"][aria-level="3"]')).toHaveCount(1);
  // Tab outside a list item moves on to the panel; Escape ends editing (never trapped).
  await page.keyboard.press('Tab');
  await expect(page.locator('#tx-font')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeHidden();
  expect(await saved(page)).toEqual(['-0:Shopping', 'number0:Fruit', 'number1:Apples', 'number1:Pears', 'number2:Ripe Čačić', 'number0:Bread', 'bullet1:Rye', '-0:Done']);
});

test('autoformat "- " is one undo step; Backspace at the start removes the marker, then merges', async ({ page }) => {
  await newBox(page);
  await page.keyboard.type('Intro');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- ');
  expect(await items(page)).toEqual(['-0:Intro', 'bullet0:']);
  // Undo right after: the typed characters come back (one step); redo makes the item again.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => items(page)).toEqual(['-0:Intro', '-0:- ']);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => items(page)).toEqual(['-0:Intro', 'bullet0:']);
  await page.keyboard.type('Item');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  expect(await items(page)).toEqual(['-0:Intro', '-0:Item']);
  await page.keyboard.press('Backspace');
  expect(await items(page)).toEqual(['-0:IntroItem']);
});

test('the panel List row: toggle off and on, switch type, Mixed, indent limits, the alignment note, justify', async ({ page }) => {
  await newBox(page);
  await page.keyboard.type('One two three four five six seven eight nine ten eleven twelve thirteen');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  const panel = page.getByRole('complementary', { name: 'Properties' });
  const bullets = panel.getByRole('button', { name: 'Bulleted list' });
  const numbers = panel.getByRole('button', { name: 'Numbered list' });
  const more = panel.getByRole('button', { name: 'Increase indent' });
  const less = panel.getByRole('button', { name: 'Decrease indent' });
  await expect(bullets).toHaveAttribute('title', /^Bulleted list \((⇧⌘8|Ctrl\+Shift\+8)\)$/);
  await expect(more).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+a');
  await bullets.click();
  await expect(bullets).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
  expect(await items(page)).toEqual(['bullet0:One two three four five six seven eight nine ten eleven twelve thirteen', 'bullet0:Second']);
  await expect(less).toBeDisabled();
  await more.click();
  await more.click();
  await expect(more).toBeDisabled();
  await bullets.click(); // off
  expect(await items(page)).toEqual(['-0:One two three four five six seven eight nine ten eleven twelve thirteen', '-0:Second']);
  await bullets.click(); // on again
  await numbers.click(); // switch type
  expect(await items(page)).toEqual(['number0:One two three four five six seven eight nine ten eleven twelve thirteen', 'number0:Second']);
  // Mixed: only the second paragraph back to plain, then select both.
  await page.keyboard.press('ArrowDown');
  await numbers.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(numbers).toHaveAttribute('aria-pressed', 'mixed');
  // Centered box: the list stays left, and the panel says so.
  await panel.getByRole('radio', { name: 'Align center' }).click();
  await expect(panel.getByText('Lists stay left-aligned.')).toBeVisible();
  const firstLine = page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line').first();
  const lastLine = page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line').last();
  const pad = (l: typeof firstLine) => l.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(await pad(lastLine)).toBeGreaterThan(await pad(firstLine)); // the plain paragraph is centered
  // Justified: the item's wrapped lines spread (word spacing), its last line doesn't.
  await panel.getByRole('radio', { name: 'Justify' }).click();
  await expect(panel.getByText('Lists stay left-aligned.')).toBeHidden();
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line').first().locator('span[style*="word-spacing"]')).toHaveCount(1);
});

test('a link and a bold word inside an item; the edit field matches the box (indent)', async ({ page }) => {
  await newBox(page);
  await page.keyboard.type('* Visit example.com and bold');
  await page.keyboard.press('Shift+ArrowLeft');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(50);
  await page.keyboard.press('ControlOrMeta+b');
  expect(await items(page)).toEqual(['bullet0:Visit example.com and bold']);
  await expect(page.locator('.rich-surface [data-link]')).toHaveText('example.com');
  await expect(page.locator('.rich-surface [data-bold]')).toHaveText('bold');
  // The edit field's text starts where the box draws it (hanging indent), within a pixel.
  const field = await page.locator('.rich-surface p').first().evaluate((p) => {
    const r = document.createRange();
    r.setStart(p.firstChild!.firstChild ?? p.firstChild!, 0);
    r.setEnd(p.firstChild!.firstChild ?? p.firstChild!, 1);
    return r.getBoundingClientRect().left;
  });
  const drawn = await page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line > span').first().evaluate((s) => {
    const r = document.createRange();
    r.setStart(s.firstChild!, 0);
    r.setEnd(s.firstChild!, 1);
    return r.getBoundingClientRect().left;
  });
  expect(Math.abs(field - drawn)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  // Saved with its link.
  const pdf = await page.evaluate(async () => {
    const w = window as unknown as W;
    const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
    const { loadPdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdfjs.ts' as string);
    const doc = await loadPdf(await writePdf(w.__doc, w.__doc.pages, 'preserve'));
    const pg = await doc.getPage(1);
    return {
      links: (await pg.getAnnotations()).filter((a: { subtype: string }) => a.subtype === 'Link').length,
      text: (await pg.getTextContent()).items.map((i: { str: string }) => i.str).join(''),
    };
  });
  expect(pdf.links).toBe(1);
  expect(pdf.text).toContain('Visit example.com and bold');
});

test('on a selected box (not being typed in) the List buttons apply to all its paragraphs, one undo step', async ({ page }) => {
  await newBox(page);
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Beta');
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').click();
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Numbered list' }).click();
  expect(await saved(page)).toEqual(['number0:Alpha', 'number0:Beta']);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe('Numbered list');
  await panel.getByRole('button', { name: 'Increase indent' }).click();
  expect(await saved(page)).toEqual(['number1:Alpha', 'number1:Beta']);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe('Increase indent');
  await expect(page.locator('.page[data-index="0"] svg.markers text')).toHaveText(['a.', 'b.']);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await saved(page)).toEqual(['-0:Alpha', '-0:Beta']);
});
