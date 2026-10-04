// Draws watermarks and page numbers into page content (not annotations, so
// they can't be removed by simply deleting an annotation).
import { degrees, rgb, type PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import { displayedToPdf, layoutDecoration, type PageDecoration } from '../decorations';
import type { FontProvider } from './write-annotations';

export async function drawDecoration(doc: PDFDocument, page: PDFPage, deco: PageDecoration, fonts: FontProvider) {
  const rotation = page.getRotation().angle;
  const crop = page.getCropBox();
  const box: [number, number, number, number] = [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height];
  const [w, h] = rotation % 180 === 0 ? [crop.width, crop.height] : [crop.height, crop.width];
  const bold = deco.watermark ? await fonts(doc, 'sans-bold') : null;
  const regular = deco.number ? await fonts(doc, 'sans') : null;
  const items = layoutDecoration(w, h, deco, (text, isBold) => (isBold ? bold! : regular!).widthOfTextAtSize(text, 1));
  for (const item of items) {
    const [x, y] = displayedToPdf(item.x, item.y, box, rotation);
    page.drawText(item.text, {
      x,
      y,
      size: item.size,
      font: item.bold ? bold! : regular!,
      color: rgb(...item.color),
      opacity: item.opacity,
      // Counter-rotate against the page so the text reads as intended on screen.
      rotate: degrees((rotation + item.angle) % 360),
    });
  }
}
