// Editing a text box is what you see is what you get: the box and its text
// don't move when editing starts or ends, and the edit field wraps exactly
// like the layout used for the page and the PDF.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

test.use({ deviceScaleFactor: 1 });

async function openBlank(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { load: (p: string) => Promise<unknown> }).load = (p: string) => import(/* @vite-ignore */ p);
  });
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
}

interface Case {
  name: string;
  text: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  zoom?: number;
  rotate?: boolean;
  /** Rich text: these runs make one paragraph (mixed fonts and sizes). */
  runs?: { text: string; font?: string; size?: number; bold?: boolean; italic?: boolean }[];
}

const LONG = 'Several lines of text, wrapped by the layout, with Croatian letters čćđšž and ČĆĐŠŽ to be sure.\nSecond paragraph.';
const CASES: Case[] = [
  { name: 'one line', text: 'Hello world' },
  { name: 'several lines', text: LONG },
  { name: 'large size', text: 'Big words here', size: 48 },
  { name: 'small size', text: LONG, size: 8 },
  { name: 'bold', text: LONG, bold: true },
  { name: 'italic', text: LONG, italic: true },
  { name: 'center', text: LONG, align: 'center' },
  { name: 'right', text: LONG, align: 'right' },
  { name: 'justify', text: LONG, align: 'justify' },
  { name: 'zoom 200%', text: LONG, zoom: 2 },
  { name: 'rotated page', text: LONG, rotate: true },
  {
    name: 'rich text: mixed fonts and sizes',
    text: '',
    align: 'justify',
    runs: [
      { text: 'Mixed ' },
      { text: 'BIG ', size: 30 },
      { text: 'bold ', bold: true },
      { text: 'serif italic ', font: 'lora', italic: true },
      { text: 'and small text that wraps over the next lines ', size: 9 },
      { text: 'Čačić Đurđa', font: 'great-vibes', size: 20 },
    ],
  },
];

