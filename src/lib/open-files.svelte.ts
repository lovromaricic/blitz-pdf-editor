// The one entry point for opening PDFs, used by the Home screen and File > Open.
import { setDocument } from './app-state.svelte';
import { formatBytes, largeFileThreshold, readPdfFiles, type OpenFile, type RejectedFile } from './files';
import { showDialog } from './dialogs.svelte';

interface PasswordRequest {
  fileName: string;
  retry: boolean;
  resolve: (password: string | null) => void;
}

export const opening = $state({
  busy: false,
  password: null as PasswordRequest | null,
});

export function askPassword(fileName: string, retry: boolean) {
  return new Promise<string | null>((resolve) => {
    opening.password = {
      fileName,
      retry,
      resolve: (pw) => {
        opening.password = null;
        resolve(pw);
      },
    };
  });
}

/**
 * Read, validate and open files as the current document.
 * Returns the files that failed. If none opened, the current document is left alone.
 */
export async function openFiles(files: Iterable<File>): Promise<RejectedFile[]> {
  if (opening.busy) return [];
  opening.busy = true;
  try {
    const list = Array.from(files);
    const total = list.reduce((n, f) => n + f.size, 0);
    if (total > largeFileThreshold()) {
      const r = await showDialog({
        title: 'Very large file',
        message: `${list.length === 1 ? 'This file is' : 'These files are'} ${formatBytes(total)}. Opening may be slow, and this device could run out of memory. Everything stays on your device either way.`,
        buttons: [
          { value: 'cancel', label: 'Cancel' },
          { value: 'open', label: 'Open anyway', primary: true },
        ],
        cancelValue: 'cancel',
      });
      if (r.button !== 'open') return [];
    }
    // Images are turned into a PDF (one per page), placed where the first image was.
    const images = list.filter((f) => !isPdfName(f) && (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic)$/i.test(f.name)));
    const intake = await readPdfFiles(list.filter((f) => !images.includes(f)));
    let fromImages: OpenFile | null = null;
    if (images.length) {
      const made = await imagesAsPdf(images);
      intake.rejected.push(...made.rejected);
      if (made.file) {
        fromImages = made.file;
        const at = list.filter((f) => !images.includes(f)).findIndex((f) => list.indexOf(f) > list.indexOf(images[0]));
        intake.accepted.splice(at < 0 ? intake.accepted.length : at, 0, made.file);
      }
    }
    if (intake.accepted.length === 0) return intake.rejected;
    // PDF.js is loaded on demand so the Home screen stays light.
    const { openDocument } = await loadEditorModules();
    const result = await openDocument(intake.accepted, askPassword);
    const rejected = [...intake.rejected, ...result.rejected];
    if (!result.doc) return rejected;
    // A PDF made from images exists only in memory until saved.
    if (fromImages) result.doc.createdUnsaved = true;
    setDocument(result.doc, rejected);
    return [];
  } finally {
    opening.busy = false;
  }
}

/** Load the PDF engine. Called early (on idle) so opening a file feels instant. */
export function loadEditorModules() {
  return import('./document.svelte');
}

function isPdfName(f: File) {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

async function imagesAsPdf(images: File[]): Promise<{ file: OpenFile | null; rejected: RejectedFile[] }> {
  const [{ prepareImage }, { imagesToPdfInWorker }, { DEFAULT_IMAGE_OPTIONS }] = await Promise.all([
    import('./image-input'),
    import('./pdf/pdf-writer'),
    import('./actions.svelte'),
  ]);
  const prepared = [];
  const rejected: RejectedFile[] = [];
  for (const f of images) {
    try {
      prepared.push(await prepareImage(f));
    } catch (e) {
      rejected.push({ name: f.name, reason: e instanceof Error ? e.message.replace(`${f.name}: `, '') : 'This image could not be read.' });
    }
  }
  if (prepared.length === 0) return { file: null, rejected };
  const bytes = await imagesToPdfInWorker(prepared, DEFAULT_IMAGE_OPTIONS);
  const name = prepared.length === 1 ? prepared[0].name.replace(/\.[^.]+$/, '') + '.pdf' : 'images.pdf';
  return { file: { id: `images-${Date.now()}`, name, size: bytes.length, bytes }, rejected };
}
