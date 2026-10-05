// Group and Ungroup, from the context menu only; a group moves and saves like
// the objects it holds.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

async function open(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as W).load = (p: string) => import(/* @vite-ignore */ p);
  });
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'groups.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.75);
    w.__viewer.goToPage(0);
    const add = (a: object) => w.__actions.addAnnotation(w.__doc.pages[0].id, a);
    add({ id: 'a', type: 'stamp', label: 'A', color: [0.1, 0.35, 0.8], opacity: 1, rotate: 0, rect: [80, 600, 190, 634] });
    add({ id: 'b', type: 'shape', shape: 'rect', color: [0.8, 0, 0], opacity: 1, width: 2, fill: [0.9, 0.1, 0.1], from: [240, 590], to: [340, 650] });
    add({ id: 'c', type: 'stamp', label: 'C', color: [0.08, 0.45, 0.16], opacity: 1, rotate: 0, rect: [400, 600, 510, 634] });
    add({ id: 'x', type: 'stamp', label: 'X', color: [0.35, 0.35, 0.35], opacity: 1, rotate: 0, rect: [80, 400, 190, 434] });
    w.__viewer.setTool('select');
  });
  await page.waitForTimeout(500);
}

const obj = (page: Page, id: string) => page.locator(`[data-annot-id="${id}"]`);
const selected = (page: Page) => page.evaluate(() => (window as unknown as W).__viewer.objectSelection?.ids ?? []);
const menu = (page: Page) => page.getByRole('menu', { name: 'Object actions' });
const geometry = (page: Page) =>
  page.evaluate(() => Object.fromEntries((window as unknown as W).__doc.pages[0].annots.map((a: { id: string; rect?: number[]; from?: number[] }) => [a.id, a.rect ?? a.from])));
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.history.undoLabel);

/** Shift-click a, b and c. */
async function selectThree(page: Page) {
  await obj(page, 'a').click();
  await obj(page, 'b').click({ modifiers: ['Shift'] });
  await obj(page, 'c').click({ modifiers: ['Shift'] });
  expect(await selected(page)).toEqual(['a', 'b', 'c']);
}

