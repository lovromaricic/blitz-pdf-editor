// Renders a page exactly as the editor shows it (rotation, crop, markup, form
// values, watermark, page number) to a canvas. Used by Print and Export as images.
// PDF.js parses in its worker; drawing is chunked so the UI stays responsive.
import { AnnotationMode, type PageViewport } from 'pdfjs-dist';
import { isBoxed, type Annotation, type Point } from './annotations';
import { primitivesToSvg, toPrimitives } from './annotation-view';
import { drawBoxed } from './boxed-canvas';
import { layoutDecoration, type PageDecoration } from './decorations';
import type { EditorDocument, PageRef } from './document.svelte';
import { cssFont, loadFonts, measure } from './fonts';
import { decorationResolver } from './pdf/pdf-writer';
import { viewportFor } from './pdf/render';

/** Some browsers (Safari) refuse canvases much bigger than this. */
const MAX_PIXELS = 16_000_000;

export interface Rasterizer {
  /** Returns a canvas; release it with `canvas.width = 0` when done. */
  render(page: PageRef, dpi: number, intent?: 'display' | 'print'): Promise<HTMLCanvasElement>;
}

export async function createRasterizer(doc: EditorDocument): Promise<Rasterizer> {
  const decoFor = decorationResolver(doc);
  await loadFonts();
  return {
    // 'print' intent renders without waiting for animation frames: exports keep
    // going in background tabs.
    async render(page, dpi, intent = 'print') {
      const pdfPage = await doc.source(page).pdf.getPage(page.sourceIndex + 1);
      // Fit within the pixel budget, lowering the resolution if needed.
      const m = doc.displayedCrop(page);
      const size = doc.displaySize(page);
      let scale = dpi / 72;
      const pixels = size.width * size.height * scale * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);

      const viewport = viewportFor(pdfPage, scale, page.rotation);
      const full = document.createElement('canvas');
      full.width = Math.floor(viewport.width);
      full.height = Math.floor(viewport.height);
      // Form fields show the values typed in.
      await pdfPage.render({ canvas: full, viewport, intent, annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
      if (page.annots?.length) await drawAnnotations(full, page.annots, viewport);

      // Apply the crop by copying only the kept area.
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.floor(full.width - (m.left + m.right) * scale));
      out.height = Math.max(1, Math.floor(full.height - (m.top + m.bottom) * scale));
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(full, -m.left * scale, -m.top * scale);
      full.width = full.height = 0;
      const deco = decoFor(page);
      if (deco) drawDecoration(ctx, deco, out.width / scale, out.height / scale, scale);
      return out;
    },
  };
}

/** Draw editor markup onto a rendered page (highlights multiply, like on screen). */
async function drawAnnotations(canvas: HTMLCanvasElement, annots: readonly Annotation[], viewport: PageViewport) {
  const ctx = canvas.getContext('2d')!;
  const toScreen = (p: Point) => viewport.convertToViewportPoint(p[0], p[1]) as Point;
  const groups: [GlobalCompositeOperation, readonly Annotation[]][] = [
    ['multiply', annots.filter((a) => a.type === 'highlight')],
    ['source-over', annots.filter((a) => a.type !== 'highlight' && !isBoxed(a))],
  ];
  for (const [op, list] of groups) {
    if (!list.length) continue;
    const svg = primitivesToSvg(list.flatMap((a) => toPrimitives(a, toScreen, viewport.scale)), canvas.width, canvas.height);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    ctx.globalCompositeOperation = op;
    ctx.drawImage(img, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  await drawBoxed(ctx, annots.filter(isBoxed), toScreen, viewport.scale, viewport.rotation);
}

function drawDecoration(ctx: CanvasRenderingContext2D, deco: PageDecoration, width: number, height: number, scale: number) {
  for (const it of layoutDecoration(width, height, deco, (t, bold) => measure(t, bold ? 'sans-bold' : 'sans', 1))) {
    ctx.save();
    ctx.globalAlpha = it.opacity;
    ctx.fillStyle = `rgb(${it.color.map((c) => Math.round(c * 255)).join(' ')})`;
    ctx.font = cssFont(it.bold ? 'sans-bold' : 'sans', it.size * scale);
    ctx.translate(it.x * scale, it.y * scale);
    ctx.rotate((-it.angle * Math.PI) / 180);
    ctx.fillText(it.text, 0, 0);
    ctx.restore();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image (the page may be too large).'))), type, quality),
  );
}
