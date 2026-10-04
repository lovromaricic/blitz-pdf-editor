// Compression: re-encode embedded photos at a lower resolution and quality,
// then rebuild the file with object streams and without unused objects.
// Only images change; text and vector content are copied as they are.
// Runs in the PDF worker (OffscreenCanvas + createImageBitmap, no DOM).
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from '@cantoo/pdf-lib';
import { unzlibSync } from 'fflate';
import { findPlacements, type Placement } from './image-placement';

export type CompressPreset = 'light' | 'balanced' | 'maximum';
export type CompressLevel = CompressPreset | 'custom';

export interface CompressSettings {
  /** JPEG quality, 0.1 to 0.95. */
  quality: number;
  /** Images are scaled down to at most this resolution where they're shown; null keeps every pixel. */
  dpi: number | null;
}

export const PRESETS: Record<CompressPreset, CompressSettings> = {
  light: { quality: 0.85, dpi: 300 },
  balanced: { quality: 0.7, dpi: 150 },
  maximum: { quality: 0.5, dpi: 96 },
};

/** Results saving less than this are not worth a new file. */
export const MIN_SAVING = 0.05;

export function isWorthwhile(before: number, after: number) {
  return after <= before * (1 - MIN_SAVING);
}

/** Thrown between images when the job is cancelled. */
export class CompressCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

export interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  kind: 'jpeg' | 'raw';
  width: number;
  height: number;
  components: number;
}

/** Turns an image into a JPEG of the given size. Swappable so tests can run without a browser. */
export interface ImageCodec {
  reencode(c: Candidate, width: number, height: number, quality: number): Promise<Uint8Array>;
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
export function findCandidates(doc: PDFDocument): Candidate[] {
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

/** Fallback when we can't tell how big an image is shown: assume it spans a letter page's long side. */
const UNKNOWN_PLACEMENT_INCHES = 11;

/** Pixel size to re-encode at so the image is at most `dpi` where it's shown largest. */
export function targetSize(c: Candidate, placement: Placement | undefined, dpi: number | null): [number, number] {
  if (dpi === null) return [c.width, c.height];
  const k = placement && placement.width > 0 && placement.height > 0
    ? // Keep at least `dpi` in both directions.
      Math.max((dpi * placement.width) / 72 / c.width, (dpi * placement.height) / 72 / c.height)
    : (dpi * UNKNOWN_PLACEMENT_INCHES) / Math.max(c.width, c.height);
  const s = Math.min(1, k);
  return [Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s))];
}

