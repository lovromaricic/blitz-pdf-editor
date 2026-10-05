// Tokenizes a PDF content stream into operations, keeping each operation's
// byte range so an edit can remove or replace exactly that operation and leave
// every other byte as it was. Pure: no pdf-lib, runs anywhere (worker, tests).
//
// Operands are kept as plain values: numbers, names (`{ name }`), strings
// (raw bytes, literal or hex), arrays, dictionaries, booleans and null.

export type Operand = number | boolean | null | PdfName | PdfStr | Operand[] | PdfDictValue;
export interface PdfName {
  name: string;
}
export interface PdfStr {
  bytes: Uint8Array;
  hex: boolean;
}
export interface PdfDictValue {
  dict: Map<string, Operand>;
}

export interface Op {
  /** The operator: Tj, TJ, cm, Do, BI (an inline image, ID and EI included)… */
  op: string;
  operands: Operand[];
  /** Byte range of the whole operation (first operand to the end of the operator). */
  start: number;
  end: number;
  /** Inline images: the image dictionary (abbreviated keys as written) and data range. */
  inline?: { dict: Map<string, Operand>; dataStart: number; dataEnd: number };
}

export class ContentSyntaxError extends Error {}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c);

export const isName = (o: Operand | undefined): o is PdfName => !!o && typeof o === 'object' && 'name' in o;
export const isStr = (o: Operand | undefined): o is PdfStr => !!o && typeof o === 'object' && 'bytes' in o;
export const isDict = (o: Operand | undefined): o is PdfDictValue => !!o && typeof o === 'object' && 'dict' in o;
export const num = (o: Operand | undefined, fallback = 0) => (typeof o === 'number' && Number.isFinite(o) ? o : fallback);

/** Parse a whole content stream. Throws ContentSyntaxError on malformed syntax (never guesses). */
export function tokenize(b: Uint8Array): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let operands: Operand[] = [];
  let opStart = -1;

  const skipWs = () => {
    while (i < b.length) {
      const c = b[i];
      if (WS.has(c)) i++;
      else if (c === 0x25) {
        // Comment to end of line.
        while (i < b.length && b[i] !== 0x0a && b[i] !== 0x0d) i++;
      } else break;
    }
  };

  const readObject = (): Operand | { op: string } => {
    const c = b[i];
    if (c === 0x2f) {
      i++;
      const s = i;
      while (i < b.length && isRegular(b[i])) i++;
      return { name: decodeName(b.subarray(s, i)) };
    }
    if (c === 0x28) return readLiteral();
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) return readDict();
      return readHex();
    }
    if (c === 0x5b) {
      i++;
      const arr: Operand[] = [];
      for (;;) {
        skipWs();
        if (i >= b.length) throw new ContentSyntaxError('unterminated array');
        if (b[i] === 0x5d) {
          i++;
          return arr;
        }
        const o = readObject();
        if (o && typeof o === 'object' && 'op' in o) throw new ContentSyntaxError(`operator ${o.op} inside an array`);
        arr.push(o as Operand);
      }
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) throw new ContentSyntaxError(`unexpected ${String.fromCharCode(c)}`);
    // A number, a keyword (true/false/null) or an operator.
    const s = i;
    while (i < b.length && isRegular(b[i])) i++;
    const word = latin1(b.subarray(s, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    // Some producers write "--5" or "4.-2": PDF readers accept them leniently.
    if (/^[+-]*\d*\.?\d*[-.\d]*$/.test(word) && /\d/.test(word)) {
      const n = parseFloat(word.replace(/^[+-]+/, (m) => (m.split('-').length % 2 === 0 ? '-' : '')));
      if (Number.isFinite(n)) return n;
    }
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    if (!word) throw new ContentSyntaxError(`unexpected byte ${c}`);
    return { op: word };
  };

  const readLiteral = (): PdfStr => {
    i++;
    const out: number[] = [];
    let depth = 1;
    while (i < b.length) {
      const c = b[i++];
      if (c === 0x5c) {
        const n = b[i++];
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (n in map) out.push(map[n]);
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30;
          for (let k = 0; k < 2 && b[i] >= 0x30 && b[i] <= 0x37; k++) v = v * 8 + (b[i++] - 0x30);
          out.push(v & 0xff);
        } else if (n === 0x0d) {
          if (b[i] === 0x0a) i++;
        } else if (n !== 0x0a) out.push(n);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) return { bytes: new Uint8Array(out), hex: false };
        out.push(c);
      } else out.push(c);
    }
    throw new ContentSyntaxError('unterminated string');
  };

  const readHex = (): PdfStr => {
    i++;
    const digits: number[] = [];
    while (i < b.length && b[i] !== 0x3e) {
      const c = b[i++];
      if (WS.has(c)) continue;
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
      if (v < 0) throw new ContentSyntaxError('bad hex string');
      digits.push(v);
    }
    if (i >= b.length) throw new ContentSyntaxError('unterminated hex string');
    i++;
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = digits[2 * k] * 16 + digits[2 * k + 1];
    return { bytes: out, hex: true };
  };

  const readDict = (): PdfDictValue => {
    i += 2;
    const dict = new Map<string, Operand>();
    for (;;) {
      skipWs();
      if (i >= b.length) throw new ContentSyntaxError('unterminated dictionary');
      if (b[i] === 0x3e && b[i + 1] === 0x3e) {
        i += 2;
        return { dict };
      }
      const k = readObject();
      if (!isName(k as Operand)) throw new ContentSyntaxError('dictionary key is not a name');
      skipWs();
      const v = readObject();
      if (v && typeof v === 'object' && 'op' in v) throw new ContentSyntaxError('operator inside a dictionary');
      dict.set((k as PdfName).name, v as Operand);
    }
  };

  for (;;) {
    skipWs();
    if (i >= b.length) break;
    const at = i;
    const o = readObject();
    if (o && typeof o === 'object' && 'op' in o) {
      const start = opStart < 0 ? at : opStart;
      if (o.op === 'BI') {
        ops.push(readInlineImage(start));
      } else {
        ops.push({ op: o.op, operands, start, end: i });
      }
      operands = [];
      opStart = -1;
    } else {
      if (opStart < 0) opStart = at;
      operands.push(o as Operand);
    }
  }
  if (operands.length) throw new ContentSyntaxError('operands without an operator at the end');
  return ops;

  function readInlineImage(start: number): Op {
    const dict = new Map<string, Operand>();
    for (;;) {
      skipWs();
      if (i >= b.length) throw new ContentSyntaxError('unterminated inline image');
      const k = readObject();
      if (k && typeof k === 'object' && 'op' in k) {
        if (k.op !== 'ID') throw new ContentSyntaxError('bad inline image');
        break;
      }
      if (!isName(k as Operand)) throw new ContentSyntaxError('bad inline image key');
      skipWs();
      const v = readObject();
      dict.set((k as PdfName).name, v as Operand);
    }
    // One white-space byte after ID, then the data up to "EI" (between white space, followed by
    // something that parses as the next operation or the end).
    const dataStart = i + 1;
    let j = dataStart;
    for (;;) {
      j = indexOfEI(b, j);
      if (j < 0) throw new ContentSyntaxError('inline image without EI');
      const after = j + 2;
      if (after >= b.length || WS.has(b[after])) {
        if (looksLikeOps(b, after)) break;
      }
      j += 2;
    }
    let dataEnd = j;
    while (dataEnd > dataStart && WS.has(b[dataEnd - 1])) dataEnd--;
    i = j + 2;
    return { op: 'BI', operands: [], start, end: i, inline: { dict, dataStart, dataEnd } };
  }
}

