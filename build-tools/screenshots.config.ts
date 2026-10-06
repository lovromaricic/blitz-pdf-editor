// The README's screenshots: one entry per picture. Add, remove or change an
// entry here; `npm run screenshots` makes them all, `npm run screenshots --
// --only <id>` one. A file of the same name in docs/screenshots/custom/ is
// used as it is instead (never regenerated).
//
// Only our own sample documents (test-fixtures/content/, generated from our
// own made-up text) and objects made here: no real names, addresses or numbers.
import type { Page } from '@playwright/test';

export interface Shot {
  id: string;
  /** Output file in docs/screenshots/ (.webp or .png). */
  file: string;
  description: string;
  viewport: { width: number; height: number };
  /** 2 for phone shots. */
  deviceScaleFactor?: number;
  /** Sets the scene; the picture is taken when it returns. */
  steps: (page: Page, h: Helpers) => Promise<void>;
}

export interface Helpers {
  /** Open a sample PDF from test-fixtures/content/ (with this document title, if given) and wait until it's shown and still. */
  open(page: Page, fixture: string, title?: string): Promise<void>;
  /** Wait until nothing scrolls or animates for a moment. */
  settle(page: Page): Promise<void>;
}

const DESKTOP = { width: 1440, height: 900 };
/** The sample's title (it's a made-up proposal). */
const SAMPLE_TITLE = 'Library Wing Proposal';

export const SHOTS: Shot[] = [
  {
    id: 'landing',
    file: 'landing.webp',
    description: 'The landing screen with its falling-paper background',
    viewport: DESKTOP,
    steps: async (page) => {
      await page.goto('/');
      // The 3D background is ready, and has had a moment to fall.
      await page.locator('canvas.scene.ready').waitFor({ timeout: 20000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    id: 'editor',
    file: 'editor.webp',
    description: 'The editor with a document open, nothing selected',
    viewport: DESKTOP,
    steps: async (page, h) => {
      await h.open(page, 'chrome-article.pdf', SAMPLE_TITLE);
    },
  },
  {
    id: 'text-panel',
    file: 'editor-text-panel.webp',
    description: 'A text box selected, with the Text panel on the right',
    viewport: DESKTOP,
    steps: async (page, h) => {
      await h.open(page, 'chrome-article.pdf', SAMPLE_TITLE);
      await page.evaluate(async () => {
        const w = window as unknown as Record<string, any>;
        const { ensureTextFont } = await import(/* @vite-ignore */ '/src/lib/font-metrics-store.svelte.ts' as string);
        const { layoutText } = await import(/* @vite-ignore */ '/src/lib/text-layout.ts' as string);
        await ensureTextFont('arimo');
        const color = [0.11, 0.15, 0.19];
        const run = { font: 'arimo', size: 14, color };
        const box = layoutText({
          id: 'readme-text',
          type: 'text',
          rotate: 0,
          // Beside the picture, in view.
          rect: [326, 560, 588, 600],
          color,
          opacity: 1,
          font: 'arimo',
          size: 14,
          align: 'left',
          lineSpacing: 1.25,
          background: [0.9, 0.94, 1],
          text: '',
          paragraphs: [
            { runs: [{ ...run, text: 'Open ' }, { ...run, text: 'Monday to Friday', bold: true }, { ...run, text: ', 9:00 to 17:00' }] },
          ],
        });
        w.__actions.addAnnotation(w.__doc.pages[0].id, box);
        w.__viewer.selectAnnot({ pageId: w.__doc.pages[0].id, id: 'readme-text' });
      });
      await page.getByRole('heading', { name: 'Text', exact: true }).waitFor();
      await h.settle(page);
    },
  },
  {
    id: 'compress',
    file: 'compress.webp',
    description: 'Tools › Compress, with the size of each preset estimated',
    viewport: DESKTOP,
    steps: async (page, h) => {
      await h.open(page, 'chrome-article.pdf', SAMPLE_TITLE);
      await page.getByRole('menubar', { name: 'Main menu' }).getByRole('menuitem', { name: 'Tools' }).click();
      await page.getByRole('menuitem', { name: /^Compress/ }).click();
      // The estimates are in (sizes shown, nothing still being worked out).
      const panel = page.getByRole('complementary', { name: 'Properties' });
      await panel.getByText(/\d+(\.\d+)?\s?(KB|MB)/).first().waitFor({ timeout: 30000 });
      await h.settle(page);
    },
  },
];
