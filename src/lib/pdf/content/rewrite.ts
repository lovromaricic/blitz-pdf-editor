// Rewrites a content stream with some operations removed. Every other byte is
// kept exactly. A removed text operation is replaced by a move of the same
// length (`[n] TJ`, no glyphs), so text drawn after it in the same text object
// stays where it was; a removed image is dropped outright.
import { formatNumber, isStr, num, type Op } from './lexer';
import type { TextRun } from './interpret';

/** What a removed text-showing operation becomes. */
export function textRemoval(op: Op, run: TextRun): string {
  if (run.font.vertical) throw new Error('vertical text');
  const move = run.tfs && run.th ? (-run.advance * 1000) / (run.tfs * run.th) : 0;
  const tj = Math.abs(move) > 1e-6 ? `[${formatNumber(move)}] TJ` : '';
  if (op.op === "'") return `T* ${tj}`.trim();
  if (op.op === '"') return `${formatNumber(num(op.operands[0]))} Tw ${formatNumber(num(op.operands[1]))} Tc T* ${tj}`.trim();
  return tj;
}

/** The stream with operations replaced (empty string: removed). */
export function rewriteStream(bytes: Uint8Array, ops: readonly Op[], edits: ReadonlyMap<number, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 0;
  const enc = new TextEncoder();
  for (const [index, text] of [...edits].sort((a, b) => a[0] - b[0])) {
    const op = ops[index];
    parts.push(bytes.subarray(at, op.start));
    if (text) parts.push(enc.encode(text));
    at = op.end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

/** The raw bytes a text operation shows (to check they're gone from a saved file). */
export function shownBytes(op: Op): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const o of op.operands) {
    if (isStr(o)) out.push(o.bytes);
    else if (Array.isArray(o)) for (const x of o) if (isStr(x)) out.push(x.bytes);
  }
  return out;
}
