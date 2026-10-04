// PDF.js setup: one shared worker, asset URLs, and typed load errors.
import {
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  PasswordResponses,
  PDFWorker,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** CSS pixels per PDF point at 100% zoom (96 dpi screen / 72 pt per inch). */
export const CSS_UNITS = 96 / 72;

const assetBase = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;

let sharedWorker: PDFWorker | null = null;
function worker() {
  sharedWorker ??= new PDFWorker();
  return sharedWorker;
}

export type LoadErrorKind = 'password-required' | 'password-incorrect' | 'invalid' | 'unknown';

export class PdfLoadError extends Error {
  constructor(
    public kind: LoadErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = getDocument({
    // PDF.js transfers the buffer to its worker, so hand it a copy and keep the original.
    data: bytes.slice(),
    password,
    worker: worker(),
    cMapUrl: `${assetBase}cmaps/`,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
    enableXfa: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    if (e instanceof PasswordException) {
      return Promise.reject(
        e.code === PasswordResponses.INCORRECT_PASSWORD
          ? new PdfLoadError('password-incorrect', 'The password is incorrect.')
          : new PdfLoadError('password-required', 'This PDF is protected with a password.'),
      );
    }
    if (e instanceof InvalidPDFException) {
      throw new PdfLoadError('invalid', 'This PDF is damaged or not a valid PDF.');
    }
    throw new PdfLoadError('unknown', e instanceof Error ? e.message : 'The PDF could not be opened.');
  }
}
