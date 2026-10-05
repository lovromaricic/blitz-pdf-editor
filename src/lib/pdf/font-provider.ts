// Embeds fonts into a PDF on first use (subset to the characters actually used).
import fontkit from '@cantoo/fontkit';
import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib';
import type { FontKey, FontProvider } from './write-annotations';

/**
 * No ligatures and no kerning: the editor draws text with plain glyph
 * advances (font-metrics.ts), so the PDF must use exactly those glyphs and widths.
 */
export const PLAIN_TEXT_FEATURES = { liga: false, clig: false, calt: false, dlig: false, kern: false };

export function createFontProvider(loadBytes: (key: FontKey) => Promise<Uint8Array>): FontProvider {
  const bytes = new Map<FontKey, Promise<Uint8Array>>();
  const embedded = new WeakMap<PDFDocument, Map<FontKey, Promise<PDFFont>>>();
  const bytesOf = (key: FontKey) => {
    if (!bytes.has(key)) bytes.set(key, loadBytes(key));
    return bytes.get(key)!;
  };
  const provider: FontProvider = (doc, key) => {
    let perDoc = embedded.get(doc);
    if (!perDoc) {
      doc.registerFontkit(fontkit);
      perDoc = new Map();
      embedded.set(doc, perDoc);
    }
    let font = perDoc.get(key);
    if (!font) {
      font = bytesOf(key).then((b) => doc.embedFont(b, { subset: true, features: PLAIN_TEXT_FEATURES }));
      perDoc.set(key, font);
    }
    return font;
  };
  provider.bytes = bytesOf;
  return provider;
}
