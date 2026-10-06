// Double-clicking the PDF's own content with the Select tool: text turns into
// a text box (caret where clicked), an image is selected, lines and shapes say
// they can't be edited. Our own objects keep their double-click. Escape or an
// empty spot goes back to Select; drag-selecting the PDF's text still works;
// the tip shows once.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type W = Record<string, any>;

async function open(page: Page, fixture: string) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: fixture, mimeType: 'application/pdf', buffer: readFileSync(`test-fixtures/content/${fixture}`) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    await (window as unknown as W).__viewer.setZoom(1);
    (window as unknown as W).__viewer.goToPage(0);
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
  await page.waitForTimeout(300);
}

const tool = (page: Page) => page.evaluate(() => (window as unknown as W).__viewer.tool as string);

/** A point of the page (PDF space, upright page at its scale) on screen. */
async function onScreen(page: Page, x: number, y: number) {
  const box = (await page.locator('.page[data-index="0"]').boundingBox())!;
  const { scale, h } = await page.evaluate(() => {
    const w = window as unknown as W;
    return { scale: w.__viewer.scale as number, h: w.__doc.pageBounds(w.__doc.pages[0])[3] as number };
  });
  return { x: box.x + x * scale, y: box.y + (h - y) * scale };
}

/** The first text span of the PDF's own text containing `text`. */
const span = (page: Page, text: string) => page.locator('.page[data-index="0"] .textLayer span:not(.markedContent)', { hasText: text }).first();

test('double-click the PDF’s text: Edit content, the block becomes a text box with the caret there; no word gets selected', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  expect(await tool(page)).toBe('select');
  const s = span(page, 'Volunteers will catalogue');
  const b = (await s.boundingBox())!;
  await page.mouse.dblclick(b.x + 40, b.y + b.height / 2);
  await expect(page.locator('.rich-editor')).toBeVisible();
  expect(await tool(page)).toBe('content');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText(/Editing content. Escape to go back|Text box ready to edit/);
  // Escape ends the (unchanged) edit: the original is back; Escape again goes back to Select.
  await page.keyboard.press('Escape');
  await expect(page.locator('.rich-editor')).toHaveCount(0);
  expect(await tool(page)).toBe('content');
  await page.keyboard.press('Escape');
  expect(await tool(page)).toBe('select');
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel ?? null)).toBeNull();
});

test('double-click an image selects it; an empty spot goes back to Select', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  // The image: its left part (the white disc is on the right).
  const q = await page.evaluate(async () => {
    const w = window as unknown as W;
    const p = w.__doc.pages[0];
    const a = await w.__viewer.content.whenReady(w.__doc.source(p), p.sourceIndex);
    return a.items.find((i: { kind: string }) => i.kind === 'image').quad as number[][];
  });
  const at = await onScreen(page, q[0][0] + 30, (q[0][1] + q[2][1]) / 2);
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('.content-hit.selected[data-kind="image"]')).toHaveCount(1);
  expect(await tool(page)).toBe('content');
  await expect(page.locator('.content-hit.selected')).toBeFocused();
  // Escape from the selected image: back to Select.
  await page.keyboard.press('Escape');
  expect(await tool(page)).toBe('select');
  // Again, and this time an empty spot goes back.
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('.content-hit.selected[data-kind="image"]')).toHaveCount(1);
  const empty = await onScreen(page, 540, 790);
  await page.mouse.click(empty.x, empty.y);
  expect(await tool(page)).toBe('select');
});

test('double-click a line of a table: the message, nothing changes', async ({ page }) => {
  await open(page, 'chrome-table-list.pdf');
  // A table border: a thin shape from the analysis (no text over it).
  const line = await page.evaluate(async () => {
    const w = window as unknown as W;
    const p = w.__doc.pages[0];
    const a = await w.__viewer.content.whenReady(w.__doc.source(p), p.sourceIndex);
    const thin = a.shapes.find((s: { box: number[] }) => s.box[3] - s.box[1] < 2 && s.box[2] - s.box[0] > 40);
    return [(thin.box[0] + thin.box[2]) / 2, (thin.box[1] + thin.box[3]) / 2];
  });
  const at = await onScreen(page, line[0], line[1]);
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByText('Shapes and lines from the original PDF can’t be edited yet.')).toBeVisible();
  expect(await tool(page)).toBe('select');
});

test('a scan says so on double-click', async ({ page }) => {
  await open(page, 'scanned.pdf');
  await page.locator('.page[data-index="0"]').dblclick({ position: { x: 200, y: 150 } });
  await expect(page.getByText('This page is a scan. There is no text to edit.').first()).toBeVisible();
  expect(await tool(page)).toBe('select');
});

test('our own objects keep their double-click: a text box edits, an image crops', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  await page.evaluate(async () => {
    const w = window as unknown as W;
    const pid = w.__doc.pages[0].id;
    w.__actions.addAnnotation(pid, { id: 'own-text', type: 'text', text: 'Mine', font: 'arimo', size: 14, color: [0, 0, 0], opacity: 1, rotate: 0, rect: [300, 520, 400, 545] });
    const c = new OffscreenCanvas(60, 40);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e33';
    ctx.fillRect(0, 0, 60, 40);
    await w.__actions.insertImageFiles([new File([await c.convertToBlob({ type: 'image/png' })], 'r.png', { type: 'image/png' })], { index: 0, point: [450, 300] });
    w.__viewer.setTool('select');
  });
  await page.locator('[data-annot-id="own-text"]').dblclick();
  await expect(page.locator('.rich-editor')).toBeVisible();
  expect(await tool(page)).toBe('select');
  await page.keyboard.press('Escape');
  await page.locator('.box-hit[data-kind="image"]').dblclick();
  await expect(page.locator('.crop-mode')).toHaveCount(1);
  expect(await tool(page)).toBe('select');
  await page.keyboard.press('Escape');
});

test('drag-selecting the PDF’s text still works; a single click does nothing', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  const s = span(page, 'Volunteers will catalogue');
  const b = (await s.boundingBox())!;
  await page.mouse.click(b.x + 10, b.y + b.height / 2);
  expect(await tool(page)).toBe('select');
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).length).toBeGreaterThan(5);
  expect(await tool(page)).toBe('select');
});

test('the tip shows once, after resting on the PDF’s text; any action hides it', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  const b = (await span(page, 'Volunteers will catalogue').boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.move(b.x + 22, b.y + b.height / 2);
  await expect(page.getByText('Double-click text or an image to edit it')).toBeVisible({ timeout: 3000 });
  await page.keyboard.press('Shift');
  await expect(page.getByText('Double-click text or an image to edit it')).toHaveCount(0);
  await page.mouse.move(b.x + 60, b.y + b.height / 2);
  await page.mouse.move(b.x + 62, b.y + b.height / 2);
  await page.waitForTimeout(1500);
  await expect(page.getByText('Double-click text or an image to edit it')).toHaveCount(0);
});

test('chosen from the toolbar, Edit content stays on an empty spot', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Edit content' }).click();
  expect(await tool(page)).toBe('content');
  const empty = await onScreen(page, 540, 790);
  await page.mouse.click(empty.x, empty.y);
  expect(await tool(page)).toBe('content');
});
