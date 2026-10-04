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
    } catch {
      rejected.push({ name: file.name, reason: 'The file could not be read.' });
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
