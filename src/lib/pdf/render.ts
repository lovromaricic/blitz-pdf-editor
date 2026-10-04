// Rendering one page to a canvas, with a memory cap and cancellation.
import { AnnotationMode, RenderingCancelledException, type PDFPageProxy, type PageViewport } from 'pdfjs-dist';

/**
 * - `forms`: interactive fields are drawn by the HTML form layer, not the canvas.
 * - `values`: fields are drawn on the canvas with the values typed so far
 *   (thumbnails, print, flattened pages).
 */
export type FieldDrawing = 'forms' | 'values';

/** Cap canvas backing stores at ~16 MP so high zoom on big pages can't exhaust memory. */
const MAX_CANVAS_PIXELS = 4096 * 4096;

export function viewportFor(pdfPage: PDFPageProxy, scale: number, userRotation: number): PageViewport {
  return pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + userRotation) % 360 });
}

export interface RenderHandle {
  promise: Promise<HTMLCanvasElement | null>;
  cancel(): void;
}

/** Renders into a fresh canvas; resolves null if cancelled. */
export function renderToCanvas(pdfPage: PDFPageProxy, viewport: PageViewport, fields: FieldDrawing = 'values'): RenderHandle {
  const canvas = document.createElement('canvas');
  let outputScale = window.devicePixelRatio || 1;
  const cssPixels = viewport.width * viewport.height;
  if (cssPixels * outputScale * outputScale > MAX_CANVAS_PIXELS) {
    outputScale = Math.sqrt(MAX_CANVAS_PIXELS / cssPixels);
  }
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const task = pdfPage.render({
    canvas,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    annotationMode: fields === 'forms' ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE_STORAGE,
  });

  return {
    promise: task.promise.then(
      () => canvas,
      (e) => {
        canvas.width = canvas.height = 0;
        if (e instanceof RenderingCancelledException) return null;
        throw e;
      },
    ),
    cancel: () => task.cancel(),
  };
}

/** Free a canvas's backing store immediately rather than waiting for GC. */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (canvas) canvas.width = canvas.height = 0;
}

/**
 * Small FIFO queue so background renders (thumbnails) don't crowd the PDF.js
 * worker while the main page is rendering.
 */
export class RenderQueue {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private concurrency: number) {}

  /** Resolves when a slot is free; call the returned function to release it. */
  acquire(signal: { cancelled: boolean }): Promise<(() => void) | null> {
    return new Promise((resolve) => {
      const start = () => {
        if (signal.cancelled) {
          this.next();
          return resolve(null);
        }
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.next();
        });
      };
      if (this.active < this.concurrency) start();
      else this.waiting.push(start);
    });
  }

  private next() {
    const fn = this.waiting.shift();
    fn?.();
  }
}

export const thumbnailQueue = new RenderQueue(2);
