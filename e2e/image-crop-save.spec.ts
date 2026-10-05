// Cropped images in the saved PDF: only the kept pixels are embedded (decoded
// here and checked pixel by pixel), shared when the same crop is used twice,
// JPEG stays JPEG and PNG keeps its transparency, the cut is done in the image
// worker (with a main-thread fallback), and the saved page looks like the
// editor (PDF.js against the editor's own drawing, within a pixel).
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from '@cantoo/pdf-lib';
import jpeg from 'jpeg-js';
import { makeJpeg } from '../tests/image-fixtures';

type W = Record<string, any>;

async function open(page: Page) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'crop.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page[data-index="0"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-main')).toBeFocused();
  await page.evaluate(() => (window as unknown as W).__viewer.setZoom(1));
}

/**
 * Insert an image (red left half, blue right half; `alpha` for the red half),
 * as PNG or JPEG, or given bytes. Returns its id.
 */
async function insert(page: Page, kind: 'png' | 'jpeg', opts: { alpha?: number; bytes?: number[]; w?: number; h?: number } = {}) {
  return page.evaluate(
    async ({ kind, alpha, bytes, w, h }) => {
      const win = window as unknown as W;
      let file: File;
      if (bytes) file = new File([new Uint8Array(bytes)], `x.${kind}`, { type: `image/${kind}` });
      else {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
        ctx.fillRect(0, 0, w / 2, h);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(w / 2, 0, w / 2, h);
        file = new File([await c.convertToBlob({ type: `image/${kind}`, quality: 0.95 })], `x.${kind}`, { type: `image/${kind}` });
      }
      await win.__actions.insertImageFiles([file]);
      const list = win.__doc.pages[0].annots;
      return list[list.length - 1].id as string;
    },
    { kind, alpha: opts.alpha ?? 1, bytes: opts.bytes, w: opts.w ?? 400, h: opts.h ?? 300 },
  );
}

/** Crop (and otherwise change) an object the way crop mode does: through applyCropView. */
async function crop(page: Page, id: string, c: [number, number, number, number], extra: Record<string, unknown> = {}) {
  await page.evaluate(
    async ({ id, c, extra }) => {
      const w = window as unknown as W;
      const { applyCropView, enterCropFor } = await import(/* @vite-ignore */ '/src/lib/image-crop.ts' as string);
      const { storedImage } = await import(/* @vite-ignore */ '/src/lib/image-store.ts' as string);
      const pid = w.__doc.pages[0].id;
      let a = { ...w.__doc.pages[0].annots.find((x: { id: string }) => x.id === id), ...extra };
      const v = enterCropFor(a);
      const [ix, iy, iw, ih] = v.image;
      const s = storedImage(a.imageKey);
      // The frame over the wanted part (as seen: flips mirror it).
      const ux = a.flipX ? 1 - c[2] : c[0];
      const uy = a.flipY ? 1 - c[3] : c[1];
      a = applyCropView(a, { image: v.image, frame: [ix + ux * iw, iy + uy * ih, (c[2] - c[0]) * iw, (c[3] - c[1]) * ih] }, [s.width, s.height]);
      w.__actions.updateAnnotation(pid, a, 'Crop');
    },
    { id, c, extra },
  );
}

async function save(page: Page): Promise<Uint8Array> {
  const b64 = await page.evaluate(async () => {
    const w = window as unknown as W;
    const { writePdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdf-writer.ts' as string);
    const bytes: Uint8Array = await writePdf(w.__doc, w.__doc.pages, 'preserve');
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

interface Decoded {
  filter: string;
  width: number;
  height: number;
  /** RGBA. */
  data: Uint8Array;
  hasAlpha: boolean;
  bytes: number;
}

/** Every image XObject in the file, decoded to RGBA (with its soft mask as alpha). */
async function embeddedImages(bytes: Uint8Array): Promise<Decoded[]> {
  const doc = await PDFDocument.load(bytes);
  const masks = new Set<PDFRawStream>();
  const all = doc.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [o] : []));
  for (const o of all) {
    const m = o.dict.get(PDFName.of('SMask'));
    if (m instanceof PDFRef) masks.add(doc.context.lookup(m) as PDFRawStream);
  }
  const num = (o: PDFRawStream, k: string) => (o.dict.get(PDFName.of(k)) as PDFNumber).asNumber();
  const raw = (o: PDFRawStream) => {
    const f = String(o.dict.get(PDFName.of('Filter')));
    if (f === '/DCTDecode') {
      const d = jpeg.decode(o.getContents(), { useTArray: true, formatAsRGBA: true });
      return { filter: f, rgba: new Uint8Array(d.data) };
    }
    const flat = decodePDFRawStream(o).decode();
    const n = num(o, 'Width') * num(o, 'Height');
    const comps = flat.length / n;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      if (comps === 1) rgba.set([flat[i], flat[i], flat[i], 255], i * 4);
      else rgba.set([flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2], 255], i * 4);
    }
    return { filter: f, rgba };
  };
  return all
    .filter((o) => !masks.has(o))
    .map((o) => {
      const { filter, rgba } = raw(o);
      const m = o.dict.get(PDFName.of('SMask'));
      if (m instanceof PDFRef) {
        const a = raw(doc.context.lookup(m) as PDFRawStream).rgba;
        for (let i = 0; i < rgba.length / 4; i++) rgba[i * 4 + 3] = a[i * 4];
      }
      return { filter, width: num(o, 'Width'), height: num(o, 'Height'), data: rgba, hasAlpha: m instanceof PDFRef, bytes: o.getContents().length };
    });
}

