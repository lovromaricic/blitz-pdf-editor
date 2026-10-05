// Dragging stays smooth with 200 objects on a page and smart guides on: the
// candidate lines are collected once per drag, each move measures one box.
import { expect, test } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

test('dragging with 200 objects on the page stays near 60 fps', async ({ page }) => {
  test.setTimeout(120_000);
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'many.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#editor-main')).toBeFocused({ timeout: 15000 });
  await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const pid = w.__doc.pages[0].id;
    const list = [];
    for (let i = 0; i < 200; i++) {
      const x = 20 + (i % 20) * 28;
      const y = 40 + Math.floor(i / 20) * 70;
      list.push(i % 2
        ? { id: `o${i}`, type: 'stamp', label: `S${i}`, color: [0.1, 0.35, 0.8], opacity: 1, rotate: 0, rect: [x, y, x + 24, y + 14] }
        : { id: `o${i}`, type: 'shape', shape: 'rect', color: [0.8, 0, 0], opacity: 1, width: 1, fill: [1, 0.9, 0.9], from: [x, y], to: [x + 22, y + 22] });
    }
    // One step: 200 objects at once.
    w.__doc.pages = [{ ...w.__doc.pages[0], annots: list }];
    w.__viewer.setTool('select');
    await w.__viewer.setZoom(1);
    w.__viewer.goToPage(0);
  });
  await page.waitForTimeout(800);
  // A stamp near the top of the page (clear of the floating bars).
  const el = page.locator('[data-annot-id="o181"]');
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 6);
  await page.mouse.down();
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // 120 small moves across the objects (many near-misses for the guides).
  for (let i = 1; i <= 120; i++) await page.mouse.move(b.x + 10 + i * 3, b.y + 6 + Math.sin(i / 6) * 40);
  const frames: number[] = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__stop = true;
    return w.__frames.slice(2);
  });
  await page.mouse.up();
  frames.sort((a, z) => a - z);
  const p = (q: number) => frames[Math.min(frames.length - 1, Math.floor(q * frames.length))];
  const result = { frames: frames.length, median: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), max: +frames[frames.length - 1].toFixed(1) };
  test.info().annotations.push({ type: 'frame ms', description: JSON.stringify(result) });
  console.log('FRAMES', JSON.stringify(result));
  expect(result.median).toBeLessThan(20);
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__doc.history.undoLabel)).toBe('Move stamp');
});
