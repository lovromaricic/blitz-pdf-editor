// Cropping an inserted image: crop mode by double-click, the panel and the
// context menu; handles, moving the image under the frame, apply and cancel,
// moving and turning the cropped image, uncropping, Reset crop, undo/redo,
// and the keyboard.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

/** A blank page, at 100%, with a 400 × 300 px image: left half red, right half blue. */
async function open(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'crop.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(1);
    w.__viewer.goToPage(0);
    const c = new OffscreenCanvas(400, 300);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(200, 0, 200, 300);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await w.__actions.insertImageFiles([new File([blob], 'halves.png', { type: 'image/png' })]);
  });
  // Until the view has stopped moving.
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
  await page.waitForTimeout(200);
}

const image = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.find((a: { type: string }) => a.type === 'image'));
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.history.undoLabel as string | null);
const upright = (a: { rect: number[]; rotate: number }) => (a.rotate % 180 === 0 ? [a.rect[2] - a.rect[0], a.rect[3] - a.rect[1]] : [a.rect[3] - a.rect[1], a.rect[2] - a.rect[0]]);

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}
const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The color on screen at a point (from a screenshot). */
async function colorAt(page: Page, x: number, y: number) {
  const shot = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(1, 1);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, shot.toString('base64'));
}
const isRed = (c: number[]) => c[0] > 200 && c[2] < 60;
const isBlue = (c: number[]) => c[2] > 200 && c[0] < 60;

test('crop with the handles and by moving the image, apply, move and turn, uncrop, Reset crop, undo and redo', async ({ page }) => {
  await open(page);
  const box = page.locator('.box-hit[data-kind="image"]');
  const before = await image(page);
  const b0 = (await box.boundingBox())!;

  // Double-click: crop mode, the frame has focus.
  await box.dblclick();
  const frame = page.locator('.crop-mode .frame');
  await expect(frame).toBeFocused();
  await expect(page.getByRole('button', { name: 'Apply crop' })).toBeVisible();
  await expect(page.getByText('Crops become permanent when you save the PDF.').first()).toBeVisible();
  // Nothing has changed in the document yet.
  expect(await image(page)).toEqual(before);

  // The right handle to the middle: the left half.
  const right = page.locator('.crop-mode [data-handle="right"]');
  await dragBy(page, center((await right.boundingBox())!), -b0.width / 2, 0);
  let f = (await frame.boundingBox())!;
  expect(Math.abs(f.width - b0.width / 2)).toBeLessThan(2);
  // The image moved a quarter to the left under the still frame: the middle of the image.
  await dragBy(page, center(f), -b0.width / 4, 0);
  const f2 = (await frame.boundingBox())!;
  expect(Math.abs(f2.x - f.x)).toBeLessThan(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.crop-mode')).toHaveCount(0);

  let a = await image(page);
  expect(a.crop[0]).toBeCloseTo(0.25, 2);
  expect(a.crop[2]).toBeCloseTo(0.75, 2);
  expect(a.crop[1]).toBe(0);
  expect(a.crop[3]).toBe(1);
  expect(await undoLabel(page)).toBe('Crop');
  // Same scale, same place: half as wide, its left edge where it was.
  expect(upright(a)[0]).toBeCloseTo(upright(before)[0] / 2, 0);
  expect(a.rect[0]).toBeCloseTo(before.rect[0], 0);
  // On screen: red on the left, blue on the right (the middle of the image).
  let b = (await box.boundingBox())!;
  expect(isRed(await colorAt(page, b.x + b.width * 0.2, b.y + b.height / 2))).toBe(true);
  expect(isBlue(await colorAt(page, b.x + b.width * 0.8, b.y + b.height / 2))).toBe(true);
  // The panel shows the cropped size.
  const mm = (pt: number) => Math.round((pt / (72 / 25.4)) * 10) / 10;
  await expect(page.locator('#img-w')).toHaveValue(String(mm(upright(a)[0])));

  // Move it and turn it: it's the cropped image that moves.
  await dragBy(page, center(b), 40, 30);
  const moved = await image(page);
  expect(moved.rect[0] - a.rect[0]).toBeCloseTo(30, 0);
  expect(moved.crop).toEqual(a.crop);
  await page.locator('#img-angle').fill('30');
  await page.locator('#img-angle').press('Enter');
  await expect.poll(async () => (await image(page)).angle).toBe(30);

  // Back to crop mode from the panel: the whole image shows around the frame.
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(frame).toBeFocused();
  const whole = (await page.locator('.crop-mode .image').boundingBox())!;
  f = (await frame.boundingBox())!;
  expect(whole.width).toBeGreaterThan(f.width * 1.5);
  // Uncrop outward: the left handle far out stops at the image's edge.
  const left = page.locator('.crop-mode [data-handle="left"]');
  await dragBy(page, center((await left.boundingBox())!), -600, 0);
  await page.keyboard.press('Enter');
  a = await image(page);
  expect(a.crop[0]).toBeCloseTo(0, 3);
  expect(a.crop[2]).toBeCloseTo(0.75, 2);
  expect(a.angle).toBe(30);

  // Reset crop (panel): the whole image, one undo step.
  await page.getByRole('button', { name: 'Reset crop' }).click();
  a = await image(page);
  expect(a.crop).toBeUndefined();
  expect(upright(a)[0]).toBeCloseTo(upright(before)[0], 0);
  expect(await undoLabel(page)).toBe('Reset crop');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await image(page)).crop[2]).toBeCloseTo(0.75, 2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect((await image(page)).crop).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  // Before the uncrop: the middle again.
  expect((await image(page)).crop[0]).toBeCloseTo(0.25, 2);
});

