// Edit content: the keyboard (Tab in reading order, "Text block, 3 of 8",
// Enter edits, Delete deletes), the phone layout, and a 100-page file.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type W = Record<string, any>;

async function open(page: Page, fixture: string) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: fixture, mimeType: 'application/pdf', buffer: readFileSync(`test-fixtures/content/${fixture}`) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#editor-main')).toBeFocused();
}
const live = (page: Page) => page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)');

test('keyboard: Tab goes through the blocks in reading order, each announced; Enter edits, Delete deletes', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  await page.keyboard.press('e');
  await expect(page.locator('.page[data-index="0"] .content-hit')).toHaveCount(9);
  const order = await page.locator('.page[data-index="0"] .content-hit').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.slice(0, 24)));
  expect(order).toEqual([
    'Text block: Library Wing',
    'Text block: Prepared for',
    'Text block: The committe',
    'Text block: Volunteers w',
    'Image, 320 by 180 pixels',
    'Text block: Next steps',
    'Text block: Members agre',
    'Text block: The children',
    'Text block: Signed, the ',
  ]);
  // Into the page with Tab: the first block, announced.
  for (let i = 0; i < 30 && !(await page.evaluate(() => document.activeElement?.classList.contains('content-hit'))); i++) await page.keyboard.press('Tab');
  await expect(live(page)).toHaveText('Text block, 1 of 9');
  await page.keyboard.press('Tab');
  await expect(live(page)).toHaveText('Text block, 2 of 9');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(live(page)).toHaveText('Image, 5 of 9');
  await page.keyboard.press('Shift+Tab');
  await expect(live(page)).toHaveText('Text block, 4 of 9');
  // One ring: the focused block (no outline on the canvas around it).
  const outline = await page.evaluate(() => getComputedStyle(document.getElementById('document-view')!).outlineStyle);
  expect(outline).toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rich-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.rich-editor')).toHaveCount(0);
  await page.locator('.page[data-index="0"]').getByRole('button', { name: /^Text block: Next steps/ }).focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.page[data-index="0"] .content-hit')).toHaveCount(8);
});

test('phones: the tool in the strip, the tool’s own panel, a tap beside a block, tap to select, Edit from the sheet', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await open(page, 'chrome-table-list.pdf');
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Edit content' }).tap();
  await expect(page.getByText('Tap text or an image on the page to select it. Double-tap text to edit it.')).toBeVisible();
  // A tap just beside a block (within half a 44px target) still selects it.
  const heading = page.locator('.page[data-index="0"]').getByRole('button', { name: /^Text block: Budget summary$/ });
  const h = (await heading.boundingBox())!;
  await page.touchscreen.tap(h.x + h.width + 12, h.y + h.height / 2);
  await expect(heading).toHaveClass(/selected/);
  const para = page.locator('.page[data-index="0"]').getByRole('button', { name: /^Text block: Order the shelving/ });
  await para.scrollIntoViewIfNeeded();
  await para.tap();
  await expect(page.getByRole('heading', { name: 'Original text' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).tap();
  await expect(page.locator('.rich-editor')).toBeVisible();
  await context.close();
});

test('a 100-page file: a page far in is analyzed, a block deleted and another converted quickly', async ({ page }) => {
  test.setTimeout(120000);
  await open(page, 'long-100-pages.pdf');
  const times = await page.evaluate(async () => {
    const w = window as unknown as W;
    w.__viewer.setTool('content');
    w.__viewer.goToPage(49);
    const p = w.__doc.pages[49];
    let t = performance.now();
    const a = await w.__viewer.content.whenReady(w.__doc.source(p), p.sourceIndex);
    const analyze = performance.now() - t;
    const texts = a.items.filter((i: { kind: string }) => i.kind === 'text');
    w.__viewer.selectContent({ pageId: p.id, ids: [texts[1].id] });
    t = performance.now();
    await w.__actions.deleteContent();
    const del = performance.now() - t;
    const p2 = w.__doc.pages[49];
    const a2 = await w.__viewer.content.whenReady(w.__doc.source(p2), p2.sourceIndex);
    w.__viewer.selectContent({ pageId: p2.id, ids: [a2.items.find((i: { kind: string }) => i.kind === 'text').id] });
    t = performance.now();
    await w.__actions.editContent();
    const convert = performance.now() - t;
    return { analyze, del, convert, blocks: texts.length, undo: w.__doc.history.undoLabel };
  });
  console.log(`100 pages: analyze page 50 ${times.analyze.toFixed(0)} ms, delete ${times.del.toFixed(0)} ms, convert ${times.convert.toFixed(0)} ms`);
  expect(times.blocks).toBe(8);
  expect(times.undo).toBe('Edit text');
  expect(times.analyze).toBeLessThan(3000);
  expect(times.del).toBeLessThan(5000);
  expect(times.convert).toBeLessThan(5000);
});
