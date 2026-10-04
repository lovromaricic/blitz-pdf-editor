// Reading and validating files the user picks or drops. Pure logic, no UI.

export interface OpenFile {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
}

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface FileIntake {
  accepted: OpenFile[];
  rejected: RejectedFile[];
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// The spec lets readers tolerate junk before the header, and real-world files
// sometimes have it, so look within the first 1 KB like most viewers do.
const HEADER_SEARCH_LIMIT = 1024;

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, HEADER_SEARCH_LIMIT) - PDF_SIGNATURE.length;
  for (let i = 0; i <= end; i++) {
    let match = true;
    for (let j = 0; j < PDF_SIGNATURE.length; j++) {
      if (bytes[i + j] !== PDF_SIGNATURE[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

let nextId = 0;

export async function readPdfFiles(files: Iterable<File>): Promise<FileIntake> {
  const accepted: OpenFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'The file is empty.' });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      const tooBig = e instanceof RangeError || (e instanceof Error && /memory|allocation/i.test(e.message));
      rejected.push({ name: file.name, reason: tooBig ? 'The file is too large to open on this device.' : 'The file could not be read.' });
      continue;
    }
    if (!hasPdfHeader(bytes)) {
      rejected.push({ name: file.name, reason: 'This is not a PDF file.' });
      continue;
    }
    accepted.push({ id: `file-${++nextId}`, name: file.name, size: file.size, bytes });
  }

  return { accepted, rejected };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Size above which we ask before opening. Lower on phones and low-memory
 * devices, where the browser may run out of memory.
 */
export function largeFileThreshold(): number {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  if ((memory !== undefined && memory <= 2) || phone) return 120 * 1024 * 1024;
  if (memory !== undefined && memory <= 4) return 250 * 1024 * 1024;
  return 500 * 1024 * 1024;
}

/** Whether `bytes` contains the ASCII text `needle` (fast byte scan). */
export function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  const first = n[0];
  for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - n.length; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < n.length && bytes[i + k] === n[k]) k++;
    if (k === n.length) return true;
  }
  return false;
}

/** Signed PDFs store /ByteRange uncompressed (it's patched in place when signing). */
export function looksDigitallySigned(bytes: Uint8Array) {
  return containsAscii(bytes, '/ByteRange');
}
