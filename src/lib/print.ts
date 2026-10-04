// Printing: render each page to an image and print them from a hidden frame.
// Works the same in every browser, and prints exactly what the editor shows
// (order, rotation, crop), without saving first.
import type { EditorDocument } from './document.svelte';
import { AnnotationMode, type PageViewport } from 'pdfjs-dist';
import { isBoxed, type Annotation, type Point } from './annotations';
import { drawBoxed } from './boxed-canvas';
import { primitivesToSvg, toPrimitives } from './annotation-view';
import { viewportFor } from './pdf/render';

const PRINT_DPI = 150;

export async function printDocument(doc: EditorDocument, onProgress: (p: number) => void) {
  const scale = PRINT_DPI / 72;
  const urls: string[] = [];
  const cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));

  try {
    for (let i = 0; i < doc.pages.length; i++) {
      const page = doc.pages[i];
      const pdfPage = await doc.source(page).pdf.getPage(page.sourceIndex + 1);
      const viewport = viewportFor(pdfPage, scale, page.rotation);
      const full = document.createElement('canvas');
      full.width = Math.floor(viewport.width);
      full.height = Math.floor(viewport.height);
      // Form fields print with the values typed in.
      await pdfPage.render({ canvas: full, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
      if (page.annots?.length) await drawAnnotations(full, page.annots, viewport);

      // Apply the crop by copying only the kept area.
      const m = doc.displayedCrop(page);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.floor(full.width - (m.left + m.right) * scale));
      out.height = Math.max(1, Math.floor(full.height - (m.top + m.bottom) * scale));
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(full, -m.left * scale, -m.top * scale);
      full.width = full.height = 0;

      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare a page for printing.'))), 'image/jpeg', 0.92),
      );
      out.width = out.height = 0;
      urls.push(URL.createObjectURL(blob));
      onProgress((i + 1) / doc.pages.length);
    }
  } catch (e) {
    cleanup();
    throw e;
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  const fdoc = frame.contentDocument!;
  fdoc.open();
  fdoc.write(`<!doctype html><html><head><title>${escapeHtml(doc.name)}</title><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; }
    .p { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; overflow: hidden; }
    .p:last-child { break-after: auto; page-break-after: auto; }
    img { max-width: 100%; max-height: 100%; }
  </style></head><body>${urls.map((u) => `<div class="p"><img src="${u}" alt=""></div>`).join('')}</body></html>`);
  fdoc.close();

  await Promise.all(Array.from(fdoc.images).map((img) => img.decode().catch(() => {})));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
    cleanup();
  };
  frame.contentWindow!.addEventListener('afterprint', () => setTimeout(remove, 0));
  // Some browsers return from print() before the dialog closes; keep the frame alive a while.
  setTimeout(remove, 5 * 60_000);
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
}

/** Draw editor markup onto a rendered page (highlights multiply, like on screen). */
async function drawAnnotations(canvas: HTMLCanvasElement, annots: readonly Annotation[], viewport: PageViewport) {
  const ctx = canvas.getContext('2d')!;
  const toScreen = (p: Point) => viewport.convertToViewportPoint(p[0], p[1]) as Point;
  const groups: [GlobalCompositeOperation, readonly Annotation[]][] = [
    ['multiply', annots.filter((a) => a.type === 'highlight')],
    ['source-over', annots.filter((a) => a.type !== 'highlight')],
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Plain text of the document in page order, pages separated by a marker line. */
export async function documentText(doc: EditorDocument, onProgress: (p: number) => void): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const pdfPage = await doc.source(page).pdf.getPage(page.sourceIndex + 1);
    const content = await pdfPage.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
    }
    parts.push(`--- Page ${i + 1} ---\n${text.trim()}`);
    onProgress((i + 1) / doc.pages.length);
  }
  return parts.join('\n\n') + '\n';
}
