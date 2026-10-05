// Submenus in the menu bar: hover intent (safe triangle, close delay) and keyboard.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

async function openEditor(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
}

/** A menu item by the start of its name (names end with the shortcut, e.g. "Print… ⌘P"). */
const item = (page: Page, name: string) => page.getByRole('menuitem', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

const center = async (page: Page, name: string) => {
  const box = (await item(page, name).boundingBox())!;
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Move like a hand: small steps, a frame apart. */
async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
    await page.waitForTimeout(16);
  }
}

async function hoverExportAs(page: Page) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  const exportAs = await center(page, 'Export as');
  const start = { x: exportAs.box.x + 24, y: exportAs.y };
  await page.mouse.move(start.x, start.y);
  await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
  return start;
}

test.beforeEach(async ({ page }) => openEditor(page));

test('moving diagonally from "Export as" over "Print…" to "Compress PDF…" keeps the submenu open', async ({ page }) => {
  const start = await hoverExportAs(page);
  const print = await center(page, 'Print…');
  const compress = await center(page, 'Compress PDF…');
  // Down and right across "Print…", then up into the submenu.
  const overPrint = { x: print.box.x + print.box.width - 12, y: print.y };
  await glide(page, start, overPrint);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role=menuitem]')?.textContent, [overPrint.x, overPrint.y])).toContain('Print');
  await glide(page, overPrint, compress, 4);
  await page.waitForTimeout(400);
  await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
  await page.mouse.click(compress.x, compress.y);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Properties' })).toContainText('Compress');
});

test('there is no dead gap between the parent item and the submenu', async ({ page }) => {
  await hoverExportAs(page);
  const parent = (await page.getByRole('menuitem', { name: 'Export as' }).boundingBox())!;
  const sub = (await page.getByRole('menu', { name: 'Export as' }).boundingBox())!;
  const y = parent.y + parent.height / 2;
  // Every pixel from the parent item's right edge to the submenu belongs to one or the other.
  for (let x = Math.floor(parent.x + parent.width) - 4; x <= Math.ceil(sub.x) + 1; x++) {
    const inside = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.has-sub'), [x, y]);
    expect(inside, `x = ${x}`).toBe(true);
  }
});

test('moving away from the submenu closes it', async ({ page }) => {
  const start = await hoverExportAs(page);
  // Straight down onto "Print…" and resting there: not heading for the submenu.
  const print = await center(page, 'Print…');
  await glide(page, start, { x: start.x, y: print.y });
  await page.waitForTimeout(500);
  await expect(page.getByRole('menu', { name: 'Export as' })).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();

  // And leaving the menu entirely.
  await page.mouse.move(start.x, start.y);
  await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
  await glide(page, start, { x: start.x - 10, y: 700 });
  await page.waitForTimeout(400);
  await expect(page.getByRole('menu', { name: 'Export as' })).toHaveCount(0);
});

test('keyboard: Right opens and focuses, Up/Down move, Left and Escape return, Enter activates', async ({ page }) => {
  const file = page.getByRole('menuitem', { name: 'File', exact: true });
  await file.focus();
  await page.keyboard.press('Enter');
  const exportAs = page.getByRole('menuitem', { name: 'Export as' });
  // New blank PDF…, Open…, Create PDF from images…, Save, Save a copy…, Export as
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await expect(exportAs).toBeFocused();
  await expect(exportAs).toHaveAttribute('aria-haspopup', 'menu');
  await expect(exportAs).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
  await expect(exportAs).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'Compress PDF…' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Images (JPG / PNG)…' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Compress PDF…' })).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menu', { name: 'Export as' })).toHaveCount(0);
  await expect(exportAs).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Export as' })).toHaveCount(0);
  await expect(exportAs).toBeFocused();
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Compress PDF…' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Properties' })).toContainText('Compress');
});

test('clicking the parent item opens the submenu and keeps it open', async ({ page }) => {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export as' }).click();
  const print = await center(page, 'Print…');
  await page.mouse.move(print.x - 60, print.y);
  await page.waitForTimeout(500);
  await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible();
});
