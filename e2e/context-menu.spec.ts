// The canvas context menu: right-click, keyboard (Shift+F10, Menu key), long
// press; its items run the same commands as the menus; it stays in the window.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

async function open(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.waitForTimeout(400); // the first fit-width zoom
}

/** A text box typed with the Text tool, then the Select tool. */
async function textBox(page: Page, text: string, size = 28) {
  // Red text: visible on the black rectangle when it's on top.
  await page.evaluate((size) => Object.assign((window as unknown as W).__viewer.toolProps.text, { size, color: [0.85, 0.15, 0.15] }), size);
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 60, pg.y + 120);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused({ timeout: 15000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  return page.locator('.page[data-index="0"] .box-hit[data-kind="text"]');
}

const objectMenu = (page: Page) => page.getByRole('menu', { name: 'Object actions' });
const ids = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.map((a: { type: string }) => a.type));

/** How many pixels in the region are not (near) black. */
async function nonBlack(page: Page, r: { x: number; y: number; width: number; height: number }) {
  const shot = (await page.screenshot({ clip: r })).toString('base64');
  return page.evaluate(async (shot) => {
    const img = new Image();
    img.src = `data:image/png;base64,${shot}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return n;
  }, shot);
}

test('right-click the text under a black rectangle, Bring to front: the text is above it', async ({ page }) => {
  await open(page);
  const text = await textBox(page, 'Layers and more layers');
  const tb = (await text.boundingBox())!;
  // A black rectangle over the left half of the text box, drawn with the Shapes tool.
  await page.evaluate(() => Object.assign((window as unknown as W).__viewer.toolProps.shapes, { shape: 'rect', color: [0, 0, 0], fill: [0, 0, 0], opacity: 1 }));
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.mouse.move(tb.x - 10, tb.y - 10);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height + 10, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  expect(await ids(page)).toEqual(['text', 'shape']);
  const covered = { x: tb.x + 4, y: tb.y + 4, width: tb.width / 2 - 12, height: tb.height - 8 };
  expect(await nonBlack(page, covered)).toBe(0);

  // Right-click the part of the text that shows: it's selected, and the menu offers to bring it up.
  await page.mouse.click(tb.x + tb.width * 0.8, tb.y + tb.height / 2, { button: 'right' });
  await expect(objectMenu(page)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Properties' }).locator('h2').first()).toHaveText('Text');
  await expect(objectMenu(page).getByRole('menuitem', { name: /^Send to back/ })).toHaveAttribute('aria-disabled', 'true');
  await objectMenu(page).getByRole('menuitem', { name: /^Bring to front/ }).click();
  await expect(objectMenu(page)).toBeHidden();

  expect(await ids(page)).toEqual(['shape', 'text']);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe('Bring to front');
  // The text (and its box) now covers the rectangle: the covered part isn't all black any more.
  await expect.poll(() => nonBlack(page, covered)).toBeGreaterThan(50);
  // Focus is back on the object, never on the canvas.
  await expect(text).toBeFocused();
});

test('keyboard: Shift+F10 opens it for the selected object; arrows skip disabled items; letters jump; Escape returns focus', async ({ page }) => {
  await open(page);
  const text = await textBox(page, 'Keys');
  await text.focus();
  await page.keyboard.press('Shift+F10');
  const menu = objectMenu(page);
  await expect(menu).toBeVisible();
  // Paste is disabled (nothing copied): Down from Copy skips it.
  await expect(menu.getByRole('menuitem', { name: /^Cut/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /^Copy/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /^Duplicate/ })).toBeFocused();
  // Only one object: all four order items are disabled and skipped too.
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /^Delete/ })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('d'); // Duplicate, then Delete
  await expect(menu.getByRole('menuitem', { name: /^Duplicate/ })).toBeFocused();
  await page.keyboard.press('d');
  await expect(menu.getByRole('menuitem', { name: /^Delete/ })).toBeFocused();
  // Exactly one focus ring: on the item.
  expect(await page.evaluate(() => document.querySelectorAll(':focus-visible').length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(text).toBeFocused();
  expect(await page.locator('#document-view').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');

  // The Menu key does the same; Enter runs the item (once).
  await page.keyboard.press('ContextMenu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // Duplicate
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await page.waitForTimeout(300);
  expect(await ids(page)).toEqual(['text', 'text']);
});

test('the menu stays inside the window near every edge', async ({ page }) => {
  await open(page);
  await textBox(page, 'Edge');
  const size = page.viewportSize()!;
  for (const [x, y] of [
    [2, 2],
    [size.width - 2, 2],
    [2, size.height - 2],
    [size.width - 2, size.height - 2],
    [size.width / 2, size.height - 40],
  ]) {
    await page.evaluate(
      ([x, y]) => {
        const w = window as unknown as W;
        const sel = w.__doc.pages[0].annots[0];
        w.__viewer.selectAnnot({ pageId: w.__doc.pages[0].id, id: sel.id });
        w.__viewer.contextMenu = { x, y, pageId: w.__doc.pages[0].id, objectId: sel.id, point: null };
      },
      [x, y],
    );
    const menu = objectMenu(page);
    await expect(menu).toBeVisible();
    const r = (await menu.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(size.width);
    expect(r.y + r.height).toBeLessThanOrEqual(size.height);
    // Flipped rather than squeezed: it opens to the left of / above a point near the far edges.
    if (x > size.width / 2 + 100) expect(r.x + r.width).toBeLessThanOrEqual(x + 1);
    if (y > size.height - 50) expect(r.y + r.height).toBeLessThanOrEqual(y + 1);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('an empty spot: Paste here puts the object at the cursor; scrolling closes the menu', async ({ page }) => {
  await open(page);
  const text = await textBox(page, 'Paste me');
  await text.click();
  await page.keyboard.press('ControlOrMeta+c');
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  // Inside the window, clear of the floating bars.
  const at = { x: pg.x + pg.width * 0.6, y: pg.y + 320 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Page actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Paste here' }).click();
  await expect(page.locator('.page[data-index="0"] .box-hit[data-kind="text"]')).toHaveCount(2);
  const pasted = (await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').last().boundingBox())!;
  expect(Math.abs(pasted.x + pasted.width / 2 - at.x)).toBeLessThan(2);
  expect(Math.abs(pasted.y + pasted.height / 2 - at.y)).toBeLessThan(2);

  await page.mouse.click(at.x, at.y + 120, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.mouse.wheel(0, 200);
  await expect(menu).toBeHidden();
});

test('while typing in a text box, right-click keeps the browser menu (spelling, editing)', async ({ page }) => {
  await open(page);
  const text = await textBox(page, 'Speling');
  await text.dblclick();
  const field = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(field).toBeFocused();
  const prevented = await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10, button: 2 });
    el.querySelector('p')!.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(field).toBeVisible();
});

test('touch: a long press on an object opens its menu', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  await open(page);
  const text = await textBox(page, 'Hold me');
  const b = (await text.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(800);
  await expect(objectMenu(page)).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(objectMenu(page)).toBeVisible();
  // Nothing moved.
  expect(await ids(page)).toEqual(['text']);
  await context.close();
});
