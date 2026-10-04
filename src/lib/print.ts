// Printing: render each page to an image and print them from a hidden frame.
// Works the same in every browser, and prints exactly what the editor shows
// (order, rotation, crop), without saving first.
import type { EditorDocument } from './document.svelte';
import { canvasToBlob, createRasterizer } from './rasterize';

const PRINT_DPI = 150;

export async function printDocument(doc: EditorDocument, onProgress: (p: number) => void) {
  const urls: string[] = [];
  const cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
  const raster = await createRasterizer(doc);

  try {
    for (let i = 0; i < doc.pages.length; i++) {
      const canvas = await raster.render(doc.pages[i], PRINT_DPI, 'print');
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      canvas.width = canvas.height = 0;
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
