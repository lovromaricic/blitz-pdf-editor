// Links in text boxes: the link popover (Cmd/Ctrl+K, Edit menu, Text panel),
// automatic links, the link card, Cmd/Ctrl+click, and what the saved PDF holds.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

async function newBox(page: Page, text: string, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  const pg = (await page.locator('.page[data-index="0"]').boundingBox())!;
  await page.mouse.click(pg.x + 80, pg.y + 120);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  // The editor loads on first use (slower while other tests load it too).
  await expect(editor).toBeFocused({ timeout: 15000 });
  await page.keyboard.type(text);
  return editor;
}

async function selectChars(page: Page, key: 'Shift+ArrowLeft' | 'Shift+ArrowRight', n: number) {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await page.waitForTimeout(50);
}

/** Links in the editing surface: [text, href or page]. */
const editorLinks = (page: Page) =>
  page.locator('.rich-surface [data-link]').evaluateAll((els) =>
    els.map((el) => {
      const link = JSON.parse((el as HTMLElement).dataset.link!);
      return [el.textContent, link.kind === 'url' ? link.href : `page:${link.pageId}`];
    }),
  );

/** The saved PDF's link annotations, read back with PDF.js: per page, [url or destination page number, rect]. */
async function savedLinks(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const load = (p: string) => import(/* @vite-ignore */ p);
    const { writePdf } = await load('/src/lib/pdf/pdf-writer.ts');
    const { loadPdf } = await load('/src/lib/pdf/pdfjs.ts');
    const bytes = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    const pdf = await loadPdf(bytes);
    const out: { page: number; url?: string; dest?: number; rect: number[] }[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const annots = await (await pdf.getPage(i)).getAnnotations();
      for (const a of annots.filter((x: { subtype: string }) => x.subtype === 'Link')) {
        let dest: number | undefined;
        if (a.dest) dest = (await pdf.getPageIndex(a.dest[0])) + 1;
        out.push({ page: i, url: a.url, dest, rect: Array.from(a.rect as number[]).map((v) => Math.round(v)) });
      }
    }
    return out;
  });
}

test('Cmd/Ctrl+K links the selection; bad addresses are refused with a message', async ({ page }) => {
  await newBox(page, 'Read more here');
  await selectChars(page, 'Shift+ArrowLeft', 4);
  await page.keyboard.press('ControlOrMeta+k');
  const form = page.getByRole('dialog', { name: 'Add link' });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Text')).toHaveValue('here');
  const address = form.getByLabel('Address');
  await expect(address).toBeFocused();

  // Refused: javascript:, with odd case and leading spaces; also data: and file:.
  for (const bad of ['  JavaScript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd']) {
    await address.fill(bad);
    await address.press('Enter');
    await expect(form.getByRole('alert')).toHaveText('Only web (http, https), email (mailto) and phone (tel) links are allowed.');
  }
  // A bare international domain: https:// added, shown in punycode before applying.
  await address.fill(' bücher.de ');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.getByText('Opens https://xn--bcher-kva.de/')).toBeVisible();
  await address.press('Enter');
  await expect(form).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
  await expect.poll(() => editorLinks(page)).toEqual([['here', 'https://xn--bcher-kva.de/']]);
  // Blue and underlined in the box (the link look).
  const span = page.locator('.page[data-index="0"] .boxed[data-kind="text"] .line > span').last();
  await expect(span).toHaveCSS('color', 'rgb(17, 85, 204)');
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .bar')).toHaveCount(1);

  // Escape in the form cancels and changes nothing.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Add link' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
  await expect.poll(() => editorLinks(page)).toEqual([['here', 'https://xn--bcher-kva.de/']]);
});

test('with nothing selected the Text field is required, and the new text is inserted as the link', async ({ page }) => {
  await newBox(page, 'Mail ');
  await page.keyboard.press('ControlOrMeta+k');
  const form = page.getByRole('dialog', { name: 'Add link' });
  await expect(form.getByLabel('Text')).toBeFocused();
  await form.getByLabel('Address').fill('someone@example.com');
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(form.getByText('Enter the text to show.')).toBeVisible();
  await form.getByLabel('Text').fill('us');
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(form).toBeHidden();
  await expect.poll(() => editorLinks(page)).toEqual([['us', 'mailto:someone@example.com']]);
  // Typing goes on after the link, not inside it.
  await page.keyboard.type(' today');
  await expect.poll(() => editorLinks(page)).toEqual([['us', 'mailto:someone@example.com']]);
});

test('a typed address becomes a link on space or Enter; one undo takes back just the link', async ({ page }) => {
  await newBox(page, 'See example.com/docs, ');
  await expect.poll(() => editorLinks(page)).toEqual([['example.com/docs', 'https://example.com/docs']]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => editorLinks(page)).toEqual([]);
  await expect(page.locator('.rich-surface')).toHaveText('See example.com/docs, ');
  // Enter after an address works too; typing on doesn't join the link's undo step.
  await page.keyboard.type('or www.example.org');
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  await expect.poll(() => editorLinks(page)).toEqual([['www.example.org', 'https://www.example.org/']]);
  await page.keyboard.press('ControlOrMeta+z'); // "next"
  await expect.poll(() => editorLinks(page)).toEqual([['www.example.org', 'https://www.example.org/']]);
  await page.keyboard.press('ControlOrMeta+z'); // the link
  await expect.poll(() => editorLinks(page)).toEqual([]);
  // Not links: file names and numbers.
  await page.keyboard.type('report.pdf 1.5 ');
  await expect.poll(() => editorLinks(page)).toEqual([]);
});