const bluePixels = (img: Decoded) => {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 2] > 128 && img.data[i] < 128) n++;
  return n;
};

test('only the kept pixels are embedded: PNG, JPEG and transparent PNG; no blue anywhere', async ({ page }) => {
  await open(page);
  const png = await insert(page, 'png');
  const jpg = await insert(page, 'jpeg');
  const clear = await insert(page, 'png', { alpha: 0.5 });
  // The red half, and a bit less (the cut's edge is well inside the red).
  for (const id of [png, jpg, clear]) await crop(page, id, [0, 0, 0.45, 1]);
  const session = await page.evaluate(() => JSON.stringify((window as unknown as W).__doc.pages[0].annots));

  const images = await embeddedImages(await save(page));
  expect(images).toHaveLength(3);
  for (const img of images) {
    expect([img.width, img.height]).toEqual([180, 300]);
    expect(bluePixels(img)).toBe(0);
  }
  // JPEG stays JPEG (re-encoded once, high quality); PNG stays lossless, transparency kept.
  const byFilter = images.map((i) => i.filter).sort();
  expect(byFilter).toEqual(['/DCTDecode', '/FlateDecode', '/FlateDecode']);
  const jpegImg = images.find((i) => i.filter === '/DCTDecode')!;
  // Close to pure red everywhere (quality 0.95).
  let worst = 0;
  for (let i = 0; i < jpegImg.data.length; i += 4) worst = Math.max(worst, 255 - jpegImg.data[i], jpegImg.data[i + 1], jpegImg.data[i + 2]);
  expect(worst).toBeLessThan(24);
  const transparent = images.find((i) => i.hasAlpha)!;
  expect(transparent.data[3]).toBeGreaterThan(110);
  expect(transparent.data[3]).toBeLessThan(145);
  const opaque = images.find((i) => i.filter === '/FlateDecode' && !i.hasAlpha)!;
  expect(Array.from(opaque.data.slice(0, 4))).toEqual([255, 0, 0, 255]);

  // The session is unchanged: still cropped, still the full originals.
  expect(await page.evaluate(() => JSON.stringify((window as unknown as W).__doc.pages[0].annots))).toBe(session);
  // No crop information in the file.
  const text = new TextDecoder('latin1').decode(await save(page));
  expect(text).not.toMatch(/crop/i);
});

test('the same crop is embedded once, other crops each once, uncropped uses share the original', async ({ page }) => {
  await open(page);
  const a = await insert(page, 'png');
  await crop(page, a, [0, 0, 0.45, 1]);
  // Copies keep the crop (and the original).
  await page.keyboard.press('ControlOrMeta+d');
  await page.keyboard.press('ControlOrMeta+d');
  const ids: string[] = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.map((x: { id: string }) => x.id));
  expect(ids).toHaveLength(3);
  // One of them cropped differently (the blue half), and an uncropped one of the same file.
  await crop(page, ids[2], [0.55, 0, 1, 1], {});
  const again = await insert(page, 'png');
  const all = await page.evaluate(() => (window as unknown as W).__doc.pages[0].annots.map((x: { imageKey: string; crop?: number[] }) => [x.imageKey, x.crop]));
  // Re-inserting the same file: a new object of the same original.
  expect(new Set(all.map((x: unknown[]) => x[0])).size).toBe(1);
  expect(all[3][1]).toBeUndefined();
  expect(again).not.toBe(a);

  const images = await embeddedImages(await save(page));
  const sizes = images.map((i) => `${i.width}x${i.height}`).sort();
  expect(sizes).toEqual(['180x300', '180x300', '400x300']);
  // The blue cut has no red, the red one no blue.
  expect(images.filter((i) => i.width === 180 && bluePixels(i) === 0)).toHaveLength(1);
});

