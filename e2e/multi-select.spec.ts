// Selecting several objects: Shift/Cmd+click, the marquee, Cmd/Ctrl+A on the
// page; moving, nudging and deleting them together; one page at a time.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

async function open(page: Page, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'multi.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.75);
    w.__viewer.goToPage(0);
  });
  await page.waitForTimeout(500);
}

/** Three stamps side by side (and one on page 2 when there is one). */
async function stamps(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as W;
    const add = (pageIndex: number, id: string, x: number, y: number) =>
      w.__actions.addAnnotation(w.__doc.pages[pageIndex].id, { id, type: 'stamp', label: id.toUpperCase(), color: [0.1, 0.35, 0.8], opacity: 1, rotate: 0, rect: [x, y, x + 110, y + 34] });
    add(0, 'a', 80, 640);
    add(0, 'b', 240, 640);
    add(0, 'c', 400, 640);
    if (w.__doc.pages.length > 1) add(1, 'z', 80, 640);
    w.__viewer.setTool('select');
  });
}

const obj = (page: Page, id: string) => page.locator(`[data-annot-id="${id}"]`);
const selected = (page: Page) => page.evaluate(() => (window as unknown as W).__viewer.objectSelection?.ids ?? []);
const rects = (page: Page) => page.evaluate(() => Object.fromEntries((window as unknown as W).__doc.pages[0].annots.map((a: { id: string; rect: number[] }) => [a.id, a.rect])));
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.history.undoLabel);
const live = (page: Page) => page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)');
const title = (page: Page) => page.getByRole('complementary', { name: 'Properties' }).locator('h2').first();

test('Shift+click selects several; they move, nudge and delete together, one undo step each', async ({ page }) => {
  await open(page);
  await stamps(page);
  await obj(page, 'a').click();
  await obj(page, 'b').click({ modifiers: ['Shift'] });
  await obj(page, 'c').click({ modifiers: ['ControlOrMeta'] });
  expect(await selected(page)).toEqual(['a', 'b', 'c']);
  await expect(live(page)).toHaveText('3 objects selected');
  await expect(title(page)).toHaveText('3 objects');
  // One dashed box, each object lightly outlined, no resize handles.
  await expect(page.locator('.page[data-index="0"] .sel-box.block')).toHaveCount(1);
  await expect(page.locator('.page[data-index="0"] .member-box')).toHaveCount(3);
  await expect(page.locator('.page[data-index="0"] .handle')).toHaveCount(0);
  // Shift+click again takes one out.
  await obj(page, 'b').click({ modifiers: ['Shift'] });
  expect(await selected(page)).toEqual(['a', 'c']);
  await obj(page, 'b').click({ modifiers: ['Shift'] });

  // Drag one: all three move by the same amount.
  const before = await rects(page);
  const b = (await obj(page, 'b').boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y - 90, { steps: 5 });
  await page.mouse.up();
  const after = await rects(page);
  const dy = after.a[1] - before.a[1];
  expect(dy).toBeGreaterThan(50);
  for (const id of ['b', 'c']) expect(after[id][1] - before[id][1]).toBeCloseTo(dy, 1);
  expect(after.a[0]).toBe(before.a[0]);
  expect(await undoLabel(page)).toBe('Move 3 objects');

  // Dragged far left: the whole group stops at the page edge (the left one at x = 0).
  await page.mouse.move(b.x + 20, b.y - 80);
  await page.mouse.down();
  await page.mouse.move(b.x - 900, b.y - 80, { steps: 6 });
  await page.mouse.up();
  const edge = await rects(page);
  expect(edge.a[0]).toBeCloseTo(0, 0);
  expect(edge.c[0] - edge.a[0]).toBeCloseTo(320, 0);

  // Arrow keys nudge all of them.
  await obj(page, 'b').focus();
  await page.keyboard.press('Shift+ArrowRight');
  const nudged = await rects(page);
  for (const id of ['a', 'b', 'c']) expect(nudged[id][0]).toBeGreaterThan(edge[id][0]);
  expect((await selected(page)).sort()).toEqual(['a', 'b', 'c']);

  // Delete removes all three: one step.
  await page.keyboard.press('Delete');
  await expect(page.locator('.page[data-index="0"] .box-hit')).toHaveCount(0);
  expect(await undoLabel(page)).toBe('Delete 3 objects');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.page[data-index="0"] .box-hit')).toHaveCount(3);
});

test('the marquee selects what it touches; Shift adds; an empty drag clears; Cmd/Ctrl+A and Escape', async ({ page }) => {
  await open(page);
  await stamps(page);
  const a = (await obj(page, 'a').boundingBox())!;
  const b = (await obj(page, 'b').boundingBox())!;
  const c = (await obj(page, 'c').boundingBox())!;
  // From blank paper above, across a and b.
  await page.mouse.move(a.x - 10, a.y - 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y + 10, { steps: 6 });
  await expect(page.locator('.page[data-index="0"] .marquee')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.page[data-index="0"] .marquee')).toHaveCount(0);
  expect(await selected(page)).toEqual(['a', 'b']);
  // Shift+drag adds c.
  await page.keyboard.down('Shift');
  await page.mouse.move(c.x + c.width + 10, c.y - 40);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width - 10, c.y + 10, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await selected(page)).toEqual(['a', 'b', 'c']);
  // A drag over nothing clears the selection.
  await page.mouse.move(a.x, a.y + 150);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 200, { steps: 4 });
  await page.mouse.up();
  expect(await selected(page)).toEqual([]);

  // Cmd/Ctrl+A on the page: all its objects; Escape clears.
  await page.locator('#document-view').focus();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selected(page)).toEqual(['a', 'b', 'c']);
  await expect(live(page)).toHaveText('3 objects selected');
  expect(await page.evaluate(() => (window as unknown as W).__viewer.selection.size)).toBe(0); // not the pages
  await page.keyboard.press('Escape');
  expect(await selected(page)).toEqual([]);
});

test('one page at a time: Shift+click on another page leaves the selection and says so', async ({ page }) => {
  await open(page, 2);
  await stamps(page);
  await obj(page, 'a').click();
  await obj(page, 'b').click({ modifiers: ['Shift'] });
  await obj(page, 'z').scrollIntoViewIfNeeded();
  await obj(page, 'z').click({ modifiers: ['Shift'] });
  await expect(page.getByText('You can only select objects on one page at a time.')).toBeVisible();
  expect(await selected(page)).toEqual(['a', 'b']);
});

test('several objects of one kind share their panel controls, Mixed where they differ', async ({ page }) => {
  await open(page);
  await stamps(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    const a = w.__doc.pages[0].annots[0];
    w.__actions.updateAnnotation(w.__doc.pages[0].id, { ...a, opacity: 0.5 }, 'Change opacity');
  });
  await page.locator('#document-view').focus();
  await page.keyboard.press('ControlOrMeta+a');
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await expect(panel.getByText('Mixed')).toBeVisible();
  await panel.getByRole('radiogroup', { name: 'Color' }).getByRole('radio', { name: 'Red' }).click();
  const colors = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.map((a: { color: number[] }) => a.color.join(',')));
  expect(new Set(colors).size).toBe(1);
  expect(await undoLabel(page)).toBe('Color');
});
