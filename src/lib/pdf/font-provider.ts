// Embeds fonts into a PDF on first use (subset to the characters actually used).
import fontkit from '@cantoo/fontkit';
import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib';
import type { FontKey, FontProvider } from './write-annotations';

export function createFontProvider(loadBytes: (key: FontKey) => Promise<Uint8Array>): FontProvider {
  const bytes = new Map<FontKey, Promise<Uint8Array>>();
  const embedded = new WeakMap<PDFDocument, Map<FontKey, Promise<PDFFont>>>();
  return (doc, key) => {
    let perDoc = embedded.get(doc);
    if (!perDoc) {
      doc.registerFontkit(fontkit);
      perDoc = new Map();
      embedded.set(doc, perDoc);
    }
    let font = perDoc.get(key);
    if (!font) {
      if (!bytes.has(key)) bytes.set(key, loadBytes(key));
      font = bytes.get(key)!.then((b) => doc.embedFont(b, { subset: true }));
      perDoc.set(key, font);
    }
    return font;
  };
}