test('the link card shows where a link goes, and edits, removes and opens it', async ({ page, context }) => {
  await newBox(page, 'Go to example.com now');
  await expect.poll(() => editorLinks(page)).toEqual([['example.com', 'https://example.com/']]);
  // The caret inside the link shows the card.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  const card = page.getByRole('group', { name: 'Link' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('https://example.com/');

  // Open: a new tab, with no way back to this one.
  const [popup] = await Promise.all([context.waitForEvent('page'), card.getByRole('button', { name: 'Open link in a new tab' }).click()]);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();

  // Edit: the form for the whole link.
  await card.getByRole('button', { name: 'Edit link' }).click();
  const form = page.getByRole('dialog', { name: 'Edit link' });
  await expect(form.getByLabel('Text')).toHaveValue('example.com');
  await form.getByLabel('Address').fill('https://example.net');
  await form.getByLabel('Address').press('Enter');
  await expect.poll(() => editorLinks(page)).toEqual([['example.com', 'https://example.net/']]);

  // Remove: back to the box's color, no underline.
  await page.keyboard.press('ArrowLeft');
  await card.getByRole('button', { name: 'Remove link' }).click();
  await expect.poll(() => editorLinks(page)).toEqual([]);
  await expect(page.locator('.page[data-index="0"] .boxed[data-kind="text"] .bar')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
});

test('Cmd/Ctrl+click opens a link while editing; a plain click puts the caret in it', async ({ page, context }) => {
  await newBox(page, 'Visit example.com today');
  const link = page.locator('.rich-surface [data-link]');
  await link.click();
  await expect(page.getByRole('group', { name: 'Link' })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click({ modifiers: ['ControlOrMeta'] })]);
  await popup.close();
});

test('Edit > Add link… and the Text panel button open the same form', async ({ page }) => {
  await newBox(page, 'Menu link');
  await selectChars(page, 'Shift+ArrowLeft', 4);
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: /^Add link…/ }).click();
  const form = page.getByRole('dialog', { name: 'Add link' });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Text')).toHaveValue('link');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  const panel = page.getByRole('complementary', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Add link' }).click();
  await expect(form).toBeVisible();
  await form.getByLabel('Address').fill('example.com');
  await form.getByLabel('Address').press('Enter');
  // The caret ends up after the link; back inside it, the button edits it.
  await expect(panel.getByRole('button', { name: 'Add link' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(panel.getByRole('button', { name: 'Edit link' })).toBeVisible();
});

test('links are saved as clickable link annotations; page links follow their page and go when it is deleted', async ({ page }) => {
  await newBox(page, 'Web example.com and the appendix', 3);
  // Link "appendix" to page 3.
  await selectChars(page, 'Shift+ArrowLeft', 8);
  await page.keyboard.press('ControlOrMeta+k');
  const form = page.getByRole('dialog', { name: 'Add link' });
  await form.getByLabel('Page in this document').check();
  await form.getByLabel('Page', { exact: true }).selectOption({ label: 'Page 3' });
  await form.getByRole('button', { name: 'Apply' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeHidden();

  let links = await savedLinks(page);
  expect(links.map((l) => [l.page, l.url ?? l.dest])).toEqual([
    [1, 'https://example.com/'],
    [1, 3],
  ]);
  // Each rectangle covers its words: they don't overlap.
  const [a, b] = links.map((l) => l.rect);
  expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true);

  // Move page 3 to the front: the link follows it (now page 1).
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__actions.move([w.__doc.pages[2]], 0);
  });
  links = await savedLinks(page);
  expect(links.map((l) => [l.page, l.url ?? l.dest])).toEqual([
    [2, 'https://example.com/'],
    [2, 1],
  ]);

  // Delete that page: the link goes (with a notice), the web link stays. Undo brings it back.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__actions.delete([w.__doc.pages[0]]);
  });
  await expect(page.getByText('Removed a link to the deleted page. Undo brings it back.')).toBeVisible();
  links = await savedLinks(page);
  expect(links.map((l) => [l.page, l.url ?? l.dest])).toEqual([[1, 'https://example.com/']]);
  await page.evaluate(() => (window as unknown as Record<string, any>).__doc.undo());
  links = await savedLinks(page);
  expect(links.map((l) => [l.page, l.url ?? l.dest])).toEqual([
    [2, 'https://example.com/'],
    [2, 1],
  ]);
});

test('links in an opened PDF open only with Cmd/Ctrl+click and the Select tool', async ({ page, context }) => {
  await newBox(page, 'Saved example.com link ');
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const path = '/src/lib/pdf/pdf-writer.ts';
    const { writePdf } = await import(/* @vite-ignore */ path);
    const bytes: Uint8Array = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  // Open the saved file (as a person would after downloading it).
  await page.evaluate(() => (window as unknown as Record<string, any>).__doc.markSaved());
  await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Close' }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: Buffer.from(saved, 'base64') });
  const link = page.locator('.page[data-index="0"] .linkAnnotation a');
  await expect(link).toHaveAttribute('href', 'https://example.com/');
  await expect(link).toHaveAttribute('rel', /noopener/);

  // A plain click doesn't open it.
  let opened = 0;
  context.on('page', () => opened++);
  await link.click();
  await page.waitForTimeout(300);
  expect(opened).toBe(0);
  // Cmd/Ctrl+click does, in a new tab with no way back to this one.
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click({ modifiers: ['ControlOrMeta'] })]);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  // With another tool, not even Cmd/Ctrl+click.
  await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Highlight', exact: true }).click();
  opened = 0;
  await link.click({ modifiers: ['ControlOrMeta'], force: true });
  await page.waitForTimeout(300);
  expect(opened).toBe(0);
});
