// Edit content › Edit: a text block of the PDF becomes one of our text boxes.
// Fidelity: before typing anything, the saved page has every line where it
// was (baseline and start within 0.75 pt, one pixel at 100%) and looks the
// same (PDF.js renders, compared). Then undo/redo, the discard rule and saving.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type W = Record<string, any>;

async function open(page: Page, fixture: string) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: fixture, mimeType: 'application/pdf', buffer: readFileSync(`test-fixtures/content/${fixture}`) });
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
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Edit content' }).click();
  await expect(page.locator('.page[data-index="0"] .content-hit').first()).toBeVisible();
}

const block = (page: Page, start: string) => page.locator('.page[data-index="0"]').getByRole('button', { name: new RegExp(`^Text block: ${start}`) });

/** Select a block and press Enter: the editor opens on the new text box. */
async function convert(page: Page, start: string) {
  const b = block(page, start);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.rich-editor')).toBeVisible();
}

/**
 * The original page and the page as it would be saved now, both through PDF.js:
 * the lines of text (baseline y, start x, text) inside `box`, and how many
 * pixels in it differ.
 */
async function compare(page: Page, box: number[]) {
  return page.evaluate(async (box) => {
    const w = window as unknown as W;
    const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
    const { loadPdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdfjs.ts' as string);
    const { renderToCanvas } = await import(/* @vite-ignore */ '/src/lib/pdf/render.ts' as string);
    const original = await loadPdf(w.__doc.sources.get('file-1').bytes.slice());
    const now = await loadPdf((await writePdf(w.__doc, w.__doc.pages, 'preserve')).slice());
    const read = async (pdf: any) => {
      const p = await pdf.getPage(1);
      const items = (await p.getTextContent()).items.filter((i: any) => i.str?.trim());
      const inBox = items.filter((i: any) => i.transform[4] >= box[0] - 2 && i.transform[4] <= box[2] + 2 && i.transform[5] >= box[1] - 2 && i.transform[5] <= box[3] + 2);
      const lines = new Map<number, { x: number; y: number; text: string }>();
      for (const i of inBox) {
        const y = Math.round(i.transform[5] * 4) / 4;
        const key = [...lines.keys()].find((k) => Math.abs(k - y) < 2) ?? y;
        const l = lines.get(key);
        if (!l) lines.set(key, { x: i.transform[4], y: i.transform[5], text: i.str });
        else {
          l.x = Math.min(l.x, i.transform[4]);
          l.text += ' ' + i.str;
        }
      }
      const vp = p.getViewport({ scale: 96 / 72 });
      const canvas: HTMLCanvasElement = await renderToCanvas(p, vp).promise;
      const [x0, y0] = vp.convertToViewportPoint(box[0] - 4, box[3] + 4);
      const [x1, y1] = vp.convertToViewportPoint(box[2] + 4, box[1] - 4);
      const sx = Math.max(0, Math.floor(Math.min(x0, x1)));
      const sy = Math.max(0, Math.floor(Math.min(y0, y1)));
      const data = canvas.getContext('2d')!.getImageData(sx, sy, Math.ceil(Math.abs(x1 - x0)), Math.ceil(Math.abs(y1 - y0)));
      return { lines: [...lines.values()].sort((a, b) => b.y - a.y), data: Array.from(data.data), width: data.width, png: canvas.toDataURL() };
    };
    const a = await read(original);
    const b = await read(now);
    // A pixel is off when nothing within one pixel of it in the other render looks like it.
    const W = a.width;
    const H = Math.min(a.data.length, b.data.length) / 4 / W;
    const lum = (d: number[], x: number, y: number) => d[(y * W + x) * 4] + d[(y * W + x) * 4 + 1] + d[(y * W + x) * 4 + 2];
    const near = (d1: number[], d2: number[], x: number, y: number) => {
      const v = lum(d1, x, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && Math.abs(lum(d2, xx, yy) - v) <= 3 * 96) return true;
        }
      return false;
    };
    let ink = 0;
    let differ = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (lum(a.data, x, y) < 600 || lum(b.data, x, y) < 600) ink++;
        if (!near(a.data, b.data, x, y) || !near(b.data, a.data, x, y)) differ++;
      }
    return { before: a.lines, after: b.lines, ink, differ, png: [a.png, b.png] };
  }, box);
}

