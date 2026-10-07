// View › Margin size › Custom…: one value for all four sides of every page.
// The guides follow what's typed, Apply sets it (and shows the margins),
// Cancel puts the guides back, out-of-range values are refused with the
// range, 0 is no margin, and pages of different sizes share one maximum.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;
const MM = 72 / 25.4;
const A4: [number, number] = [595.28, 841.89];
const A6: [number, number] = [297.64, 419.53];

async function open(page: Page, sizes: [number, number][] = [A4]) {
  const doc = await PDFDocument.create();
  for (const s of sizes) doc.addPage(s);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'm.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.75);
    w.__viewer.goToPage(0);
    w.__actions.addAnnotation(w.__doc.pages[0].id, { id: 'tb', type: 'text', text: 'Note', font: 'arimo', size: 14, color: [0, 0, 0], opacity: 1, rotate: 0, rect: [250, 500, 350, 525] });
    w.__viewer.setTool('select');
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}

const view = (page: Page) => page.evaluate(() => {
  const v = (window as unknown as W).__viewer;
  return { mm: v.marginMm as number, show: v.showMargins as boolean };
});

async function openSubmenu(page: Page) {
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Margin size' }).click();
}

async function openCustom(page: Page) {
  await openSubmenu(page);
  await page.getByRole('menuitemradio', { name: /^Custom/ }).click();
  const form = page.getByRole('dialog', { name: 'Margin size' });
  await expect(form).toBeVisible();
  return form;
}

/** The guide's left edge from the page's left edge, in points. */
const guideInset = (page: Page, i = 0) =>
  page.locator(`.page[data-index="${i}"]`).evaluate((el) => {
    const g = el.querySelector('.margin-guide');
    if (!g) return null;
    return (g.getBoundingClientRect().left - el.getBoundingClientRect().left) / (window as unknown as W).__viewer.scale;
  });

