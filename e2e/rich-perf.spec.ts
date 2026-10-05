// About 50 pages of text in one box (220,000 characters, 1,500 paragraphs)
// must stay responsive while typing: only the paragraph being typed in is laid
// out and redrawn.
import { expect, test } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

test('typing in a box with ~50 pages of text stays responsive', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as unknown as { load: (p: string) => Promise<unknown> }).load = (p: string) => import(/* @vite-ignore */ p);
  });
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible();
  const chars = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const { ensureTextFont } = await w.load('/src/lib/font-metrics-store.svelte.ts');
    const { layoutText } = await w.load('/src/lib/text-layout.ts');
    await ensureTextFont('roboto');
    const sentence = 'The quick brown fox jumps over the lazy dog near the river bank, Čačić. ';
    const base = { font: 'roboto', size: 11, color: [0, 0, 0] };
    // Every fifth paragraph has a link in it (they're laid out, drawn and saved like any run).
    const paragraphs = Array.from({ length: 1500 }, (_, i) => ({
      runs: [
        { ...base, text: sentence.repeat(2) + i, ...(i % 7 === 0 ? { bold: true } : {}) },
        ...(i % 5 === 0 ? [{ ...base, text: ' see example.com', color: [0.067, 0.333, 0.8], underline: true, link: { kind: 'url', href: 'https://example.com/' } }] : []),
      ],
    }));
    const a = layoutText({ id: 'long', type: 'text', color: [0, 0, 0], opacity: 1, font: 'roboto', size: 11, text: '', paragraphs, rotate: 0, rect: [60, 780, 540, 800] });
    w.__actions.addAnnotation(w.__doc.pages[0].id, a);
    w.__viewer.setTool('select');
    return a.text.length;
  });
  expect(chars).toBeGreaterThan(200_000);
  await page.locator('.page[data-index="0"] .box-hit[data-kind="text"]').dblclick();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();

  // From a keystroke to the box on screen showing it (two animation frames).
  const times: number[] = [];
  for (let i = 0; i < 12; i++) {
    times.push(
      await page.evaluate(async (i) => {
        const start = performance.now();
        // Spaces too: each one checks for an address typed before it.
        document.execCommand('insertText', false, i % 3 === 2 ? ' ' : 'x');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - start;
      }, i),
    );
  }
  const later = times.slice(2).sort((a, b) => a - b);
  const median = later[Math.floor(later.length / 2)];
  test.info().annotations.push({ type: 'keystroke ms', description: times.map(Math.round).join(', ') });
  expect(median, `median keystroke ${Math.round(median)} ms`).toBeLessThan(60);
  // The typed text is in the box.
  await expect.poll(() => page.locator('.page[data-index="0"] .boxed[data-kind="text"] .text').evaluate((el) => el.textContent!.includes('xx xx xx'))).toBe(true);

  // Saving it all (300 links, one annotation per line) takes seconds, not minutes.
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const { writePdf } = await w.load('/src/lib/pdf/pdf-writer.ts');
    const start = performance.now();
    const bytes = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    return { ms: performance.now() - start, size: bytes.length };
  });
  test.info().annotations.push({ type: 'save', description: `${Math.round(saved.ms)} ms, ${Math.round(saved.size / 1024)} KB` });
  expect(saved.ms).toBeLessThan(30_000);
});