test('Shift-click three, Group from the menu; the group moves as one; Ungroup gives back the objects', async ({ page }) => {
  await open(page);
  await selectThree(page);
  await obj(page, 'c').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  // No shortcut shown next to Group or Ungroup; Ungroup has nothing to act on yet.
  await expect(menu(page).getByRole('menuitem', { name: 'Group', exact: true })).toBeVisible();
  await expect(menu(page).getByRole('menuitem', { name: 'Ungroup', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await menu(page).getByRole('menuitem', { name: 'Group', exact: true }).click();
  await expect(menu(page)).toBeHidden();
  const group = (await selected(page))[0];
  expect(group).toMatch(/^group-/);
  expect(await undoLabel(page)).toBe('Group 3 objects');
  await expect(page.getByRole('complementary', { name: 'Properties' }).locator('h2').first()).toHaveText('Group (3 objects)');
  await expect(page.locator('.page[data-index="0"] .handle')).toHaveCount(0);

  // A click on any of its objects selects the whole group; dragging one moves all three.
  await page.mouse.click(10, 10);
  await obj(page, 'a').click();
  expect(await selected(page)).toEqual([group]);
  const before = await geometry(page);
  const a = (await obj(page, 'a').boundingBox())!;
  await page.mouse.move(a.x + 20, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 110, { steps: 5 });
  await page.mouse.up();
  const after = await geometry(page);
  const dy = after.a[1] - before.a[1];
  expect(dy).toBeLessThan(-50);
  expect(after.b[1] - before.b[1]).toBeCloseTo(dy, 1);
  expect(after.c[1] - before.c[1]).toBeCloseTo(dy, 1);
  expect(after.x).toEqual(before.x);
  expect(await undoLabel(page)).toBe('Move group (3 objects)');

  // The menu on the group offers Ungroup (and no Group: one unit can't be grouped).
  await obj(page, 'b').click({ button: 'right' });
  await expect(menu(page).getByRole('menuitem', { name: 'Group', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await menu(page).getByRole('menuitem', { name: 'Ungroup', exact: true }).click();
  expect((await selected(page)).sort()).toEqual(['a', 'b', 'c']);
  expect(await undoLabel(page)).toBe('Ungroup');
  expect(await geometry(page)).toEqual(after);
  // Single objects again: a click selects just one.
  await page.mouse.click(10, 10);
  await obj(page, 'a').click();
  expect(await selected(page)).toEqual(['a']);
});

test('right-click on one of several selected objects keeps them all; on another object selects just it', async ({ page }) => {
  await open(page);
  await selectThree(page);
  await obj(page, 'a').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  expect(await selected(page)).toEqual(['a', 'b', 'c']);
  // The menu's commands act on all three: Duplicate makes three copies (one step).
  await menu(page).getByRole('menuitem', { name: /^Duplicate/ }).click();
  expect(await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.length)).toBe(7);
  expect(await undoLabel(page)).toBe('Duplicate 3 objects');
  await page.keyboard.press('ControlOrMeta+z');
  await obj(page, 'x').click({ button: 'right' });
  expect(await selected(page)).toEqual(['x']);
  await page.keyboard.press('Escape');
});

test('the keyboard: Shift+F10 on a selection, Group with Enter; the group menu then offers Ungroup', async ({ page }) => {
  await open(page);
  await selectThree(page);
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('g'); // type-ahead: Group
  await expect(menu(page).getByRole('menuitem', { name: 'Group', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  const group = (await selected(page))[0];
  expect(group).toMatch(/^group-/);
  // Exactly one run: one undo step.
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.some((a: { groups?: string[] }) => a.groups))).toBe(false);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.evaluate((g) => {
    const w = window as unknown as W;
    w.__viewer.selectObjects({ pageId: w.__doc.pages[0].id, ids: [g] });
  }, group);
  await obj(page, 'a').focus();
  await page.keyboard.press('ContextMenu');
  await page.keyboard.press('u');
  await expect(menu(page).getByRole('menuitem', { name: 'Ungroup', exact: true })).toBeFocused();
  // Escape closes, focus back on the object, no ring on the page canvas.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  expect(await page.locator('#document-view').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
});

test('a group survives copy and paste to another page, and the saved PDF has the editor positions and order', async ({ page }) => {
  await open(page);
  await selectThree(page);
  await page.evaluate(() => (window as unknown as W).__actions.groupSelection());
  await page.keyboard.press('ControlOrMeta+c');
  await page.evaluate(() => (window as unknown as W).__viewer.goToPage(1));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__viewer.currentIndex = 1;
    w.__actions.pasteAnnotation();
  });
  const pasted = await page.evaluate(() => (window as unknown as W).__doc.pages[1].annots.map((a: { groups?: string[] }) => a.groups?.[0]));
  expect(pasted).toHaveLength(3);
  expect(new Set(pasted).size).toBe(1);
  expect(pasted[0]).toMatch(/^group-/);

  // The saved file: every object where the editor has it, in the editor's order, no groups anywhere.
  const result = await page.evaluate(async () => {
    const w = window as unknown as W;
    const { writePdf } = await w.load('/src/lib/pdf/pdf-writer.ts');
    const { loadPdf } = await w.load('/src/lib/pdf/pdfjs.ts');
    const { bounds } = await w.load('/src/lib/annotations.ts');
    const pdf = await loadPdf(await writePdf(w.__doc, w.__doc.pages, 'preserve'));
    const out = [];
    for (let i = 0; i < 2; i++) {
      const saved = (await (await pdf.getPage(i + 1)).getAnnotations()).map((a: { rect: number[] }) => Array.from(a.rect).map((v: number) => Math.round(v)));
      const editor = w.__doc.pages[i].annots.map((a: unknown) => bounds(a).map((v: number) => Math.round(v)));
      out.push({ saved, editor });
    }
    return out;
  });
  for (const { saved, editor } of result) expect(saved).toEqual(editor);
});