async function dragLeft(page: Page, id: string, dx: number) {
  const b = await page.locator(`[data-annot-id="${id}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + dx / 2, b.y, { steps: 4 });
  await page.mouse.move(b.x + dx, b.y, { steps: 4 });
  await page.mouse.up();
}

test('type 30: the guides follow, Apply sets it, the menu says so and a text box stops at 30 mm', async ({ page }) => {
  await open(page);
  // The menu: the presets, then Custom… (radio items).
  await openSubmenu(page);
  const radios = page.getByRole('menu', { name: 'Margin size' }).getByRole('menuitemradio');
  await expect(radios).toHaveText([/6.35 mm/, /12.7 mm/, /20 mm/, /25 mm/, /Custom…/]);
  await expect(page.getByRole('menuitemradio', { name: /Custom/ })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('menu', { name: 'Margin size' }).getByRole('separator')).toHaveCount(1);
  await page.getByRole('menuitemradio', { name: /^Custom/ }).click();

  const form = page.getByRole('dialog', { name: 'Margin size' });
  const field = form.getByRole('textbox', { name: 'Margin' });
  // Focus in the field, its text (the current margin) selected.
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('25');
  expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.inputMode])).toEqual([0, 2, 'decimal']);
  await expect(form.getByText(/0 to 52.5 mm/)).toBeVisible();
  // Inside the window.
  const box = (await form.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height).toBe(true);

  // Live preview: the guides show 30 mm (margins were off), nothing applied yet.
  await page.keyboard.type('30');
  await expect.poll(() => guideInset(page)).toBeCloseTo(30 * MM, 0);
  expect(await view(page)).toEqual({ mm: 25, show: false });
  await page.keyboard.press('Enter');
  await expect(form).toHaveCount(0);
  // Applied, and the margins show (turned on for you), with the announcement.
  expect(await view(page)).toEqual({ mm: 30, show: true });
  await expect(page.locator('.page[data-index="0"] .margin-label')).toHaveText('30 mm');
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText('Margins: 30 mm. Show margins is on.');

  // The menu: "Custom: 30 mm", checked; no preset checked.
  await openSubmenu(page);
  await expect(page.getByRole('menuitemradio', { name: 'Custom: 30 mm' })).toHaveAttribute('aria-checked', 'true');
  for (const name of [/6.35 mm/, /12.7 mm/, /^20 mm/, /25 mm/]) await expect(page.getByRole('menuitemradio', { name })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // A text box dragged left stops at 30 mm.
  await dragLeft(page, 'tb', -400);
  const left = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.find((a: { id: string }) => a.id === 'tb').rect[0]);
  expect(Math.abs(left - 30 * MM)).toBeLessThan(0.6);
});

test('500 is refused with the range; Cancel and a click outside put the guides back', async ({ page }) => {
  await open(page);
  await page.evaluate(() => ((window as unknown as W).__viewer.showMargins = true));
  let form = await openCustom(page);
  const field = form.getByRole('textbox', { name: 'Margin' });
  await field.fill('500');
  await expect(form.getByText('Enter a value from 0 to 52.5 mm')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await form.getByRole('button', { name: 'Apply' }).click();
  // Not applied, the text kept, the reason announced.
  await expect(field).toHaveValue('500');
  expect((await view(page)).mm).toBe(25);
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText('Enter a value from 0 to 52.5 mm');
  // Empty is refused too.
  await field.fill('');
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(form.getByText('Enter a value from 0 to 52.5 mm')).toBeVisible();

  // Typing previews, Cancel puts the guides back.
  await field.fill('40');
  await expect.poll(() => guideInset(page)).toBeCloseTo(40 * MM, 0);
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => guideInset(page)).toBeCloseTo(25 * MM, 0);
  expect((await view(page)).mm).toBe(25);

  // Escape, and a click outside, cancel too.
  form = await openCustom(page);
  await form.getByRole('textbox', { name: 'Margin' }).fill('35');
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  form = await openCustom(page);
  await form.getByRole('textbox', { name: 'Margin' }).fill('35');
  await page.mouse.click(5, (page.viewportSize()!.height * 2) / 3);
  await expect(form).toHaveCount(0);
  expect((await view(page)).mm).toBe(25);
  await expect.poll(() => guideInset(page)).toBeCloseTo(25 * MM, 0);
});

test('0 is no margin; a preset value selects the preset; inches and commas work', async ({ page }) => {
  await open(page);
  let form = await openCustom(page);
  await form.getByRole('textbox', { name: 'Margin' }).fill('0');
  await page.keyboard.press('Enter');
  expect(await view(page)).toEqual({ mm: 0, show: true });
  expect(await guideInset(page)).toBeCloseTo(0, 1);
  await openSubmenu(page);
  await expect(page.getByRole('menuitemradio', { name: 'Custom: 0 mm' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Custom: 0 mm' }).click();
  // Inches: 0,5 in is the 12.7 mm preset.
  form = page.getByRole('dialog', { name: 'Margin size' });
  await form.getByRole('combobox', { name: 'Unit' }).selectOption('in');
  await form.getByRole('textbox', { name: 'Margin' }).fill('0,5');
  await page.keyboard.press('Enter');
  expect((await view(page)).mm).toBe(12.7);
  await openSubmenu(page);
  await expect(page.getByRole('menuitemradio', { name: /12.7 mm/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'Custom…' })).toHaveAttribute('aria-checked', 'false');
});

test('margins off: applying turns them on; objects across the new margin stay, with one message', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    const pid = w.__doc.pages[0].id;
    w.__actions.addAnnotation(pid, { id: 's1', type: 'stamp', label: 'A', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [20, 300, 120, 330] });
    w.__actions.addAnnotation(pid, { id: 's2', type: 'stamp', label: 'B', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [480, 300, 580, 330] });
    w.__actions.addAnnotation(pid, { id: 's3', type: 'stamp', label: 'C', color: [0, 0, 0], opacity: 1, rotate: 0, rect: [200, 20, 300, 50] });
  });
  const before = await page.evaluate(() => JSON.stringify((window as unknown as W).__doc.pages));
  const form = await openCustom(page);
  await form.getByRole('textbox', { name: 'Margin' }).fill('30');
  await form.getByRole('button', { name: 'Apply' }).click();
  expect(await view(page)).toEqual({ mm: 30, show: true });
  await expect(page.getByText('3 objects are outside the new margins. They stay where they are.')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify((window as unknown as W).__doc.pages))).toBe(before);
});

test('an A6 and an A4 page: the smaller page sets the maximum, each page shows its margin', async ({ page }) => {
  await open(page, [A6, A4]);
  const form = await openCustom(page);
  await expect(form.getByText(/0 to 26.2 mm/)).toBeVisible();
  await expect(form.getByText(/The pages differ in size: the smallest one sets the maximum\./)).toBeVisible();
  await form.getByRole('textbox', { name: 'Margin' }).fill('30');
  await expect(form.getByText('Enter a value from 0 to 26.2 mm')).toBeVisible();
  await form.getByRole('textbox', { name: 'Margin' }).fill('26');
  await page.keyboard.press('Enter');
  expect((await view(page)).mm).toBe(26);
  await expect(page.locator('.page[data-index="0"] .margin-label')).toHaveText('26 mm');
  expect(await guideInset(page, 0)).toBeCloseTo(26 * MM, 0);
  await page.evaluate(() => (window as unknown as W).__viewer.goToPage(1));
  await expect(page.locator('.page[data-index="1"] .margin-label')).toHaveText('26 mm');
});

test('keyboard: the menu item and the form, one focus ring each; a text box being typed in stays open', async ({ page }) => {
  await open(page);
  await page.locator('[data-annot-id="tb"]').dblclick();
  await expect(page.locator('.rich-editor')).toBeVisible();
  // View menu by keyboard: Margin size › Custom…
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).focus();
  await page.keyboard.press('Enter');
  const sub = page.getByRole('menuitem', { name: 'Margin size' });
  while (!(await sub.evaluate((el) => el === document.activeElement))) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitemradio', { name: 'Custom…' })).toBeFocused();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Margin size' });
  await expect(form.getByRole('textbox', { name: 'Margin' })).toBeFocused();
  // Still editing the text box.
  await expect(page.locator('.rich-editor')).toBeVisible();
  const rings = () => page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).outlineStyle !== 'none' && getComputedStyle(e).outlineWidth !== '0px').length);
  for (const name of ['Unit', 'Cancel', 'Apply']) {
    await page.keyboard.press('Tab');
    await expect(form.getByRole(name === 'Unit' ? 'combobox' : 'button', { name })).toBeFocused();
    expect(await rings(), name).toBe(1);
  }
  // Tab stays inside the form.
  await page.keyboard.press('Tab');
  await expect(form.getByRole('textbox', { name: 'Margin' })).toBeFocused();
  await page.keyboard.type('22');
  await page.keyboard.press('Enter');
  expect((await view(page)).mm).toBe(22);
  await expect(page.locator('.rich-editor')).toBeVisible();
});

test('phones: a bottom sheet from the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Custom…' }).click();
  const form = page.getByRole('dialog', { name: 'Margin size' });
  const box = (await form.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(800);
  await form.getByRole('textbox', { name: 'Margin' }).fill('15');
  await form.getByRole('button', { name: 'Apply' }).click();
  expect((await view(page)).mm).toBe(15);
});
