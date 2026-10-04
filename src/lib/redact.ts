// Redaction, main-thread part: each marked page is rendered to an image with
// black boxes over the marked areas. The PDF worker then swaps the page's
// content for that image (see redactSource), so the text, images and vector
// content underneath are gone from the file, not just covered.
import { AnnotationMode } from 'pdfjs-dist';
import type { Rect } from './annotations';
import type { EditorDocument } from './document.svelte';
import { canvasToBlob } from './rasterize';
import type { RedactedPage } from './pdf/assemble';

/** Redacted pages become images at this resolution: sharp enough to read and print. */
export const REDACT_DPI = 200;
const JPEG_QUALITY = 0.85;
/** Safari refuses canvases much bigger than this. */
const MAX_PIXELS = 16_000_000;
/** Box color burned into the page (document content, not theme). */
const REDACT_FILL = '#000';

/** Render one source page, unrotated, with the marked areas filled in black. */
export async function renderRedactedPage(doc: EditorDocument, sourceId: string, index: number, marks: readonly Rect[]): Promise<RedactedPage> {
  const pdfPage = await doc.sources.get(sourceId)!.pdf.getPage(index + 1);
  const [x0, y0, x1, y1] = pdfPage.view;
  let scale = REDACT_DPI / 72;
  const pixels = (x1 - x0) * (y1 - y0) * scale * scale;
  if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
  // Rotation 0: the image lines up with the page's own coordinates, so the
  // page keeps its /Rotate, boxes, markup and crop exactly as before.
  const viewport = pdfPage.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Form values typed in and the file's own annotations are burned in too (they're removed from the page).
  await pdfPage.render({ canvas, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
  ctx.fillStyle = REDACT_FILL;
  for (const [ax, ay, bx, by] of marks) {
    const [px, py] = viewport.convertToViewportPoint(ax, ay);
    const [qx, qy] = viewport.convertToViewportPoint(bx, by);
    // Round outwards so no sliver of the original survives at the edges.
    const left = Math.floor(Math.min(px, qx)) - 1;
    const top = Math.floor(Math.min(py, qy)) - 1;
    ctx.fillRect(left, top, Math.ceil(Math.max(px, qx)) + 1 - left, Math.ceil(Math.max(py, qy)) + 1 - top);
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  canvas.width = canvas.height = 0;
  pdfPage.cleanup();
  return { index, jpeg: new Uint8Array(await blob.arrayBuffer()), box: [x0, y0, x1, y1] };
}