/** The block's box in PDF space, from the analysis. */
const boxOf = (page: Page, start: string) =>
  page.evaluate((start) => {
    const w = window as unknown as W;
    const p = w.__doc.pages[0];
    const a = w.__viewer.content.get(w.__doc.source(p), p.sourceIndex);
    const item = a.items.find((i: any) => i.text?.startsWith(start));
    const xs = item.quad.map((q: number[]) => q[0]);
    const ys = item.quad.map((q: number[]) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }, start);

const CASES = [
  { file: 'chrome-aligned.pdf', start: 'Members agreed', align: 'justify', what: 'justified, four lines' },
  { file: 'chrome-aligned.pdf', start: 'Volunteers will', align: 'center', what: 'centred, three lines' },
  { file: 'chrome-aligned.pdf', start: 'The committee', align: 'right', what: 'right-aligned' },
  { file: 'chrome-aligned.pdf', start: 'Čitaonica', align: 'left', what: 'Croatian' },
  { file: 'chrome-aligned.pdf', start: 'A first estimate', align: 'left', what: 'serif (Tinos)' },
  { file: 'chrome-aligned.pdf', start: 'Questions about', align: 'left', what: 'monospace (Cousine)' },
  { file: 'chrome-croatian-subset.pdf', start: 'Čišćenje', align: 'left', what: 'bold words inside a paragraph' },
  { file: 'chrome-article.pdf', start: 'Library Wing', align: 'left', what: 'a bold heading' },
  { file: 'rotated-pages.pdf', start: 'The committee', align: 'left', what: 'on a page turned 90°, Helvetica' },
];

for (const c of CASES) {
  test(`converting looks the same: ${c.what}`, async ({ page }) => {
    await open(page, c.file);
    const box = await boxOf(page, c.start);
    await convert(page, c.start);
    const annot = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots[0]);
    expect(annot.type).toBe('text');
    expect(annot.align).toBe(c.align);
    const r = await compare(page, box);
    if (process.env.SHOT_DIR) {
      const fs = await import('node:fs');
      r.png.forEach((p, i) => fs.writeFileSync(`${process.env.SHOT_DIR}/${c.start.replace(/\W/g, '')}-${i}.png`, Buffer.from(p.split(',')[1], 'base64')));
    }
    expect(r.after.map((l) => l.text.replace(/\s+/g, ''))).toEqual(r.before.map((l) => l.text.replace(/\s+/g, '')));
    for (let i = 0; i < r.before.length; i++) {
      expect(Math.abs(r.after[i].y - r.before[i].y)).toBeLessThan(0.76);
      expect(Math.abs(r.after[i].x - r.before[i].x)).toBeLessThan(0.76);
    }
    // Within a pixel almost everywhere (our layout doesn't kern, so a glyph can sit a fraction of a pixel off).
    console.log(`${c.what}: ${((100 * r.differ) / Math.max(1, r.ink)).toFixed(1)}% of the ink more than a pixel off`);
    // Serif fonts kern a lot: there the words drift a little toward the end of a line (measured: 8.5%).
    expect(r.differ / Math.max(1, r.ink)).toBeLessThan(c.what.startsWith('serif') ? 0.1 : 0.02);
  });
}

test('typing, one undo step for converting and typing; undo restores the original, redo the edited box; saved as real text', async ({ page }) => {
  await open(page, 'chrome-aligned.pdf');
  await convert(page, 'Čitaonica');
  // The caret to the very start: a click at the box's top-left corner.
  await page.locator('.rich-editor').click({ position: { x: 4, y: 6 } });
  await page.keyboard.type('Novo: čćžšđ ');
  // Click outside: the edit is done.
  await page.locator('.page[data-index="0"]').click({ position: { x: 20, y: 700 } });
  await expect(page.locator('.rich-editor')).toHaveCount(0);
  const state = () =>
    page.evaluate(() => {
      const w = window as unknown as W;
      return { undo: w.__doc.history.undoLabel ?? null, src: w.__doc.pages[0].sourceId, annots: (w.__doc.pages[0].annots ?? []).map((a: any) => a.text) };
    });
  let s = await state();
  expect(s.undo).toBe('Edit text');
  expect(s.annots[0]).toMatch(/^Novo: čćžšđ Čitaonica će biti otvorena/);
  // One step: undo goes back to the untouched original.
  await page.keyboard.press('ControlOrMeta+z');
  s = await state();
  expect(s).toEqual({ undo: null, src: 'file-1', annots: [] });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  s = await state();
  expect(s.annots[0]).toMatch(/^Novo: čćžšđ/);

  const text = await page.evaluate(async () => {
    const w = window as unknown as W;
    const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
    const { loadPdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdfjs.ts' as string);
    const pdf = await loadPdf((await writePdf(w.__doc, w.__doc.pages, 'preserve')).slice());
    return (await (await pdf.getPage(1)).getTextContent()).items.map((i: any) => i.str).join(' ');
  });
  // Real text, Croatian letters included; the original words are there once (from the box), not twice.
  expect(text).toContain('Novo: čćžšđ');
  expect(text.split('Čitaonica').length - 1).toBe(1);
  expect(text.split('Šetnja').length - 1).toBe(1);
});

test('leaving without a change: the original comes back, no undo step', async ({ page }) => {
  await open(page, 'chrome-aligned.pdf');
  await convert(page, 'Members agreed');
  await page.keyboard.press('Escape');
  await expect(page.locator('.rich-editor')).toHaveCount(0);
  const s = await page.evaluate(() => {
    const w = window as unknown as W;
    return { undo: w.__doc.history.undoLabel ?? null, redo: w.__doc.history.redoLabel ?? null, src: w.__doc.pages[0].sourceId, annots: (w.__doc.pages[0].annots ?? []).length, dirty: w.__doc.dirty };
  });
  expect(s).toEqual({ undo: null, redo: null, src: 'file-1', annots: 0, dirty: false });
  await expect(block(page, 'Members agreed')).toHaveClass(/selected/);
});

test('double-click puts the caret where it was clicked; text that can’t be converted says why', async ({ page }) => {
  await open(page, 'chrome-aligned.pdf');
  const b = block(page, 'Members agreed');
  const r = (await b.boundingBox())!;
  await b.dblclick({ position: { x: 4, y: r.height - 6 } });
  await expect(page.locator('.rich-editor')).toBeVisible();
  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  const text = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots[0].text as string);
  // The click was at the start of the last line ("before the move…").
  expect(text).toMatch(/donated books Xbefore the move/);

  await open(page, 'rotated-text.pdf');
  await block(page, 'This line is turned').click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toContainText('Turned text can’t be converted into a text box. It can only be deleted.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rich-editor')).toHaveCount(0);
});
