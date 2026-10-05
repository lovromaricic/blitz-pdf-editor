// Crop mode at several zooms, on a turned page, with a turned and flipped
// image, and with very small and very large images: crop mode shows the object
// exactly where it is, and applying changes nothing on screen inside the frame.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';

type W = Record<string, any>;

const CASES = [
  { name: '50%', zoom: 0.5, pageTurn: 0, px: [400, 300], extra: {} },
  { name: '100%', zoom: 1, pageTurn: 0, px: [400, 300], extra: {} },
  { name: '400%', zoom: 4, pageTurn: 0, px: [400, 300], extra: {} },
  { name: 'turned page', zoom: 0.75, pageTurn: 90, px: [400, 300], extra: {} },
  { name: 'turned and flipped image', zoom: 1, pageTurn: 0, px: [400, 300], extra: { angle: 35, flipX: true, flipY: true } },
  { name: 'very small image (24 × 18 px)', zoom: 4, pageTurn: 0, px: [24, 18], extra: {} },
  { name: 'very large image (7000 × 5000 px)', zoom: 1, pageTurn: 0, px: [7000, 5000], extra: { angle: -20 } },
] as const;

async function open(page: Page, c: (typeof CASES)[number]) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'm.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(
    async ({ zoom, pageTurn, px, extra }) => {
      const w = window as unknown as W;
      if (pageTurn) w.__actions.rotate(pageTurn, [w.__doc.pages[0]]);
      await w.__viewer.setZoom(zoom);
      // Four colored quarters.
      const c = new OffscreenCanvas(px[0], px[1]);
      const ctx = c.getContext('2d')!;
      ['#e33', '#33e', '#3a3', '#ec3'].forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.fillRect((i % 2) * (px[0] / 2), Math.floor(i / 2) * (px[1] / 2), px[0] / 2, px[1] / 2);
      });
      await w.__actions.insertImageFiles([new File([await c.convertToBlob({ type: 'image/png' })], 'q.png', { type: 'image/png' })]);
      const pid = w.__doc.pages[0].id;
      const a = w.__doc.pages[0].annots[0];
      w.__actions.updateAnnotation(pid, { ...a, ...extra }, 'Edit');
      await new Promise((r) => setTimeout(r, 300));
      document.querySelector('.box-hit[data-kind="image"]')!.scrollIntoView({ block: 'center', inline: 'center' });
    },
    { zoom: c.zoom, pageTurn: c.pageTurn, px: [...c.px], extra: c.extra },
  );
  await page.evaluate(async () => {
    let last = performance.now();
    const onScroll = () => (last = performance.now());
    document.addEventListener('scroll', onScroll, true);
    while (performance.now() - last < 400) await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('scroll', onScroll, true);
  });
}

const close = (a: { x: number; y: number; width: number; height: number }, b: typeof a, d = 1.5) =>
  Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d && Math.abs(a.width - b.width) < d && Math.abs(a.height - b.height) < d;

for (const c of CASES) {
  test(`crop mode in place, and applying keeps what shows: ${c.name}`, async ({ page }) => {
    test.setTimeout(60000);
    await open(page, c);
    const box = page.locator('.box-hit[data-kind="image"]');
    const before = (await box.boundingBox())!;
    await box.dblclick();
    const frame = page.locator('.crop-mode .frame');
    await expect(frame).toBeFocused();
    // The frame is where the object was.
    expect(close((await frame.boundingBox())!, before)).toBe(true);

    // Keyboard: shrink from the bottom-right (Shift+Alt: 10 px a step) and move the image a little.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Alt+Shift+ArrowLeft');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Alt+Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowLeft');
    const framed = (await frame.boundingBox())!;
    const v = await page.evaluate(() => (window as unknown as W).__viewer.imageCrop.view);
    expect(v.frame[2]).toBeLessThan(v.image[2]);
    // What shows in the frame, at a few points.
    const pts = [
      [0.3, 0.3],
      [0.7, 0.6],
      [0.5, 0.5],
    ].map(([fx, fy]) => ({ x: framed.x + framed.width * fx, y: framed.y + framed.height * fy }));
    const shot = async () => {
      const buf = await page.screenshot();
      return page.evaluate(
        async ({ b64, pts }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const cv = new OffscreenCanvas(img.width, img.height);
          const ctx = cv.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const k = img.width / innerWidth;
          return pts.map((p) => Array.from(ctx.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data.slice(0, 3)));
        },
        { b64: buf.toString('base64'), pts },
      );
    };
    // (The shade covers only the outside of the frame: inside, the colors are the image's own.)
    const inMode = await shot();
    await page.keyboard.press('Enter');
    await expect(page.locator('.crop-mode')).toHaveCount(0);
    // Same place and size as the frame, and the same colors there.
    expect(close((await box.boundingBox())!, framed, 2)).toBe(true);
    const after = await shot();
    for (let i = 0; i < pts.length; i++) for (let k = 0; k < 3; k++) expect(Math.abs(after[i][k] - inMode[i][k])).toBeLessThan(40);
    const a = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots[0]);
    expect(a.crop).toBeDefined();

    // Saving cuts it (a large one too): the embedded image is the crop's pixel size.
    const saved = await page.evaluate(async () => {
      const w = window as unknown as W;
      const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
      const { storedImage } = await import(/* @vite-ignore */ '/src/lib/image-store.ts' as string);
      const { cropRectPx } = await import(/* @vite-ignore */ '/src/lib/image-cut.ts' as string);
      const a = w.__doc.pages[0].annots[0];
      const s = storedImage(a.imageKey);
      const bytes: Uint8Array = await writePdf(w.__doc, w.__doc.pages, 'preserve');
      let b = '';
      for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { rect: cropRectPx(a.crop, [s.width, s.height]) as number[], b64: btoa(b) };
    });
    const pdf = await PDFDocument.load(Buffer.from(saved.b64, 'base64'));
    const dims = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [o] : []))
      .map((o) => [(o.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(), (o.dict.get(PDFName.of('Height')) as PDFNumber).asNumber()]);
    // The image (and its soft mask, when it has one): the cut's size only.
    expect(dims.length).toBeGreaterThan(0);
    for (const d of dims) expect(d).toEqual(saved.rect.slice(2));
  });
}
