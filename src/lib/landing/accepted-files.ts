// Which files the landing screen opens: PDFs, and images that become pages of
// a PDF. JPG, PNG and WebP decode in every supported browser; HEIC/HEIF only
// where the browser can actually decode it (Safari), found out by probing.

export type FileKind = 'pdf' | 'image';

const PDF = { types: ['application/pdf'], ext: ['pdf'] };
const IMAGES = { types: ['image/jpeg', 'image/png', 'image/webp'], ext: ['jpg', 'jpeg', 'png', 'webp'] };
const HEIC = { types: ['image/heic', 'image/heif'], ext: ['heic', 'heif'] };

const ext = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** What a file is, or null if it isn't supported here. */
export function kindOf(file: { name: string; type: string }, heic = false): FileKind | null {
  const type = file.type.toLowerCase();
  const e = ext(file.name);
  if (PDF.types.includes(type) || PDF.ext.includes(e)) return 'pdf';
  if (IMAGES.types.includes(type) || IMAGES.ext.includes(e)) return 'image';
  if (heic && (HEIC.types.includes(type) || HEIC.ext.includes(e))) return 'image';
  return null;
}

/** Split into files we can open (in their original order) and files we can't. */
export function splitFiles<F extends { name: string; type: string }>(files: readonly F[], heic = false) {
  const accepted: F[] = [];
  const rejected: F[] = [];
  for (const f of files) (kindOf(f, heic) ? accepted : rejected).push(f);
  return { accepted, rejected };
}

/** The file picker's accept attribute: exactly the supported types. */
export function acceptAttr(heic = false): string {
  const groups = heic ? [PDF, IMAGES, HEIC] : [PDF, IMAGES];
  return groups.flatMap((g) => [...g.types, ...g.ext.map((x) => `.${x}`)]).join(',');
}

/**
 * While dragging, browsers may reveal each item's MIME type (Chrome, Firefox)
 * or not (Safari: empty). Charge only if something could be a supported file.
 */
export function dragLooksValid(items: readonly { kind: string; type: string }[], heic = false): boolean {
  const files = items.filter((i) => i.kind === 'file');
  if (files.length === 0) return items.length === 0; // types only, no item list: give it the benefit of the doubt
  return files.some((i) => i.type === '' || kindOf({ name: '', type: i.type }, heic) !== null);
}

/** The accept attribute for picking images only (Insert image). */
export function imageAcceptAttr(heic = false): string {
  const groups = heic ? [IMAGES, HEIC] : [IMAGES];
  return groups.flatMap((g) => [...g.types, ...g.ext.map((x) => `.${x}`)]).join(',');
}
