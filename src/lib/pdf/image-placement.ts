// How large each image is drawn on the pages, so compression can limit images
// by resolution (DPI) instead of by pixel count. Walks page content streams
// (and the forms they use), tracking the transformation matrix up to each
// `Do`. No DOM: runs in the PDF worker and in tests.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from '@cantoo/pdf-lib';

type Matrix = [number, number, number, number, number, number];

/** Largest size an image is drawn at, in points (width and height of its unit square). */
export interface Placement {
  width: number;
  height: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/**
 * Calls `onOp(op, numbers, lastName)` for every operator in a content stream.
 * Only numbers and names are kept as operands; strings, arrays and
 * dictionaries are skipped, and inline images are jumped over.
 */
export function scanOperators(bytes: Uint8Array, onOp: (op: string, nums: number[], name: string | null) => void) {
  const n = bytes.length;
  let i = 0;
  let nums: number[] = [];
  let name: string | null = null;
  while (i < n) {
    const c = bytes[i];
    if (WS.has(c)) {
      i++;
    } else if (c === 37) {
      // % comment
      while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++;
    } else if (c === 40) {
      // (string), with nesting and escapes
      let depth = 0;
      for (; i < n; i++) {
        const b = bytes[i];
        if (b === 92) i++;
        else if (b === 40) depth++;
        else if (b === 41 && --depth === 0) break;
      }
      i++;
    } else if (c === 60 && bytes[i + 1] !== 60) {
      // <hex string>
      while (i < n && bytes[i] !== 62) i++;
      i++;
    } else if (c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125) {
      // Dictionary and array brackets: their contents are operands we don't need.
      i += c === 60 || c === 62 ? 2 : 1;
    } else if (c === 47) {
      let j = i + 1;
      while (j < n && !WS.has(bytes[j]) && !DELIM.has(bytes[j])) j++;
      name = String.fromCharCode(...bytes.subarray(i + 1, j));
      i = j;
    } else {
      let j = i;
      while (j < n && !WS.has(bytes[j]) && !DELIM.has(bytes[j])) j++;
      if (j === i) {
        i++;
        continue;
      }
      const token = String.fromCharCode(...bytes.subarray(i, j));
      i = j;
      const num = Number(token);
      if (token !== '' && !Number.isNaN(num) && /^[+\-.\d]/.test(token)) {
        nums.push(num);
        continue;
      }
      if (token === 'BI') {
        // Inline image: skip to "EI" surrounded by whitespace.
        while (i < n - 2 && !(WS.has(bytes[i]) && bytes[i + 1] === 69 && bytes[i + 2] === 73 && (i + 3 >= n || WS.has(bytes[i + 3])))) i++;
        i += 3;
      } else {
        onOp(token, nums, name);
      }
      nums = [];
      name = null;
    }
  }
}

function contentBytes(doc: PDFDocument, contents: PDFObject | undefined): Uint8Array[] {
  const obj = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (obj instanceof PDFArray) return obj.asArray().flatMap((o) => contentBytes(doc, o));
  if (obj instanceof PDFRawStream) {
    try {
      return [decodePDFRawStream(obj).decode()];
    } catch {
      return [];
    }
  }
  return [];
}

function xobjectsOf(doc: PDFDocument, resources: PDFDict | undefined): PDFDict | undefined {
  return resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
}

/** Image refs (as strings) mapped to the largest size they're drawn at, in points. */
export function findPlacements(doc: PDFDocument): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const seenForms = new Set<string>();

  const record = (ref: string, m: Matrix) => {
    const width = Math.hypot(m[0], m[1]);
    const height = Math.hypot(m[2], m[3]);
    const prev = out.get(ref);
    if (!prev || width * height > prev.width * prev.height) out.set(ref, { width, height });
  };

  const walk = (streams: Uint8Array[], resources: PDFDict | undefined, base: Matrix, depth: number) => {
    const xobjects = xobjectsOf(doc, resources);
    // Nothing to place on this page or form: skip parsing its content.
    if (!xobjects || xobjects.keys().length === 0 || depth > 8) return;
    let ctm = base;
    const stack: Matrix[] = [];
    for (const bytes of streams) {
      scanOperators(bytes, (op, nums, name) => {
        if (op === 'q') stack.push(ctm);
        else if (op === 'Q') ctm = stack.pop() ?? base;
        else if (op === 'cm' && nums.length >= 6) ctm = multiply(nums.slice(-6) as Matrix, ctm);
        else if (op === 'Do' && name) {
          const ref = xobjects.get(PDFName.of(name));
          if (!(ref instanceof PDFRef)) return;
          const xo = doc.context.lookup(ref);
          if (!(xo instanceof PDFRawStream)) return;
          const subtype = xo.dict.get(PDFName.of('Subtype'))?.toString();
          if (subtype === '/Image') record(ref.toString(), ctm);
          else if (subtype === '/Form') {
            // A form drawn many times at different sizes is walked once per size.
            const key = `${ref.toString()}@${ctm.map((v) => v.toFixed(2)).join(',')}`;
            if (seenForms.has(key)) return;
            seenForms.add(key);
            const mat = xo.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
            const fm = mat ? (mat.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as Matrix) : IDENTITY;
            const formRes = xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources;
            walk(contentBytes(doc, xo), formRes, multiply(fm, ctm), depth + 1);
          }
        }
      });
    }
  };

  for (const page of doc.getPages()) {
    walk(contentBytes(doc, page.node.get(PDFName.of('Contents'))), page.node.Resources(), IDENTITY, 0);
  }
  return out;
}
