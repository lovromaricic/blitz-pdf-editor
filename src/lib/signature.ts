// Turning drawn, typed or uploaded signatures into a trimmed, transparent PNG.

/** Handwriting font for typed signatures (bundled Dancing Script; content, not theme). */
export const SIGNATURE_FONT = '"Dancing Script", cursive';

/** Ink colours for drawn and typed signatures (content, not theme). */
export const SIGNATURE_INKS = [
  { name: 'Black', css: 'rgb(17 17 17)' },
  { name: 'Blue', css: 'rgb(26 63 176)' },
] as const;

export interface SignatureImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Crop a canvas to its non-transparent pixels (plus a small margin). */
export function trimCanvas(src: HTMLCanvasElement, margin = 6): SignatureImage | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x1 = width;
  let y1 = height;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return null;
  x1 = Math.max(0, x1 - margin);
  y1 = Math.max(0, y1 - margin);
  x2 = Math.min(width - 1, x2 + margin);
  y2 = Math.min(height - 1, y2 + margin);
  const out = document.createElement('canvas');
  out.width = x2 - x1 + 1;
  out.height = y2 - y1 + 1;
  out.getContext('2d')!.drawImage(src, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height };
}

/** Load an image file into a canvas, scaled down to at most `maxSide` px. */
export async function fileToCanvas(file: File, maxSide = 1200): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Make near-white pixels transparent (for photos or scans of a signature on paper). */
export function removeWhiteBackground(canvas: HTMLCanvasElement, threshold = 200) {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lightness = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (lightness >= threshold) d[i + 3] = 0;
    else if (lightness > threshold - 40) d[i + 3] = Math.round((d[i + 3] * (threshold - lightness)) / 40);
  }
  ctx.putImageData(img, 0, 0);
}