function indexOfEI(b: Uint8Array, from: number) {
  for (let k = from; k + 1 < b.length; k++) if (b[k] === 0x45 && b[k + 1] === 0x49 && (k === 0 || WS.has(b[k - 1]))) return k;
  return -1;
}

/** After an EI candidate: only plausible content-stream text (printable ASCII) for a while. */
function looksLikeOps(b: Uint8Array, from: number) {
  const end = Math.min(b.length, from + 64);
  for (let k = from; k < end; k++) {
    const c = b[k];
    if (!(WS.has(c) || (c >= 0x20 && c < 0x7f))) return false;
  }
  return true;
}

function decodeName(raw: Uint8Array) {
  let s = '';
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === 0x23 && k + 2 < raw.length) {
      const h = parseInt(String.fromCharCode(raw[k + 1], raw[k + 2]), 16);
      if (Number.isFinite(h)) {
        s += String.fromCharCode(h);
        k += 2;
        continue;
      }
    }
    s += String.fromCharCode(raw[k]);
  }
  return s;
}

export function latin1(b: Uint8Array) {
  let s = '';
  for (let k = 0; k < b.length; k++) s += String.fromCharCode(b[k]);
  return s;
}

// --- Writing operands back (for operations the editor replaces) ---------------------------------

export function writeOperand(o: Operand): string {
  if (typeof o === 'number') return formatNumber(o);
  if (typeof o === 'boolean') return String(o);
  if (o === null) return 'null';
  if (Array.isArray(o)) return `[${o.map(writeOperand).join(' ')}]`;
  if (isName(o)) return `/${[...o.name].map((ch) => (/[A-Za-z0-9._+\-*]/.test(ch) ? ch : `#${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)).join('')}`;
  if (isStr(o)) return `<${Array.from(o.bytes, (x) => x.toString(16).padStart(2, '0')).join('')}>`;
  return `<<${[...o.dict].map(([k, v]) => `${writeOperand({ name: k })} ${writeOperand(v)}`).join(' ')}>>`;
}

export function formatNumber(n: number) {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
