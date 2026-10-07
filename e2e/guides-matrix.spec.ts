// The boundary and the margins at several zooms, on a rotated page, a small (A6)
// and a very large (A0) page: snapping lands on the drawn margin, and objects
// stop at the page edge, as shown on screen.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

const CASES = [
  { name: 'Letter at 50%', size: [612, 792], zoom: 0.5, rotate: 0 },
  { name: 'Letter at 100%', size: [612, 792], zoom: 1, rotate: 0 },
  { name: 'Letter at 400%', size: [612, 792], zoom: 4, rotate: 0 },
  { name: 'Letter turned 90°', size: [612, 792], zoom: 0.75, rotate: 90 },
  { name: 'A6', size: [298, 420], zoom: 1, rotate: 0 },
  { name: 'A0', size: [2384, 3370], zoom: 0.25, rotate: 0 },
] as const;

for (const c of CASES) {
  test(`margins snap and the edge holds: ${c.name}`, async ({ page }) => {
    const doc = await PDFDocument.create();
    doc.addPage([...c.size]);
    await page.goto('/');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'm.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
    await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#editor-main')).toBeFocused();
    await page.evaluate(
      async ({ zoom, rotate, size }) => {
        const w = window as unknown as W;
        if (rotate) w.__actions.rotate(rotate, [w.__doc.pages[0]]);
        await w.__viewer.setZoom(zoom);
        w.__viewer.showMargins = true;
        const pid = w.__doc.pages[0].id;
        // A stamp about the middle of the page, made for the page as shown.
        const [W0, H0] = size;
        const rot = w.__doc.totalRotation(w.__doc.pages[0]);
        const s = Math.min(W0, H0) / 6;
        w.__actions.addAnnotation(pid, { id: 'x', type: 'stamp', label: 'X', color: [0.1, 0.35, 0.8], opacity: 1, rotate: rot, rect: [W0 / 2 - s / 2, H0 / 2 - s / 4, W0 / 2 + s / 2, H0 / 2 + s / 4] });
        w.__viewer.setTool('select');
        w.__viewer.goToPage(0);
        await new Promise((r) => setTimeout(r, 400));
        document.querySelector('[data-annot-id="x"]')!.scrollIntoView({ block: 'center', inline: 'center' });
      },
      { zoom: c.zoom, rotate: c.rotate, size: c.size },
    );
    await page.waitForTimeout(500);
    const guide = page.locator('.page[data-index="0"] .margin-guide');
    await expect(guide).toHaveCount(1);
    const g = (await guide.boundingBox())!;
    const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
    // The margin is 25 mm as shown (or a quarter of the smaller side on a small page), at any zoom.
    const scale = await page.evaluate(() => (window as unknown as W).__viewer.scale as number);
    const expected = Math.min((25 * 72) / 25.4, Math.min(...c.size) / 4) * scale;
    // (The box of a 1 px stroke starts half a pixel before the line.)
    expect(Math.abs(g.x + 0.5 - pg.x - expected)).toBeLessThan(1);

    // Drag the stamp to within 3 px of the left margin: it lands on it.
    const el = page.locator('[data-annot-id="x"]');
    let b = (await el.boundingBox())!;
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const dx = g.x + 3 - b.x;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y, { steps: 3 });
    await page.mouse.move(from.x + dx, from.y, { steps: 3 });
    await page.mouse.up();
    b = (await el.boundingBox())!;
    expect(Math.abs(b.x - g.x)).toBeLessThan(1);

    // Far past the bottom-right corner: it stops at the page edge, as shown.
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 4000, at.y + 4000, { steps: 8 });
    await page.mouse.up();
    b = (await el.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(pg.x + pg.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(pg.y + pg.height + 1);
    // In the document too.
    const inside = await page.evaluate(async () => {
      const w = window as unknown as W;
      const { bounds } = await import(/* @vite-ignore */ '/src/lib/annotations.ts' as string);
      const r = bounds(w.__doc.pages[0].annots[0]);
      const p = w.__doc.pageBounds(w.__doc.pages[0]);
      return r[0] >= p[0] - 0.01 && r[1] >= p[1] - 0.01 && r[2] <= p[2] + 0.01 && r[3] <= p[3] + 0.01;
    });
    expect(inside).toBe(true);

    // Shown, the margins are the limit: dragged far to the top left, it stops on the margin line.
    await page.evaluate(async () => {
      const w = window as unknown as W;
      // Back to the middle of the page, in view.
      const { bounds, translate } = await import(/* @vite-ignore */ '/src/lib/annotations.ts' as string);
      const a = w.__doc.pages[0].annots[0];
      const r = bounds(a);
      const p = w.__doc.pageBounds(w.__doc.pages[0]);
      w.__actions.updateAnnotation(w.__doc.pages[0].id, translate(a, (p[0] + p[2]) / 2 - (r[0] + r[2]) / 2, (p[1] + p[3]) / 2 - (r[1] + r[3]) / 2), 'Move');
      await new Promise((res) => setTimeout(res, 100));
      document.querySelector('[data-annot-id="x"]')!.scrollIntoView({ block: 'center', inline: 'center' });
    });
    await page.waitForTimeout(400);
    b = (await el.boundingBox())!;
    const from2 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(from2.x, from2.y);
    await page.mouse.down();
    await page.mouse.move(from2.x - 4000, from2.y - 4000, { steps: 8 });
    await page.mouse.up();
    b = (await el.boundingBox())!;
    const g2 = (await guide.boundingBox())!;
    expect(Math.abs(b.x - (g2.x + 0.5))).toBeLessThan(1);
    expect(Math.abs(b.y - (g2.y + 0.5))).toBeLessThan(1);
  });
}
