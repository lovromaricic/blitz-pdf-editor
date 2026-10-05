// Edit content: the PDF's own text blocks and images. Hover outlines, click
// selects (Shift adds), Delete removes them from the file for real (checked by
// saving, reopening and reading the text back), undo restores the original.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';

type W = Record<string, any>;

async function openBytes(page: Page, name: string, bytes: Uint8Array) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}
const open = (page: Page, fixture: string) => openBytes(page, fixture, readFileSync(`test-fixtures/content/${fixture}`));

async function editContent(page: Page) {
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Edit content' }).click();
}
const hits = (page: Page, index = 0) => page.locator(`.page[data-index="${index}"] .content-hit`);
const hit = (page: Page, name: string | RegExp, index = 0) => page.locator(`.page[data-index="${index}"]`).getByRole('button', { name });

/** The saved file's text (PDF.js), page by page. */
async function savedText(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as W;
    const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
    const { loadPdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdfjs.ts' as string);
    const bytes: Uint8Array = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    const pdf = await loadPdf(bytes.slice());
    const out: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) out.push((await (await pdf.getPage(i)).getTextContent()).items.map((x: { str?: string }) => x.str ?? '').join(' '));
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { text: out, b64: btoa(s), size: bytes.length };
  });
}

test('hover outlines a block, click selects it, Delete removes it from the file; save, reopen, undo and redo', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  await editContent(page);
  await expect(hits(page)).toHaveCount(9);
  const para = hit(page, /^Text block: The committee met/);
  await para.hover();
  await expect(para).toHaveClass(/hovered/);
  await expect(page.locator('.content-label')).toHaveText('Text block');
  await para.click();
  await expect(para).toHaveClass(/selected/);
  await expect(page.getByRole('heading', { name: 'Original text' })).toBeVisible();
  await expect(page.locator('.panel dd').first()).toHaveText('Arimo');
  await expect(page.locator('.panel dd').nth(1)).toHaveText('11 pt');
  await page.keyboard.press('Delete');
  await expect(hits(page)).toHaveCount(8);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe('Delete text');

  // The image, from its context menu.
  await hit(page, /^Image, 320 by 180/).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(hits(page)).toHaveCount(7);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe('Delete image');

  const saved = await savedText(page);
  expect(saved.text[0]).not.toContain('committee met on Tuesday');
  expect(saved.text[0]).toContain('Volunteers will catalogue');
  expect(saved.size).toBeLessThan(20000);
  expect(Buffer.from(saved.b64, 'base64').toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/);

  // Reopen the saved file: the block and the image aren't there.
  await openBytes(page, 'saved.pdf', Buffer.from(saved.b64, 'base64'));
  await editContent(page);
  await expect(hits(page)).toHaveCount(7);
  await expect(hit(page, /The committee met/)).toHaveCount(0);
  await expect(hit(page, /^Image/)).toHaveCount(0);
});

test('undo restores the original exactly; Shift+click deletes several blocks in one step', async ({ page }) => {
  await open(page, 'chrome-croatian-subset.pdf');
  await editContent(page);
  await expect(hits(page)).toHaveCount(5);
  const before = await savedText(page);
  await hit(page, /^Text block: Obavijest/).click();
  await hit(page, /^Text block: Poštovani/).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('heading', { name: '2 items' })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(hits(page)).toHaveCount(3);
  expect(await page.evaluate(() => (window as unknown as W).__doc.history.undoLabel)).toBe('Delete 2 items');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(hits(page)).toHaveCount(5);
  const restored = await savedText(page);
  expect(restored.text).toEqual(before.text);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(hits(page)).toHaveCount(3);
  const after = await savedText(page);
  expect(after.text[0]).not.toContain('Obavijest');
  expect(after.text[0]).toContain('Đurđica Šimić');
});

