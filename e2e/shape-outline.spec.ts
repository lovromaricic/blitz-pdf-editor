// "No outline" for rectangles and ellipses: first in the Outline row, like
// "No fill" in the Fill row. Nothing is drawn around the shape, on screen or
// in the saved PDF (no stroke operator); the thickness waits, disabled; a
// color brings the outline back. A shape can't have neither.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFRef, decodePDFRawStream } from '@cantoo/pdf-lib';
import { writeFileSync } from 'node:fs';

type W = Record<string, any>;

async function open(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 's.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    await (window as unknown as W).__viewer.setZoom(1);
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Properties' });
const shapeOf = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.find((a: { type: string }) => a.type === 'shape'));
const undoLabel = (page: Page) => page.evaluate(() => (window as unknown as W).__doc.history.undoLabel as string);

async function save(page: Page) {
  const b64 = await page.evaluate(async () => {
    const w = window as unknown as W;
    const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
    const bytes: Uint8Array = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

test('draw a filled rectangle, take its outline away: nothing around it, on screen and in the saved PDF', async ({ page }) => {
  await open(page);
  // The Shapes tool (a rectangle), with a fill for the next shape.
  await page.keyboard.press('s');
  await panel(page).getByRole('radiogroup', { name: 'Fill color' }).getByRole('radio').nth(3).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.move(pg.x + 150, pg.y + 200);
  await page.mouse.down();
  await page.mouse.move(pg.x + 300, pg.y + 300, { steps: 5 });
  await page.mouse.up();
  let s = await shapeOf(page);
  expect([s.shape, !!s.fill, s.noOutline ?? false, s.width]).toEqual(['rect', true, false, 2]);

  // Select it (its fill takes the click).
  await page.keyboard.press('v');
  await page.mouse.click(pg.x + 220, pg.y + 250);
  const outline = panel(page).getByRole('radiogroup', { name: 'Outline color' });
  const none = outline.getByRole('radio', { name: 'No outline' });
  // First in the row, named, with a tooltip.
  await expect(outline.getByRole('radio').first()).toHaveAttribute('aria-label', 'No outline');
  await expect(none).toHaveAttribute('title', 'No outline');
  await none.click();
  await expect(none).toHaveAttribute('aria-checked', 'true');
  s = await shapeOf(page);
  expect([s.noOutline, s.width]).toEqual([true, 2]);
  expect(await undoLabel(page)).toBe('No outline');
  // Nothing drawn around it: no outline element, and the selection frame sits on the shape's edge.
  const g = page.locator(`.page[data-index="0"] [data-annot-id="${s.id}"]`);
  await expect(g.locator('polyline')).toHaveCount(0);
  await expect(g.locator('polygon')).toHaveCount(1);
  const b = await page.evaluate(async (id) => {
    const { bounds } = await import(/* @vite-ignore */ '/src/lib/annotations.ts' as string);
    const a = (window as unknown as W).__doc.pages[0].annots.find((x: { id: string }) => x.id === id);
    const r = [Math.min(a.from[0], a.to[0]), Math.min(a.from[1], a.to[1]), Math.max(a.from[0], a.to[0]), Math.max(a.from[1], a.to[1])];
    return { bounds: bounds(a), rect: r };
  }, s.id);
  expect(b.bounds).toEqual(b.rect);
  // The thickness waits, disabled.
  const thickness = panel(page).locator('#mk-width');
  await expect(thickness).toBeDisabled();
  await expect(thickness).toHaveAttribute('title', 'No outline');

  // Neither fill nor outline: refused, with the reason, nothing changes.
  await panel(page).getByRole('radiogroup', { name: 'Fill color' }).getByRole('radio', { name: 'None' }).click();
  await expect(panel(page).getByText('A shape needs a fill or an outline.')).toBeVisible();
  expect((await shapeOf(page)).fill).not.toBeNull();
  expect(await undoLabel(page)).toBe('No outline');
  await expect(page.locator('div.visually-hidden[aria-live="polite"]:not(#page-announcer)')).toHaveText('A shape needs a fill or an outline.');

  // Keyboard: the swatch row is a radio group; one ring, on the focused swatch.
  await none.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(none).toBeFocused();
  const rings = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).outlineStyle !== 'none' && getComputedStyle(e).outlineWidth !== '0px').length);
  expect(rings).toBe(1);

  // Saved: the shape's appearance fills and never strokes; no border in the dictionary either.
  const bytes = await save(page);
  if (process.env.SHAPE_PDF) writeFileSync(process.env.SHAPE_PDF, bytes);
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots()!;
  const sq = annots.asArray().map((r) => doc.context.lookup(r as PDFRef, PDFDict)).find((d) => d.get(PDFName.of('Subtype'))?.toString() === '/Square')!;
  const ap = (sq.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')) as PDFRef);
  const content = new TextDecoder('latin1').decode(decodePDFRawStream(doc.context.lookup(ap) as PDFRawStream).decode());
  expect(content).toMatch(/\bre f\b/);
  expect(content).not.toMatch(/\b(S|s|B|B\*|b|b\*|RG|w)\b/);
  expect(sq.lookup(PDFName.of('BS'), PDFDict).get(PDFName.of('W'))!.toString()).toBe('0');
  expect(sq.lookup(PDFName.of('C'), PDFArray).size()).toBe(0);

  // A color brings the outline back, at its thickness; one undo step each.
  await outline.getByRole('radio').nth(1).click();
  s = await shapeOf(page);
  expect([s.noOutline ?? false, s.width]).toEqual([false, 2]);
  await expect(thickness).toBeEnabled();
  await expect(g.locator('polyline')).not.toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await shapeOf(page)).noOutline).toBe(true);
});

test('several shapes: Mixed when only some have an outline; the choice goes to all', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    const pid = w.__doc.pages[0].id;
    const base = { type: 'shape', color: [0.1, 0.1, 0.1], fill: [0.2, 0.5, 0.9], width: 3, opacity: 1 };
    w.__actions.addAnnotation(pid, { ...base, id: 'a', shape: 'rect', from: [100, 600], to: [200, 680] });
    w.__actions.addAnnotation(pid, { ...base, id: 'b', shape: 'ellipse', noOutline: true, from: [250, 600], to: [350, 680] });
    w.__viewer.setTool('select');
    w.__viewer.selectObjects({ pageId: pid, ids: ['a', 'b'] });
  });
  const outline = panel(page).getByRole('radiogroup', { name: 'Outline color' });
  // Mixed: nothing shown as chosen.
  for (const r of await outline.getByRole('radio').all()) await expect(r).toHaveAttribute('aria-checked', 'false');
  await outline.getByRole('radio', { name: 'No outline' }).click();
  const all = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.map((a: { noOutline?: boolean }) => a.noOutline ?? false));
  expect(all).toEqual([true, true]);
  expect(await undoLabel(page)).toBe('No outline');
  await expect(outline.getByRole('radio', { name: 'No outline' })).toHaveAttribute('aria-checked', 'true');
});
