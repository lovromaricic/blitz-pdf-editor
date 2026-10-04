// Hand a file to the user. Nothing leaves the device: the browser saves a local blob.
import { zipSync } from 'fflate';

export function downloadBytes(bytes: Uint8Array, fileName: string, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Bundle several files into one .zip (stored, not recompressed: PDFs are already compressed). */
export function downloadZip(files: { name: string; bytes: Uint8Array }[], zipName: string) {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[uniqueName(entries, f.name)] = [f.bytes, { level: 0 }];
  downloadBytes(zipSync(entries), zipName, 'application/zip');
}

function uniqueName(taken: Record<string, unknown>, name: string) {
  if (!(name in taken)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (`${stem} (${i})${ext}` in taken) i++;
  return `${stem} (${i})${ext}`;
}

/** Make a user-typed file name safe and make sure it ends in .pdf. */
export function pdfFileName(name: string, fallback = 'document.pdf') {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
  if (!cleaned) return fallback;
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}
