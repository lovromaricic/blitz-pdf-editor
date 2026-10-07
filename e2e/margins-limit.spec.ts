// View › Show margins is also the limit: a text box, an image and a shape
// dragged past each margin stop on it (the line flashes, a short hint says
// how to go further, twice at most); with the margins off the same drag goes
// on to the page edge. An object already past the margin can still move
// inward. Undo and redo are as always. The item "Keep objects inside margins"
// is gone.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;
const M = (25 * 72) / 25.4;
const HINT = 'Stopped at the margin. Turn off Show margins in the View menu to go further.';

async function open(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'm.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(0.5);
    w.__viewer.goToPage(0);
    const pid = w.__doc.pages[0].id;
    w.__actions.addAnnotation(pid, { id: 'tb', type: 'text', text: 'Note', font: 'arimo', size: 14, color: [0, 0, 0], opacity: 1, rotate: 0, rect: [260, 520, 360, 545] });
    w.__actions.addAnnotation(pid, { id: 'sh', type: 'shape', shape: 'rect', color: [0.8, 0, 0], fill: [1, 0.85, 0.85], width: 2, opacity: 1, from: [270, 300], to: [340, 360] });
    const c = new OffscreenCanvas(60, 40);
    c.getContext('2d')!.fillRect(0, 0, 60, 40);
    await w.__actions.insertImageFiles([new File([await c.convertToBlob({ type: 'image/png' })], 'r.png', { type: 'image/png' })], { index: 0, point: [306, 600] }); // (display space: y from the top)
    w.__viewer.setTool('select');
    w.__doc.history.markSaved();
  });
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}

const boundsOf = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const w = window as unknown as W;
    const { bounds } = await import(/* @vite-ignore */ '/src/lib/annotations.ts' as string);
    const a = w.__doc.pages[0].annots.find((x: { id: string; type: string }) => x.id === id || (id === 'img' && x.type === 'image'));
    return bounds(a) as number[];
  }, id);

const target = (page: Page, id: string) => (id === 'img' ? page.locator('.box-hit[data-kind="image"]') : page.locator(`[data-annot-id="${id}"]`));

/** Drag an object by (dx, dy) screen px; `during` runs before the button is let go. */
async function drag(page: Page, id: string, dx: number, dy: number, during?: () => Promise<void>) {
  // (Measured in the page: an SVG group's box isn't always reported by the locator.)
  const b = await target(page, id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx / 2, at.y + dy / 2, { steps: 4 });
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 4 });
  if (during) await during();
  await page.mouse.up();
}

/** Toward each side far enough to pass the margin, then back to about where it was. */
const SIDES = [
  { name: 'left', dx: -320, dy: 0, edge: 0, at: M },
  { name: 'right', dx: 320, dy: 0, edge: 2, at: 612 - M },
  { name: 'top', dx: 0, dy: -480, edge: 3, at: 792 - M },
  { name: 'bottom', dx: 0, dy: 320, edge: 1, at: M },
] as const;

test('with Show margins on, a text box, an image and a shape stop at each margin; off, they go on', async ({ page }) => {
  await open(page);
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  // The old separate item is gone.
  await expect(page.getByRole('menuitemcheckbox', { name: /Keep objects inside margins/ })).toHaveCount(0);
  await page.getByRole('menuitemcheckbox', { name: 'Show margins' }).click();
  await expect(page.locator('.page[data-index="0"] .margin-guide')).toHaveCount(1);

  let hints = 0;
  for (const id of ['tb', 'img', 'sh']) {
    for (const side of SIDES) {
      const start = await boundsOf(page, id);
      await drag(page, id, side.dx, side.dy, async () => {
        // The line flashes while it holds the object.
        await expect(page.locator('.page[data-index="0"] .margin-guide.flash')).toHaveCount(1);
      });
      const b = await boundsOf(page, id);
      expect(Math.abs(b[side.edge] - side.at), `${id} ${side.name}`).toBeLessThan(0.6);
      if (await page.getByText(HINT).isVisible()) hints++;
      // Back again (Undo: one step per drag, and the position comes back exactly).
      await page.keyboard.press('ControlOrMeta+z');
      expect(await boundsOf(page, id)).toEqual(start);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      expect(Math.abs((await boundsOf(page, id))[side.edge] - side.at)).toBeLessThan(0.6);
      await page.keyboard.press('ControlOrMeta+z');
    }
  }
  // The hint showed (it stays a few seconds, so drags in a row share it), at most twice.
  expect(hints).toBeGreaterThan(0);
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText(/Stopped at the margin/);

  // Margins off: the same drags cross the margin line (only the page edge holds).
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show margins' }).click();
  for (const id of ['tb', 'img', 'sh']) {
    await drag(page, id, -320, 0);
    expect((await boundsOf(page, id))[0], id).toBeLessThan(M - 5);
    await page.keyboard.press('ControlOrMeta+z');
  }
});

test('the hint shows twice per document at most, then only the line flashes', async ({ page }) => {
  // Each round waits for the hint (a few seconds) to go.
  test.setTimeout(60000);
  await open(page);
  await page.evaluate(() => ((window as unknown as W).__viewer.showMargins = true));
  const seen: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    await drag(page, 'sh', -320, 0);
    seen.push(await page.getByText(HINT).isVisible());
    await page.keyboard.press('ControlOrMeta+z');
    // Wait for the hint to go (a few seconds), so the next stop could show it again.
    await expect(page.getByText(HINT)).toHaveCount(0, { timeout: 8000 });
  }
  expect(seen).toEqual([true, true, false]);
});

test('turning margins on moves nothing; an object past the margin can still move inward, not further out', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__actions.addAnnotation(w.__doc.pages[0].id, { id: 'out', type: 'stamp', label: 'OUT', color: [0.3, 0.3, 0.3], opacity: 1, rotate: 0, rect: [20, 300, 120, 330] });
  });
  const before = await page.evaluate(() => JSON.stringify((window as unknown as W).__doc.pages));
  const undo = await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel);
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show margins' }).click();
  expect(await page.evaluate(() => JSON.stringify((window as unknown as W).__doc.pages))).toBe(before);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe(undo);
  // Further out: held where it is. Inward: free.
  await drag(page, 'out', -100, 0);
  expect((await boundsOf(page, 'out'))[0]).toBeCloseTo(20, 1);
  await drag(page, 'out', 30, 0);
  expect((await boundsOf(page, 'out'))[0]).toBeGreaterThan(30);
});
