// A click on the gray background around and between the pages is a click on
// an empty spot: the selection goes (objects, groups, Edit content), the page
// selection stays, a text box being typed in finishes. The toolbar and the
// panel don't deselect; a drag on the background draws a marquee.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';

type W = Record<string, any>;

async function open(page: Page, bytes: Uint8Array, name = 'two.pdf') {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}

async function twoPages(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  await open(page, await doc.save());
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.5);
    const pid = w.__doc.pages[0].id;
    w.__actions.addAnnotation(pid, { id: 'tb', type: 'text', text: 'Hello', font: 'arimo', size: 14, color: [0, 0, 0], opacity: 1, rotate: 0, rect: [60, 200, 180, 225] });
    w.__actions.addAnnotation(pid, { id: 'st', type: 'stamp', label: 'OK', color: [0.1, 0.35, 0.8], opacity: 1, rotate: 0, rect: [40, 60, 120, 90] });
    w.__viewer.setTool('select');
  });
  await settle(page);
}

const selection = (page: Page) => page.evaluate(() => (window as unknown as W).__viewer.objectSelection);
const panelTitle = (page: Page) => page.getByRole('complementary', { name: 'Properties' }).locator('h2').first();
const box = async (page: Page, i: number) => (await page.locator(`.page[data-index="${i}"]`).boundingBox())!;

async function selectText(page: Page) {
  await page.locator('[data-annot-id="tb"]').click();
  expect((await selection(page))?.ids).toEqual(['tb']);
  await expect(panelTitle(page)).toHaveText('Text');
}

test('clicks on the gray background around and between the pages deselect, like the empty page', async ({ page }) => {
  await twoPages(page);
  const p0 = await box(page, 0);
  const p1 = await box(page, 1);
  const spots = {
    'left of the page': { x: p0.x - 20, y: p0.y + p0.height / 2 },
    'right of the page': { x: p0.x + p0.width + 20, y: p0.y + p0.height / 2 },
    'above the first page': { x: p0.x + 10, y: p0.y - 8 },
    'between the pages': { x: p0.x + p0.width / 3, y: (p0.y + p0.height + p1.y) / 2 },
    'below the last page': { x: p1.x + 10, y: p1.y + p1.height + 10 },
  };
  for (const [where, at] of Object.entries(spots)) {
    await selectText(page);
    await page.mouse.click(at.x, at.y);
    expect(await selection(page), where).toBeNull();
    await expect(panelTitle(page), where).toHaveText('Document');
  }
  // A group goes too.
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__viewer.selectObjects({ pageId: w.__doc.pages[0].id, ids: ['tb', 'st'] });
    w.__actions.groupSelection();
  });
  expect((await selection(page))?.ids[0]).toMatch(/^group-/);
  await page.mouse.click(spots['left of the page'].x, spots['left of the page'].y);
  expect(await selection(page)).toBeNull();
  // Pages selected in the thumbnail rail stay selected.
  await page.getByRole('button', { name: 'Page 2' }).click();
  const pages = () => page.evaluate(() => [...(window as unknown as W).__viewer.selection]);
  const chosen = await pages();
  expect(chosen).toHaveLength(1);
  await page.mouse.click(spots['right of the page'].x, spots['right of the page'].y);
  expect(await pages()).toEqual(chosen);
  // No ring on the canvas after a click.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('document-view')!).outlineStyle)).toBe('none');
});

test('the toolbar and the Properties panel don’t deselect', async ({ page }) => {
  await twoPages(page);
  await selectText(page);
  // The toolbar pill (not a tool: its own padding) and the panel.
  const pill = (await page.getByRole('toolbar', { name: 'Editing tools' }).boundingBox())!;
  await page.mouse.click(pill.x + 3, pill.y + pill.height / 2);
  expect((await selection(page))?.ids).toEqual(['tb']);
  await page.getByRole('complementary', { name: 'Properties' }).getByText('Font', { exact: true }).click();
  expect((await selection(page))?.ids).toEqual(['tb']);
});

test('a text box being typed in finishes as one undo step', async ({ page }) => {
  await twoPages(page);
  await page.locator('[data-annot-id="tb"]').dblclick();
  await expect(page.locator('.rich-editor')).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type(' world');
  const p0 = await box(page, 0);
  await page.mouse.click(p0.x - 20, p0.y + p0.height / 2);
  await expect(page.locator('.rich-editor')).toHaveCount(0);
  const s = await page.evaluate(() => {
    const w = window as unknown as W;
    return { text: w.__doc.pages[0].annots.find((a: { id: string }) => a.id === 'tb').text, undo: w.__doc.history.undoLabel, sel: w.__viewer.objectSelection };
  });
  expect(s.text).toBe('Hello world');
  expect(s.undo).toBe('Edit text');
  expect(s.sel).toBeNull();
  // One step: undo goes back to "Hello".
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.find((a: { id: string }) => a.id === 'tb').text)).toBe('Hello');
});

test('a drag that starts on the background draws a marquee (it doesn’t just deselect)', async ({ page }) => {
  await twoPages(page);
  const p0 = await box(page, 0);
  const stamp = (await page.locator('[data-annot-id="st"]').boundingBox())!;
  // From left of the page, across the stamp.
  await page.mouse.move(p0.x - 20, stamp.y - 6);
  await page.mouse.down();
  await page.mouse.move(stamp.x + 20, stamp.y + stamp.height / 2, { steps: 4 });
  await expect(page.locator('.page[data-index="0"] .marquee')).toHaveCount(1);
  await page.mouse.move(stamp.x + stamp.width / 2, stamp.y + stamp.height + 6, { steps: 4 });
  await page.mouse.up();
  expect((await selection(page))?.ids).toEqual(['st']);
});

test('Edit content: a click on the background clears the selected original content', async ({ page }) => {
  await open(page, readFileSync('test-fixtures/content/chrome-article.pdf'), 'article.pdf');
  await settle(page);
  await page.keyboard.press('e');
  const block = page.locator('.page[data-index="0"] .content-hit').first();
  await block.click();
  await expect(block).toHaveClass(/selected/);
  const p0 = await box(page, 0);
  // Fitted to the width: the gap beside the page is 16 px.
  await page.mouse.click(p0.x - 8, p0.y + 200);
  expect(await page.evaluate(() => (window as unknown as W).__viewer.contentSelection)).toBeNull();
  // Chosen from the toolbar (the E key), the tool stays.
  expect(await page.evaluate(() => (window as unknown as W).__viewer.tool)).toBe('content');
});
