// Every edit command runs once per action, whichever way it's invoked: the
// shortcut, the Edit menu, the right-click menu, or the browser's clipboard
// event (even when that event arrives late, as Chrome on macOS sends it).
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

let opened = 0;
async function open(page: Page, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  await page.locator('input[type=file]').first().setInputFiles({ name: `doc-${++opened}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
}

async function textBox(page: Page, text = 'Copy me') {
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused({ timeout: 15000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.page[data-index="0"] .box-hit').first().click();
}

const count = (page: Page, i = 0) => page.evaluate((i) => ((window as unknown as W).__doc.pages[i].annots ?? []).length, i);
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.history.undoLabel);
const steps = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.history.past.length);
async function editMenu(page: Page, item: RegExp) {
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}
/** Settle: past any fallback timer, so a second run would have happened. */
const settle = (page: Page) => page.waitForTimeout(450);

test('Cmd/Ctrl+C then Cmd/Ctrl+V pastes exactly one object; Edit > Paste too; one undo step each', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await textBox(page);
  expect(await count(page)).toBe(1);
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await settle(page);
  expect(await count(page)).toBe(2);
  expect(await undoLabel(page)).toBe('Paste text');

  await editMenu(page, /^Paste/);
  await settle(page);
  expect(await count(page)).toBe(3);

  const before = await steps(page);
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page);
  expect(await count(page)).toBe(2);
  expect(await steps(page)).toBe(before - 1);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  await settle(page);
  expect(await count(page)).toBe(3);
});

test('a paste event that arrives late (after the keystroke, as on macOS) still pastes once', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await textBox(page);
  await page.keyboard.press('ControlOrMeta+c');
  const mod = process.platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
  // Keystroke only (no event), then the event 60 ms later, and 600 ms later (after the fallback ran).
  for (const lag of [60, 600]) {
    const n = await count(page);
    await page.evaluate(
      async ({ mod, lag }) => {
        const target = document.activeElement ?? document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true, ...mod }));
        await new Promise((r) => setTimeout(r, lag));
        const dt = new DataTransfer();
        dt.setData('application/x-blitz-object', '1');
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
      { mod, lag },
    );
    await settle(page);
    expect(await count(page)).toBe(n + 1);
  }
});

test('text and images from other apps paste as exactly one object', async ({ page }) => {
  await page.goto('/');
  await open(page);
  const paste = (kind: 'text' | 'image') =>
    page.evaluate(async (kind) => {
      const dt = new DataTransfer();
      if (kind === 'text') dt.setData('text/plain', 'From another app');
      else {
        const c = document.createElement('canvas');
        c.width = c.height = 20;
        const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
        dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
      }
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, kind);
  await paste('text');
  await expect.poll(() => count(page)).toBe(1);
  expect(await undoLabel(page)).toBe('Paste text');
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"]')).toContainText('From another app');
  await paste('image');
  await expect.poll(() => count(page)).toBe(2);
  await settle(page);
  expect(await count(page)).toBe(2);
  expect(await undoLabel(page)).toBe('Insert image');
});

test('audit: cut, duplicate, delete, undo, nudge and select all each act once (shortcut and menu)', async ({ page }) => {
  await page.goto('/');
  await open(page, 2);
  await page.evaluate(() => (window as unknown as W).__viewer.setMode('single'));
  await textBox(page);
  const hit = page.locator('.page[data-index="0"] .box-hit').first();

  // Duplicate: shortcut, then menu.
  await page.keyboard.press('ControlOrMeta+d');
  await settle(page);
  expect(await count(page)).toBe(2);
  await editMenu(page, /^Duplicate/);
  await settle(page);
  expect(await count(page)).toBe(3);

  // Delete: key, then menu.
  await page.locator('.page[data-index="0"] .box-hit').last().focus();
  await page.keyboard.press('Delete');
  await settle(page);
  expect(await count(page)).toBe(2);
  await page.locator('.page[data-index="0"] .box-hit').last().click();
  await editMenu(page, /^Delete text/);
  await settle(page);
  expect(await count(page)).toBe(1);

  // Nudge: one press moves 1 px, and doesn't also turn the page (single-page view).
  await page.locator('.page[data-index="0"] .box-hit').first().focus();
  const x = () => page.evaluate(() => (window as unknown as W).__doc.pages[0].annots[0].rect[0]);
  const before = await x();
  await page.keyboard.press('ArrowRight');
  await settle(page);
  expect((await x()) - before).toBeCloseTo(1 / (await page.evaluate(() => (window as unknown as W).__viewer.scale)), 2);
  expect(await page.evaluate(() => (window as unknown as W).__viewer.currentIndex)).toBe(0);

  // Cut: shortcut, then paste it back once; then menu cut.
  await hit.click();
  await page.keyboard.press('ControlOrMeta+x');
  await settle(page);
  expect(await count(page)).toBe(0);
  await page.keyboard.press('ControlOrMeta+v');
  await settle(page);
  expect(await count(page)).toBe(1);
  await page.locator('.page[data-index="0"] .box-hit').first().click();
  await editMenu(page, /^Cut/);
  await settle(page);
  expect(await count(page)).toBe(0);

  // Undo: one step per press, and per menu click.
  const n = await steps(page);
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page);
  expect(await steps(page)).toBe(n - 1);
  await editMenu(page, /^Undo/);
  await settle(page);
  expect(await steps(page)).toBe(n - 2);

  // Select all from the Edit menu: every page selected (not toggled back by a second run).
  // (Ctrl/Cmd+A on the page selects its objects: multi-select.spec.ts.)
  await editMenu(page, /^Select all pages/);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__viewer.selection.size)).toBe(2);

  // Tool shortcut: one press, one tool (from the page: single keys don't act inside menus).
  await page.locator('#document-view').focus();
  await page.keyboard.press('h');
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__viewer.tool)).toBe('highlight');
});

test('right-click menu: rotate and delete a page act once', async ({ page }) => {
  await page.goto('/');
  await open(page, 3);
  const first = page.getByRole('list', { name: /^Pages/ }).getByRole('button').first();
  await expect(first).toBeVisible();
  await first.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Rotate right/ }).click();
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as W).__doc.pages[0].rotation)).toBe(90);
  await first.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as W).__doc.pages.length)).toBe(2);
});

test('opening and closing documents (and going Home) never multiplies the shortcut listeners', async ({ page }) => {
  // Count the window's live keydown and paste listeners.
  await page.addInitScript(() => {
    const live = new Map<string, Set<unknown>>();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, fn: unknown, opts?: unknown) => {
      if (!live.has(type)) live.set(type, new Set());
      live.get(type)!.add(fn);
      add(type, fn as EventListener, opts as AddEventListenerOptions);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, fn: unknown, opts?: unknown) => {
      live.get(type)?.delete(fn);
      remove(type, fn as EventListener, opts as EventListenerOptions);
    }) as typeof window.removeEventListener;
    (window as unknown as W).__listeners = (type: string) => live.get(type)?.size ?? 0;
  });
  await page.goto('/');
  const listeners = () => page.evaluate(() => ({ keydown: ((window as unknown as W).__listeners?.('keydown') ?? 0), paste: ((window as unknown as W).__listeners?.('paste') ?? 0) }));
  await open(page);
  const once = await listeners();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Close' }).click();
    await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
    await open(page);
  }
  expect(await listeners()).toEqual(once);
  // And it still pastes once.
  await textBox(page);
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await settle(page);
  expect(await count(page)).toBe(2);
});
