// Real image files for tests: JPEGs (optionally with an EXIF orientation, like
// phone photos) and PNGs (with transparency), painted pixel by pixel.
import jpeg from 'jpeg-js';
import { zlibSync } from 'fflate';

type Rgba = [number, number, number, number];

/** Upright test picture: red band at the top, blue band at the left, white elsewhere. */
export function marker(w: number, h: number, band = 10) {
  return (x: number, y: number): Rgba => (y < band ? [255, 0, 0, 255] : x < band ? [0, 0, 255, 255] : [255, 255, 255, 255]);
}

/**
 * A JPEG that shows `paint` (w × h, upright) when its EXIF orientation is
 * applied. Orientation 6 stores the pixels turned a quarter left, as phones do
 * for portrait photos taken with the camera held upright.
 */
export function makeJpeg(w: number, h: number, paint: (x: number, y: number) => Rgba, orientation = 1): Uint8Array {
  const [rw, rh] = orientation === 6 ? [h, w] : [w, h];
  const data = new Uint8Array(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      // Orientation 6: stored (x, y) is shown at (rh - 1 - y, x).
      const c = orientation === 6 ? paint(rh - 1 - y, x) : paint(x, y);
      data.set(c, (y * rw + x) * 4);
    }
  }
  const encoded = new Uint8Array(jpeg.encode({ data, width: rw, height: rh }, 95).data);
  return orientation === 1 ? encoded : withExifOrientation(encoded, orientation);
}

/** Insert an APP1 Exif segment holding just the Orientation tag, right after SOI. */
export function withExifOrientation(jpg: Uint8Array, orientation: number): Uint8Array {
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const len = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, ...jpg.subarray(2)]);
}

export function makePng(w: number, h: number, paint: (x: number, y: number) => Rgba): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    for (let x = 0; x < w; x++) raw.set(paint(x, y), y * (1 + w * 4) + 1 + x * 4);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())]);
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function crc32(bytes: Uint8Array) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
