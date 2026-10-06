// Makes the README's screenshots (see screenshots.config.ts).
//   npm run screenshots                 all of them
//   npm run screenshots -- --only <id>  one (or several: --only a --only b)
// Starts the dev server, opens each scene in the installed Google Chrome,
// and saves docs/screenshots/<file> (WebP made by Chrome's own encoder,
// under 300 KB). A picture in docs/screenshots/custom/ with the same file
// name is used instead and never regenerated.
import { chromium, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, type Helpers } from './screenshots.config.ts';

const OUT = 'docs/screenshots';
const CUSTOM = join(OUT, 'custom');
const MAX_BYTES = 300 * 1024;

const only = process.argv.flatMap((a, i, all) => (a === '--only' && all[i + 1] ? [all[i + 1]] : []));
const unknown = only.filter((id) => !SHOTS.some((s) => s.id === id));
if (unknown.length) {
  console.error(`No screenshot called ${unknown.join(', ')}. Known: ${SHOTS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}
const shots = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;

/** Hidden in every picture: scrollbars and the text caret. */
const CLEAN_CSS = `
  * { scrollbar-width: none !important; caret-color: transparent !important; }
  *::-webkit-scrollbar { display: none !important; }
`;

const helpers: Helpers = {
  async open(page, fixture, title) {
    let bytes: Uint8Array = readFileSync(`test-fixtures/content/${fixture}`);
    if (title) {
      // A sample with a proper title (Chrome's print-to-PDF leaves "about:blank").
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      doc.setTitle(title);
      bytes = await doc.save();
    }
    await page.goto('/');
    await page.locator('input[type=file]').first().setInputFiles({ name: fixture, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await page.locator('.page[data-index="0"]').waitFor({ timeout: 20000 });
    await page.locator('#editor-main:focus').waitFor({ timeout: 20000 });
    // The landing's opening hand-over has finished (its layer is gone).
    await page.locator('.home-layer').waitFor({ state: 'detached', timeout: 20000 });
    await helpers.settle(page);
  },
  async settle(page) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      let last = performance.now();
      const onScroll = () => (last = performance.now());
      document.addEventListener('scroll', onScroll, true);
      while (performance.now() - last < 500) await new Promise((r) => setTimeout(r, 50));
      document.removeEventListener('scroll', onScroll, true);
    });
    await page.waitForTimeout(400);
  },
};

/** PNG bytes as WebP (or PNG, by the file name), as small as needed to fit under the limit. */
async function encode(page: Page, png: Buffer, file: string): Promise<Buffer> {
  if (file.endsWith('.png')) return png;
  for (const quality of [0.9, 0.85, 0.8, 0.7, 0.6]) {
    const b64 = await page.evaluate(
      async ({ data, quality }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return c.toDataURL('image/webp', quality).split(',')[1];
      },
      { data: png.toString('base64'), quality },
    );
    const out = Buffer.from(b64, 'base64');
    if (out.length <= MAX_BYTES) return out;
  }
  throw new Error(`${file} stays over ${MAX_BYTES / 1024} KB even at low quality`);
}

const server = await createServer({ server: { port: 5310, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ channel: 'chrome' });
mkdirSync(OUT, { recursive: true });
let failed = false;
try {
  for (const shot of shots) {
    if (existsSync(join(CUSTOM, shot.file))) {
      console.log(`${shot.id}: using docs/screenshots/custom/${shot.file} (not regenerated)`);
      continue;
    }
    const context = await browser.newContext({ baseURL: base, viewport: shot.viewport, deviceScaleFactor: shot.deviceScaleFactor ?? 1, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    try {
      await page.addInitScript((css) => {
        addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = css;
          document.head.append(s);
        });
      }, CLEAN_CSS);
      await shot.steps(page, helpers);
      const png = await page.screenshot({ type: 'png' });
      const out = await encode(page, png, shot.file);
      writeFileSync(join(OUT, shot.file), out);
      console.log(`${shot.id}: ${join(OUT, shot.file)} (${(out.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed = true;
      console.error(`${shot.id}: failed: ${(e as Error).message}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
