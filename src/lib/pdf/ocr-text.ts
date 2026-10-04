// Adds OCR results as an invisible text layer (rendering mode 3), positioned over
// the scanned words, so the page becomes searchable and selectable. Worker-side.
import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFDocument,
  type PDFOperator,
} from '@cantoo/pdf-lib';
import type { FontProvider } from './write-annotations';

/** One recognised word, in PDF user space. */
export interface OcrWord {
  text: string;
  /** Baseline start. */
  x: number;
  y: number;
  /** Length along the reading direction and the text height, in points. */
  width: number;
  height: number;
  /** Reading direction, degrees counter-clockwise (0 = left to right). */
  angle: number;
}

export async function addInvisibleText(doc: PDFDocument, pageIndex: number, words: readonly OcrWord[], fonts: FontProvider) {
  if (words.length === 0) return;
  const page = doc.getPage(pageIndex);
  const font = await fonts(doc, 'sans');
  const key = page.node.newFontDictionary('OCR', font.ref);
  const ops: PDFOperator[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    // Letters roughly fill the box height; then stretch to match the word's width.
    const size = Math.max(1, w.height * 0.9);
    const natural = font.widthOfTextAtSize(text, size);
    if (natural <= 0) continue;
    const rad = (w.angle * Math.PI) / 180;
    ops.push(
      setFontAndSize(key, size),
      setCharacterSqueeze(Math.max(10, Math.min(1000, (100 * w.width) / natural))),
      setTextMatrix(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), w.x, w.y),
      // A trailing space keeps words apart when the text is copied or searched.
      showText(font.encodeText(`${text} `)),
    );
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}