test('Escape cancels; a crop of the whole image is no crop; the context menu and the keyboard', async ({ page }) => {
  await open(page);
  const box = page.locator('.box-hit[data-kind="image"]');
  const before = await image(page);
  const label = await undoLabel(page);

  // Escape: nothing changes, no undo step.
  await box.dblclick();
  const right = page.locator('.crop-mode [data-handle="right"]');
  await dragBy(page, center((await right.boundingBox())!), -80, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.crop-mode')).toHaveCount(0);
  expect(await image(page)).toEqual(before);
  expect(await undoLabel(page)).toBe(label);
  await expect(box).toBeFocused();

  // Entered and applied without a change: no crop, no step.
  await box.dblclick();
  await page.keyboard.press('Enter');
  expect(await image(page)).toEqual(before);
  expect(await undoLabel(page)).toBe(label);

  // Context menu › Crop…
  await box.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Crop…' }).click();
  const frame = page.locator('.crop-mode .frame');
  await expect(frame).toBeFocused();
  // Alt+arrows resize from the bottom-right; the size is announced.
  for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+Shift+ArrowLeft');
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText(/^Crop \d+ by 300 pixels$/);
  // Arrows move the image under the frame.
  await page.keyboard.press('Shift+ArrowLeft');
  // Tab goes to the panel's crop controls.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'Free' })).toBeFocused();
  // 1:1 from the panel, then apply with the button.
  await page.getByRole('radio', { name: '1:1' }).check();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  const a = await image(page);
  const [w, h] = upright(a);
  expect(w).toBeCloseTo(h, 0);
  expect(a.crop[0]).toBeGreaterThan(0);

  // Duplicate keeps the crop and the original.
  await page.keyboard.press('ControlOrMeta+d');
  const all = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots);
  expect(all).toHaveLength(2);
  expect(all[1].crop).toEqual(all[0].crop);
  expect(all[1].imageKey).toBe(all[0].imageKey);

  // A click on the page outside the image applies.
  await box.last().dblclick();
  await expect(page.locator('.crop-mode')).toHaveCount(1);
  const r = page.locator('.crop-mode [data-handle="right"]');
  await dragBy(page, center((await r.boundingBox())!), -30, 0);
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 20, pg.y + pg.height - 40);
  await expect(page.locator('.crop-mode')).toHaveCount(0);
  expect(await undoLabel(page)).toBe('Crop');
});