/** Replace an image with a JPEG version. */
function replaceImage(doc: PDFDocument, c: Candidate, jpeg: Uint8Array, w: number, h: number) {
  const dict = c.stream.dict.clone(doc.context);
  for (const key of ['Filter', 'DecodeParms', 'Length', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent']) dict.delete(PDFName.of(key));
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.set(PDFName.of('Width'), PDFNumber.of(w));
  dict.set(PDFName.of('Height'), PDFNumber.of(h));
  // Canvas JPEGs always have three channels, even for grey images.
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  doc.context.assign(c.ref, PDFRawStream.of(dict, jpeg));
}

/** A re-encoded image is only kept when it's clearly smaller than the original. */
const keeps = (jpeg: Uint8Array, c: Candidate) => jpeg.length < c.stream.contents.length * 0.9;

export const canRecompressImages = () => typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';

export interface RunOptions {
  codec?: ImageCodec | null;
  onProgress?: (done: number, total: number) => void;
  /** Checked between images; throw CompressCancelled when true. */
  stopped?: () => boolean;
}

/** Re-encode images in place. Returns how many were replaced. */
export async function recompressImages(doc: PDFDocument, settings: CompressSettings, { codec = browserCodec(), onProgress, stopped }: RunOptions = {}) {
  if (!codec) return 0;
  const candidates = findCandidates(doc);
  const placements = candidates.length ? findPlacements(doc) : new Map<string, Placement>();
  let replaced = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (stopped?.()) throw new CompressCancelled();
    const c = candidates[i];
    const [w, h] = targetSize(c, placements.get(c.ref.toString()), settings.dpi);
    try {
      const jpeg = await codec.reencode(c, w, h, settings.quality);
      if (keeps(jpeg, c)) {
        replaceImage(doc, c, jpeg, w, h);
        replaced++;
      }
    } catch {
      // An image we can't decode stays as it was.
    }
    onProgress?.(i + 1, candidates.length);
  }
  return replaced;
}

/** Above this many images, estimates re-encode an even sample and extrapolate. */
const ESTIMATE_SAMPLE = 24;

/**
 * Size each settings would produce: `baseSize` (the file rebuilt without
 * changing any image) plus, per image, the change from re-encoding it.
 */
export async function estimateSizes(
  doc: PDFDocument,
  baseSize: number,
  settingsList: readonly CompressSettings[],
  { codec = browserCodec(), onProgress, stopped }: RunOptions = {},
): Promise<number[]> {
  const candidates = findCandidates(doc);
  if (!codec || candidates.length === 0) return settingsList.map(() => baseSize);
  const placements = findPlacements(doc);
  const step = Math.max(1, candidates.length / ESTIMATE_SAMPLE);
  const sample = candidates.length > ESTIMATE_SAMPLE ? Array.from({ length: ESTIMATE_SAMPLE }, (_, k) => candidates[Math.floor(k * step)]) : candidates;
  const sampleBytes = sample.reduce((n, c) => n + c.stream.contents.length, 0);
  const allBytes = candidates.reduce((n, c) => n + c.stream.contents.length, 0);

  const deltas = settingsList.map(() => 0);
  let done = 0;
  for (const c of sample) {
    for (let s = 0; s < settingsList.length; s++) {
      if (stopped?.()) throw new CompressCancelled();
      const [w, h] = targetSize(c, placements.get(c.ref.toString()), settingsList[s].dpi);
      try {
        const jpeg = await codec.reencode(c, w, h, settingsList[s].quality);
        if (keeps(jpeg, c)) deltas[s] += jpeg.length - c.stream.contents.length;
      } catch {
        // Stays as it was: no change.
      }
      onProgress?.(++done, sample.length * settingsList.length);
    }
  }
  // Scale the sample's savings up to all images.
  const factor = sampleBytes > 0 ? allBytes / sampleBytes : 1;
  return deltas.map((d) => Math.max(0, Math.round(baseSize + d * factor)));
}

export interface Analysis {
  totalBytes: number;
  imageBytes: number;
  imageCount: number;
}

export function analyze(doc: PDFDocument, totalBytes: number): Analysis {
  const candidates = findCandidates(doc);
  return { totalBytes, imageBytes: candidates.reduce((n, c) => n + c.stream.contents.length, 0), imageCount: candidates.length };
}

/** RGBA pixels of a Flate or uncompressed image. */
export function rawPixels(c: Candidate): Uint8ClampedArray {
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
  return rgba;
}

/** The browser's decoders and JPEG encoder (worker-safe). Null where unavailable. */
export function browserCodec(): ImageCodec | null {
  if (!canRecompressImages()) return null;
  return {
    async reencode(c, w, h, quality) {
      let source: ImageBitmap | OffscreenCanvas;
      if (c.kind === 'jpeg') {
        // Decode straight to the target size: much less memory for big photos.
        source = await createImageBitmap(new Blob([c.stream.contents as BlobPart], { type: 'image/jpeg' }), {
          resizeWidth: w,
          resizeHeight: h,
          resizeQuality: 'high',
        });
      } else {
        source = new OffscreenCanvas(c.width, c.height);
        source.getContext('2d')!.putImageData(new ImageData(rawPixels(c) as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
      }
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, w, h);
      if ('close' in source) source.close();
      return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
    },
  };
}