test('without crops the file is written as before: images embedded byte for byte', async ({ page }) => {
  await open(page);
  const original = makeJpeg(64, 48, (x) => (x < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  await insert(page, 'jpeg', { bytes: Array.from(original) });
  const doc = await PDFDocument.load(await save(page));
  const streams = doc.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [o] : []));
  expect(streams).toHaveLength(1);
  expect(Buffer.from(streams[0].getContents()).equals(Buffer.from(original))).toBe(true);
});

test('a phone photo (EXIF orientation): the cut is upright and only the kept part', async ({ page }) => {
  await open(page);
  // Shown 120 × 160: red top half, blue bottom half; stored turned (orientation 6).
  const photo = makeJpeg(120, 160, (_x, y) => (y < 80 ? [255, 0, 0, 255] : [0, 0, 255, 255]), 6);
  const id = await insert(page, 'jpeg', { bytes: Array.from(photo) });
  await crop(page, id, [0, 0, 1, 0.45]);
  const [img] = await embeddedImages(await save(page));
  expect([img.width, img.height]).toEqual([120, 72]);
  expect(bluePixels(img)).toBe(0);
});

test('the cut is made in the image worker; if the worker fails, on the main thread', async ({ page }) => {
  await open(page);
  const id = await insert(page, 'png');
  await crop(page, id, [0, 0, 0.45, 1]);
  await page.evaluate(() => {
    const w = window as unknown as W;
    const post = Worker.prototype.postMessage as (this: Worker, m: unknown, t?: unknown) => void;
    w.__cutsInWorker = 0;
    Worker.prototype.postMessage = function (this: Worker, m: unknown, t?: unknown) {
      if (m && typeof m === 'object' && 'cut' in m) {
        w.__cutsInWorker++;
        if (w.__breakWorker) throw new Error('worker unavailable');
      }
      return post.call(this, m, t);
    };
  });
  let [img] = await embeddedImages(await save(page));
  expect(await page.evaluate(() => (window as unknown as W).__cutsInWorker)).toBe(1);
  expect(bluePixels(img)).toBe(0);
  await page.evaluate(() => ((window as unknown as W).__breakWorker = true));
  [img] = await embeddedImages(await save(page));
  expect([img.width, img.height]).toEqual([180, 300]);
  expect(bluePixels(img)).toBe(0);
});

