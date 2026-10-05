// A new PDF of empty pages (File › New blank PDF…). Runs in the PDF worker and in tests.
import { PDFDocument } from '@cantoo/pdf-lib';

export async function newBlankPdf(width: number, height: number, pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Untitled');
  doc.setProducer('Blitz PDF Editor');
  // Empty pages: every viewer shows them as white paper.
  for (let i = 0; i < pages; i++) doc.addPage([width, height]);
  return doc.save({ useObjectStreams: true });
}
