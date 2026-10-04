// Compare two PDFs, pure part: words with their positions, and a word-level
// diff grouped into changes. No DOM, so it runs in a worker and in tests.
import { diffArrays } from 'diff';
import type { Rect } from './annotations';

/** One word on a page. `page` is the position in the compared page list. */
export interface Word {
  text: string;
  page: number;
  /** Bounding box in the page's PDF user space. */
  rect: Rect;
}

/** The parts of a text item that tokenizing needs (PDF.js TextItem). */
export interface TextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** Split text runs into words, each with an approximate box (by character share). */
export function wordsOf(runs: readonly TextRun[], page: number): Word[] {
  const out: Word[] = [];
  for (const run of runs) {
    const len = run.str.length;
    if (!len || !run.str.trim()) continue;
    const [a, b, , , x, y] = run.transform;
    const norm = Math.hypot(a, b) || 1;
    const ux = a / norm;
    const uy = b / norm;
    const h = run.height || norm;
    for (const m of run.str.matchAll(/\S+/g)) {
      const x0 = (run.width * m.index) / len;
      const x1 = (run.width * (m.index + m[0].length)) / len;
      // Corners along the text direction, from just below the baseline to the top of capitals.
      const pts = [
        [x0, -0.2 * h],
        [x1, -0.2 * h],
        [x1, 0.9 * h],
        [x0, 0.9 * h],
      ].map(([dx, dy]) => [x + ux * dx - uy * dy, y + uy * dx + ux * dy]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      out.push({ text: m[0], page, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  return out;
}

/**
 * One difference: words [aStart, aEnd) of the first document were replaced by
 * words [bStart, bEnd) of the second. An empty range means added or removed.
 */
export interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

export type HunkKind = 'added' | 'removed' | 'changed';

export function hunkKind(h: Hunk): HunkKind {
  if (h.aStart === h.aEnd) return 'added';
  if (h.bStart === h.bEnd) return 'removed';
  return 'changed';
}

/** Word-level differences between two word lists, in reading order. */
export function computeHunks(a: readonly string[], b: readonly string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  let open: Hunk | null = null;
  for (const part of diffArrays(a as string[], b as string[])) {
    const n = part.count ?? part.value.length;
    if (!part.added && !part.removed) {
      if (open) hunks.push(open);
      open = null;
      ai += n;
      bi += n;
      continue;
    }
    open ??= { aStart: ai, aEnd: ai, bStart: bi, bEnd: bi };
    if (part.removed) {
      ai += n;
      open.aEnd = ai;
    } else {
      bi += n;
      open.bEnd = bi;
    }
  }
  if (open) hunks.push(open);
  return hunks;
}
