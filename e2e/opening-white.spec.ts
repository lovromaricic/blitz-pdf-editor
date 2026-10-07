// The landing screen's opening transition ends in plain white: the growing page
// goes under it before its lines turn into bands, the editor shows under the
// white, the white fades out and is removed. A slow file keeps the white up
// with "Opening…". Reduced motion: straight from the landing screen to the editor.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

type W = Record<string, any>;

const pdf = async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return Buffer.from(await d.save());
};

/** Open the landing screen, wait for the 3D scene, and log what is on screen every frame. */
async function landing(page: Page, { slowMs = 0 } = {}) {
  if (slowMs) {
    // A slow file: reading it takes this long.
    await page.addInitScript((ms) => {
      const read = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = async function () {
        const r = await read.call(this);
        await new Promise((res) => setTimeout(res, ms));
        return r;
      };
    }, slowMs);
  }
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as W).__paperScene), { timeout: 15000 }).toBe(true);
  await page.evaluate(() => {
    const log: { landing: boolean; white: number | null; waiting: boolean; editor: boolean }[] = [];
    (window as unknown as W).__states = log;
    const tick = () => {
      const white = document.querySelector('.whiteout');
      log.push({
        landing: !!document.querySelector('.home-layer'),
        white: white ? Number(getComputedStyle(white).opacity) : null,
        waiting: !!white?.querySelector('.waiting'),
        editor: !!document.getElementById('editor-main'),
      });
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const states = (page: Page) => page.evaluate(() => (window as unknown as W).__states as { landing: boolean; white: number | null; waiting: boolean; editor: boolean }[]);

async function choose(page: Page) {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: await pdf() });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.home-layer')).toHaveCount(0);
  await expect(page.locator('.whiteout')).toHaveCount(0);
}

/** Collapse the frame log to the sequence of stages seen. */
function stages(log: Awaited<ReturnType<typeof states>>) {
  const names = log.map((s) => (s.landing ? (s.white === null ? 'landing' : 'white over landing') : s.white === null ? 'editor' : 'white over editor'));
  return names.filter((n, i) => n !== names[i - 1]);
}

test('landing, then white, then the editor; the white is gone afterwards and focus is on the editor', async ({ page }) => {
  await landing(page);
  await choose(page);
  const log = await states(page);
  expect(stages(log)).toEqual(['landing', 'white over landing', 'white over editor', 'editor']);
  // The landing screen went only once the white was fully opaque.
  const firstWithout = log.find((s) => !s.landing)!;
  expect(firstWithout.white).toBeGreaterThan(0.99);
  // The landing screen and its 3D canvas are gone; focus on the editor's landmark, with no ring showing.
  await expect(page.locator('canvas.scene')).toHaveCount(0);
  await expect(page.locator('#editor-main')).toBeFocused();
  const rings = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).outlineStyle !== 'none' && getComputedStyle(e).outlineWidth !== '0px').length);
  expect(rings).toBe(0);
});

test('a slow file: the white stays with "Opening…" until the editor is ready', async ({ page }) => {
  await landing(page, { slowMs: 1800 });
  await page.locator('input[type=file]').first().setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: await pdf() });
  const white = page.locator('.whiteout');
  await expect(white.getByText('Opening…')).toBeVisible({ timeout: 5000 });
  await expect(white).toHaveAttribute('aria-hidden', 'true');
  expect(await white.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  // For screen readers the landing screen has the status.
  await expect(page.getByRole('status').filter({ hasText: 'Opening…' })).toHaveCount(1);
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(white).toHaveCount(0);
  const log = await states(page);
  expect(stages(log)).toEqual(['landing', 'white over landing', 'white over editor', 'editor']);
  // "Opening…" shows on a fully white screen (and fades out with the white).
  const waiting = log.filter((x) => x.waiting && x.landing);
  expect(waiting.length).toBeGreaterThan(10);
  for (const s of waiting) expect(s.white).toBeGreaterThan(0.99);
});

test('reduced motion: straight from the landing screen to the editor, no white', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await landing(page);
  await choose(page);
  expect(stages(await states(page))).toEqual(['landing', 'editor']);
});

test('a phone-sized window: the same sequence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await landing(page);
  await choose(page);
  expect(stages(await states(page))).toEqual(['landing', 'white over landing', 'white over editor', 'editor']);
});