/** The box's rectangle and its first letter's position, as drawn. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector('.page[data-index="0"] .boxed[data-kind="text"]')!;
    const node = document.createTreeWalker(box.querySelector('.text')!, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent!.trim() ? 1 : 3) }).nextNode()!;
    const at = node.textContent!.search(/\S/);
    const r = document.createRange();
    r.setStart(node, at);
    r.setEnd(node, at + 1);
    const c = r.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { box: [b.left, b.top, b.width, b.height], letter: [c.left, c.top] };
  });

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 1);

for (const c of CASES) {
  test(`no jump when editing: ${c.name}`, async ({ page }) => {
    await openBlank(page);
    await page.evaluate(async (c) => {
      const w = window as unknown as Record<string, any>;
      const { ensureTextFont } = await w.load('/src/lib/font-metrics-store.svelte.ts');
      const { layoutText } = await w.load('/src/lib/text-layout.ts');
      if (c.rotate) w.__actions.rotate(90, [w.__doc.pages[0]]);
      for (const f of ['roboto', 'lora', 'great-vibes']) await ensureTextFont(f);
      await document.fonts.ready;
      const rotate = w.__doc.totalRotation(w.__doc.pages[0]);
      const paragraphs = c.runs && [{ runs: c.runs.map((r) => ({ font: 'roboto', size: 14, color: [0, 0, 0], ...r })) }];
      const a = layoutText({
        id: 'tx', type: 'text', color: [0, 0, 0], opacity: 1, font: 'roboto', size: c.size ?? 14, bold: c.bold, italic: c.italic, align: c.align,
        text: paragraphs ? paragraphs[0].runs.map((r) => r.text).join('') : c.text, lines: [], rotate, rect: rotate ? [200, 300, 240, 560] : [80, 600, 340, 640],
        ...(paragraphs ? { paragraphs } : {}),
      });
      w.__actions.addAnnotation(w.__doc.pages[0].id, a);
      w.__viewer.setTool('select');
      await w.__viewer.setZoom(c.zoom ?? 1);
      await new Promise((r) => setTimeout(r, 300));
      document.querySelector('.page[data-index="0"] .boxed[data-kind="text"]')!.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((r) => setTimeout(r, 300));
    }, c);

    const before = await measure(page);
    await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').dblclick();
    const field = page.getByRole('textbox', { name: 'Text', exact: true });
    await expect(field).toBeFocused();
    const during = await measure(page);
    const fieldBox = await page.locator('.rich-editor').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { rect: [r.left, r.top, r.width, r.height], border: getComputedStyle(el).borderTopWidth, scroll: 0 };
    });

    // The surface's own (invisible) text wraps exactly like the layout: read its line breaks from the text itself.
    const wrap = await field.evaluate((el) => {
      const lines: string[] = [];
      for (const p of el.querySelectorAll('p')) {
        // A new line starts where the next character sits left of the previous one (text runs left to right).
        let lastLeft = Infinity;
        let started = false;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        if (!p.textContent) lines.push('');
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent!;
          for (let i = 0; i < text.length; i++) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const rect = r.getClientRects()[0];
            const left = rect ? rect.left : lastLeft;
            if (!started || left < lastLeft - 1) {
              lines.push('');
              started = true;
            }
            lastLeft = left;
            lines[lines.length - 1] += text[i];
          }
        }
      }
      return lines.map((l) => l.trimEnd());
    });
    const expected = await page.evaluate(async () => {
      const w = window as unknown as Record<string, any>;
      const { layoutTextAnnotation } = await w.load('/src/lib/text-rich.ts');
      const { screenEnv } = await w.load('/src/lib/font-metrics-store.svelte.ts');
      return layoutTextAnnotation(w.__doc.pages[0].annots[0], screenEnv).lines.map((l: { text: string }) => l.text);
    });
    expect(wrap, 'edit field line breaks = layout line breaks').toEqual(expected);

    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    const after = await measure(page);

    expect(fieldBox.border).toBe('0px');
    expect(close(fieldBox.rect, before.box), `field ${fieldBox.rect} vs box ${before.box}`).toBe(true);
    expect(close(during.box, before.box) && close(after.box, before.box), 'box rectangle').toBe(true);
    expect(close(during.letter, before.letter) && close(after.letter, before.letter), `first letter ${before.letter} / ${during.letter} / ${after.letter}`).toBe(true);
  });
}

test('typing grows the box line by line, with the layout\'s line breaks; an empty box shows "Type here" and goes away', async ({ page }) => {
  await openBlank(page);
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  const field = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(field).toBeFocused();
  await expect(page.locator('.rich-editor p.placeholder[data-placeholder="Type here"]')).toBeVisible();
  const surface = page.locator('.rich-editor');
  const oneLine = (await surface.boundingBox())!.height;
  await page.keyboard.type('Short');
  expect((await surface.boundingBox())!.height).toBeCloseTo(oneLine, 0);
  await page.keyboard.type(' and then a good deal more text, so that it has to wrap onto further lines');
  expect((await surface.boundingBox())!.height).toBeGreaterThan(oneLine * 1.8);
  await page.keyboard.press('Escape');
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line')).not.toHaveCount(1);

  // An empty box is removed when editing ends.
  await page.mouse.click(pg.x + 80, pg.y + 400);
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__doc.history.undoLabel)).toBe('Add text');
});

test('while typing or pasting, the box shows the new text right away (not the previous text)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openBlank(page);
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  const field = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.type('Old text');
  await page.keyboard.press('Escape');

  const shown = () => page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line').allTextContents().then((l) => l.join('\n').replace(/ /g, ''));
  await expect.poll(shown).toBe('Old text');

  // Edit it: select everything and type over it.
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').dblclick();
  await expect(field).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('New');
  await expect.poll(shown).toBe('New');
  await page.keyboard.type('!');
  await expect.poll(shown).toBe('New!');
  await page.keyboard.press('Backspace');
  await expect.poll(shown).toBe('New');

  // Paste (plain text) at the end.
  await page.evaluate(() => navigator.clipboard.writeText(' pasted words'));
  await page.keyboard.press('ControlOrMeta+v');
  await expect(field).toHaveText('New pasted words');
  await expect.poll(shown).toBe('New pasted words');

  await page.keyboard.press('Escape');
  await expect.poll(shown).toBe('New pasted words');
  expect(await page.evaluate(() => (window as unknown as Record<string, any>).__doc.pages[0].annots[0].text)).toBe('New pasted words');
});