test('our own objects take precedence over the content under them', async ({ page }) => {
  await open(page, 'chrome-article.pdf');
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__actions.addAnnotation(w.__doc.pages[0].id, { id: 'st', type: 'stamp', label: 'OK', color: [0.1, 0.35, 0.8], opacity: 1, rotate: 0, rect: [150, 640, 260, 670] });
  });
  await editContent(page);
  await expect(hits(page)).toHaveCount(9);
  await page.locator('[data-annot-id="st"]').click();
  const sel = await page.evaluate(() => ({ o: (window as unknown as W).__viewer.objectSelection, c: (window as unknown as W).__viewer.contentSelection }));
  expect(sel.o?.ids).toEqual(['st']);
  expect(sel.c).toBeNull();
});

test('on a turned page, zoomed in, with margins showing: the outline sits on the text', async ({ page }) => {
  await open(page, 'rotated-pages.pdf');
  await page.evaluate(async () => {
    const w = window as unknown as W;
    await w.__viewer.setZoom(2);
    w.__viewer.showMargins = true;
    w.__viewer.goToPage(0);
  });
  await page.waitForTimeout(600);
  await editContent(page);
  await expect(hits(page)).toHaveCount(2);
  const title = hit(page, /^Text block: Page turned 90/);
  await title.scrollIntoViewIfNeeded();
  const span = page.locator('.page[data-index="0"] .textLayer span', { hasText: 'Page turned 90 degrees' }).first();
  const a = (await title.boundingBox())!;
  const b = (await span.boundingBox())!;
  // The page is turned a quarter: the line runs down the screen, and both boxes agree within a few px.
  expect(a.height).toBeGreaterThan(a.width);
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(8);
  await title.click();
  await page.keyboard.press('Delete');
  await expect(hits(page)).toHaveCount(1);
  expect((await savedText(page)).text[0]).not.toContain('Page turned 90');
});

test('a scan: says so, and deleting it asks first', async ({ page }) => {
  await open(page, 'scanned.pdf');
  await editContent(page);
  await expect(page.locator('.content-note')).toHaveText('This page is a scan. There is no text to edit.');
  await hit(page, /^Image/).click();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The page will be blank.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(hits(page)).toHaveCount(1);
  await hit(page, /^Image/).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(hits(page)).toHaveCount(0);
  expect((await savedText(page)).size).toBeLessThan(3000);
});

test('a signed PDF: a warning before the first edit only', async ({ page }) => {
  await open(page, 'signed.pdf');
  await editContent(page);
  await hit(page, /^Text block: Signed agreement/).click();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This PDF is digitally signed. Editing it will invalidate the signature.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(hits(page)).toHaveCount(2);
  await hit(page, /^Text block: Signed agreement/).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  await expect(hits(page)).toHaveCount(1);
  await hit(page, /^Text block/).click();
  await page.keyboard.press('Delete');
  await expect(hits(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('files that can’t be edited say so and offer nothing', async ({ page }) => {
  await open(page, 'encrypted-no-modify.pdf');
  await editContent(page);
  await expect(page.locator('.content-note')).toHaveText(/permissions don’t allow changing its content/);
  await expect(hits(page)).toHaveCount(0);

  await open(page, 'text-outlines.pdf');
  await editContent(page);
  await expect(page.locator('.content-note')).toHaveText('There’s no text or image on this page that can be edited.');

  // Malformed content.
  const doc = await PDFDocument.create();
  const p = doc.addPage([300, 300]);
  p.drawText('x', { font: await doc.embedFont(StandardFonts.Helvetica) });
  p.node.set((await import('@cantoo/pdf-lib')).PDFName.of('Contents'), doc.context.register(doc.context.flateStream('BT /F1 12 Tf (unterminated Tj ET')));
  await openBytes(page, 'broken.pdf', await doc.save());
  await editContent(page);
  await expect(page.locator('.content-note')).toHaveText('This page’s content can’t be edited.');
  await expect(hits(page)).toHaveCount(0);
});
