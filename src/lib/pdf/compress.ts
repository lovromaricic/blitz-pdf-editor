// Compression: re-encode embedded photos at a lower resolution and quality,
// then rebuild the file with object streams and without unused objects.
// Runs in the PDF worker (OffscreenCanvas + createImageBitmap, no DOM).
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from '@cantoo/pdf-lib';
import { unzlibSync } from 'fflate';

export type CompressLevel = 'light' | 'balanced' | 'maximum';

export const LEVELS: Record<CompressLevel, { maxSide: number; quality: number; bytesPerPixel: number }> = {
  light: { maxSide: 2200, quality: 0.8, bytesPerPixel: 0.22 },
  balanced: { maxSide: 1500, quality: 0.68, bytesPerPixel: 0.14 },
  maximum: { maxSide: 1000, quality: 0.5, bytesPerPixel: 0.09 },
};

interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  kind: 'jpeg' | 'raw';
  width: number;
  height: number;
  components: number;
}

const name = (o: PDFObject | undefined) => o?.toString();

function filterOf(dict: PDFDict, doc: PDFDocument): string | null | 'unsupported' {
  const f = doc.context.lookup(dict.get(PDFName.of('Filter')));
  if (!f) return null;
  if (f instanceof PDFArray) return f.size() === 1 ? (name(f.get(0)) ?? null) : 'unsupported';
  return name(f) ?? null;
}

function componentsOf(dict: PDFDict, doc: PDFDocument): number | null {
  const cs = doc.context.lookup(dict.get(PDFName.of('ColorSpace')));
  const csName = cs instanceof PDFArray ? name(cs.get(0)) : name(cs);
  if (csName === '/DeviceRGB' || csName === '/CalRGB') return 3;
  if (csName === '/DeviceGray' || csName === '/CalGray') return 1;
  if (csName === '/ICCBased' && cs instanceof PDFArray) {
    const icc = doc.context.lookup(cs.get(1));
    const n = icc && 'dict' in icc ? (icc as PDFRawStream).dict.get(PDFName.of('N')) : undefined;
    const count = n instanceof PDFNumber ? n.asNumber() : 0;
    return count === 3 || count === 1 ? count : null;
  }
  return null; // CMYK, Indexed, Separation, Lab…: leave alone
}

/** Images we can safely re-encode as JPEG. */
function findCandidates(doc: PDFDocument): Candidate[] {
  const objects = doc.context.enumerateIndirectObjects();
  // Alpha masks must stay grayscale and lossless-ish: never touch them.
  const masks = new Set<string>();
  for (const [, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    for (const key of ['SMask', 'Mask']) {
      const m = obj.dict.get(PDFName.of(key));
      if (m instanceof PDFRef) masks.add(m.toString());
    }
  }
  const out: Candidate[] = [];
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream) || masks.has(ref.toString())) continue;
    const d = obj.dict;
    if (name(d.get(PDFName.of('Subtype'))) !== '/Image') continue;
    if (d.get(PDFName.of('ImageMask')) || d.get(PDFName.of('Decode'))) continue;
    const bpc = d.get(PDFName.of('BitsPerComponent'));
    if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;
    const w = d.get(PDFName.of('Width'));
    const h = d.get(PDFName.of('Height'));
    if (!(w instanceof PDFNumber) || !(h instanceof PDFNumber)) continue;
    const components = componentsOf(d, doc);
    if (!components) continue;
    const filter = filterOf(d, doc);
    let kind: Candidate['kind'];
    if (filter === '/DCTDecode') kind = 'jpeg';
    else if ((filter === '/FlateDecode' || filter === null) && !d.get(PDFName.of('DecodeParms'))) kind = 'raw';
    else continue;
    // Tiny images (icons, logos) aren't worth it.
    if (w.asNumber() * h.asNumber() < 64 * 64) continue;
    out.push({ ref, stream: obj, kind, width: w.asNumber(), height: h.asNumber(), components });
  }
  return out;
}

export interface Analysis {
  totalBytes: number;
  imageBytes: number;
  imageCount: number;
  /** Estimated size after compression, per level. */
  estimates: Record<CompressLevel, number>;
}

export function analyze(doc: PDFDocument, totalBytes: number): Analysis {
  const candidates = findCandidates(doc);
  const imageBytes = candidates.reduce((n, c) => n + c.stream.contents.length, 0);
  const estimates = {} as Record<CompressLevel, number>;
  for (const level of Object.keys(LEVELS) as CompressLevel[]) {
    const { maxSide, bytesPerPixel } = LEVELS[level];
    const after = candidates.reduce((n, c) => {
      const k = Math.min(1, maxSide / Math.max(c.width, c.height));
      return n + Math.min(c.stream.contents.length, c.width * c.height * k * k * bytesPerPixel);
    }, 0);
    // Object streams and dropping unused objects usually save a little more.
    estimates[level] = Math.round((totalBytes - imageBytes + after) * 0.97);
  }
  return { totalBytes, imageBytes, imageCount: candidates.length, estimates };
}

export const canRecompressImages = () => typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';

/** Re-encode images in place. Returns how many were replaced. */
export async function recompressImages(doc: PDFDocument, level: CompressLevel, onProgress?: (done: number, total: number) => void) {
  if (!canRecompressImages()) return 0;
  const { maxSide, quality } = LEVELS[level];
  const candidates = findCandidates(doc);
  let replaced = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const source = c.kind === 'jpeg' ? await createImageBitmap(new Blob([c.stream.contents as BlobPart], { type: 'image/jpeg' })) : rawToCanvas(c);
      const k = Math.min(1, maxSide / Math.max(c.width, c.height));
      const w = Math.max(1, Math.round(c.width * k));
      const h = Math.max(1, Math.round(c.height * k));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, w, h);
      if ('close' in source) source.close();
      const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
      // Only keep the result if it's clearly smaller.
      if (jpeg.length < c.stream.contents.length * 0.9) {
        const dict = c.stream.dict.clone(doc.context);
        for (const key of ['Filter', 'DecodeParms', 'Length', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent']) dict.delete(PDFName.of(key));
        dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        dict.set(PDFName.of('Width'), PDFNumber.of(w));
        dict.set(PDFName.of('Height'), PDFNumber.of(h));
        dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        doc.context.assign(c.ref, PDFRawStream.of(dict, jpeg));
        replaced++;
      }
    } catch {
      // An image we can't decode stays as it was.
    }
    onProgress?.(i + 1, candidates.length);
  }
  return replaced;
}

function rawToCanvas(c: Candidate): OffscreenCanvas {
  const filtered = name(c.stream.dict.get(PDFName.of('Filter')));
  const data = filtered ? unzlibSync(c.stream.contents) : c.stream.contents;
  const pixels = c.width * c.height;
  if (data.length < pixels * c.components) throw new Error('Unexpected image data length');
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let p = 0, s = 0; p < pixels; p++, s += c.components) {
    const o = p * 4;
    if (c.components === 3) {
      rgba[o] = data[s];
      rgba[o + 1] = data[s + 1];
      rgba[o + 2] = data[s + 2];
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = data[s];
    }
    rgba[o + 3] = 255;
  }
  const canvas = new OffscreenCanvas(c.width, c.height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, c.width, c.height), 0, 0);
  return canvas;
}