test('saving keeps the look: cropped, turned, flipped and see-through images, PDF.js against the editor (within a pixel)', async ({ page }) => {
  await open(page);
  // A picture with detail in every corner, so a wrong flip or offset shows.
  const quad = await page.evaluate(async () => {
    const c = new OffscreenCanvas(240, 180);
    const ctx = c.getContext('2d')!;
    const colors = ['#e33', '#33e', '#3a3', '#ec3'];
    colors.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect((i % 2) * 120, Math.floor(i / 2) * 90, 120, 90);
    });
    ctx.fillStyle = '#000';
    ctx.fillRect(20, 20, 30, 10);
    ctx.fillRect(20, 20, 10, 50);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(await insert(page, 'png', { bytes: quad }));
  const place = (k: number) => page.evaluate(
    ({ id, k }) => {
      const w = window as unknown as W;
      const a = w.__doc.pages[0].annots.find((x: { id: string }) => x.id === id);
      const x = 60 + (k % 2) * 270;
      const y = 420 - Math.floor(k / 2) * 300;
      w.__actions.updateAnnotation(w.__doc.pages[0].id, { ...a, rect: [x, y, x + 180, y + 135] }, 'Move');
    },
    { id: ids[k], k },
  );
  for (let k = 0; k < 4; k++) await place(k);
  await crop(page, ids[0], [0.05, 0.1, 0.7, 0.8]);
  await crop(page, ids[1], [0.1, 0, 0.9, 0.6], { angle: 30, flipX: true });
  await crop(page, ids[2], [0.2, 0.2, 1, 1], { flipY: true, opacity: 0.5 });
  await crop(page, ids[3], [0, 0.15, 0.6, 1], { angle: -50, flipX: true, flipY: true });
  const bytes = await save(page);

  const result = await page.evaluate(async (b64) => {
    const w = window as unknown as W;
    const { createRasterizer } = await import(/* @vite-ignore */ '/src/lib/rasterize.ts' as string);
    const { loadPdf } = await import(/* @vite-ignore */ '/src/lib/pdf/pdfjs.ts' as string);
    const { renderToCanvas } = await import(/* @vite-ignore */ '/src/lib/pdf/render.ts' as string);
    const dpi = 96;
    const editor: HTMLCanvasElement = await (await createRasterizer(w.__doc)).render(w.__doc.pages[0], dpi);
    const pdf = await loadPdf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const pg = await pdf.getPage(1);
    const saved: HTMLCanvasElement = await renderToCanvas(pg, pg.getViewport({ scale: dpi / 72 })).promise;
    const W0 = Math.min(editor.width, saved.width);
    const H0 = Math.min(editor.height, saved.height);
    const da = editor.getContext('2d')!.getImageData(0, 0, W0, H0).data;
    const db = saved.getContext('2d')!.getImageData(0, 0, W0, H0).data;
    const near = (d1: Uint8ClampedArray, i: number, d2: Uint8ClampedArray, x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W0 || yy >= H0) continue;
          const j = (yy * W0 + xx) * 4;
          if (Math.abs(d1[i] - d2[j]) < 48 && Math.abs(d1[i + 1] - d2[j + 1]) < 48 && Math.abs(d1[i + 2] - d2[j + 2]) < 48) return true;
        }
      return false;
    };
    let off = 0;
    let differing = 0;
    for (let y = 0; y < H0; y++)
      for (let x = 0; x < W0; x++) {
        const i = (y * W0 + x) * 4;
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) differing++;
        // Differences further than a pixel away (both ways): a real change of look.
        if (!near(da, i, db, x, y) || !near(db, i, da, x, y)) off++;
      }
    return { off, differing, size: [editor.width, editor.height, saved.width, saved.height], editor: editor.toDataURL(), saved: saved.toDataURL() };
  }, Buffer.from(bytes).toString('base64'));
  if (process.env.CROP_VIEWERS_DIR) {
    const fs = await import('node:fs');
    fs.writeFileSync(`${process.env.CROP_VIEWERS_DIR}/crop-look.pdf`, bytes);
    fs.writeFileSync(`${process.env.CROP_VIEWERS_DIR}/editor.png`, Buffer.from(result.editor.split(',')[1], 'base64'));
    fs.writeFileSync(`${process.env.CROP_VIEWERS_DIR}/pdfjs.png`, Buffer.from(result.saved.split(',')[1], 'base64'));
  }
  expect(Math.abs(result.size[0] - result.size[2])).toBeLessThanOrEqual(1);
  // Some pixels differ along edges (anti-aliasing); none by more than a pixel's shift.
  expect(result.off).toBe(0);
});

test('a 5 MB photo cropped to about half: the saved file shrinks accordingly', async ({ page }) => {
  test.setTimeout(120000);
  await open(page);
  // A photo-like JPEG (gradients and grain), about 5 MB.
  const id = await page.evaluate(async () => {
    const w = window as unknown as W;
    const c = new OffscreenCanvas(4000, 3000);
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 4000, 3000);
    g.addColorStop(0, '#2a6f97');
    g.addColorStop(0.5, '#e9c46a');
    g.addColorStop(1, '#6a4c93');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4000, 3000);
    const img = ctx.getImageData(0, 0, 4000, 3000);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 51) - 25;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    w.__photoBytes = blob.size;
    await w.__actions.insertImageFiles([new File([blob], 'photo.jpg', { type: 'image/jpeg' })]);
    return w.__doc.pages[0].annots[0].id as string;
  });
  const photo = await page.evaluate(() => (window as unknown as W).__photoBytes as number);
  const uncropped = (await save(page)).length;
  await crop(page, id, [0, 0, 0.5, 1]);
  const cropped = (await save(page)).length;
  console.log(`photo ${(photo / 1e6).toFixed(2)} MB; saved uncropped ${(uncropped / 1e6).toFixed(2)} MB; cropped to half ${(cropped / 1e6).toFixed(2)} MB`);
  expect(photo).toBeGreaterThan(4e6);
  expect(cropped).toBeLessThan(uncropped * 0.7);
});
