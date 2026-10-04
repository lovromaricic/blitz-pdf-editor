// The one entry point for opening PDFs, used by the Home screen and File > Open.
import { setDocument } from './app-state.svelte';
import { readPdfFiles, type RejectedFile } from './files';

interface PasswordRequest {
  fileName: string;
  retry: boolean;
  resolve: (password: string | null) => void;
}

export const opening = $state({
  busy: false,
  password: null as PasswordRequest | null,
});

function askPassword(fileName: string, retry: boolean) {
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
    const intake = await readPdfFiles(files);
    if (intake.accepted.length === 0) return intake.rejected;
    // PDF.js is loaded on demand so the Home screen stays light.
    const { openDocument } = await loadEditorModules();
    const result = await openDocument(intake.accepted, askPassword);
    const rejected = [...intake.rejected, ...result.rejected];
    if (!result.doc) return rejected;
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
