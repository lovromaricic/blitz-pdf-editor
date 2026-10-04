// Redaction marks: plain geometry, shared by the panel, the actions and tests.
import type { Rect } from './annotations';
import type { PageRef } from './document.svelte';

/** Marks per source page. A page used twice in the document gets the marks of both. */
export function groupMarks(pages: readonly PageRef[]): Map<string, Map<number, Rect[]>> {
  const out = new Map<string, Map<number, Rect[]>>();
  for (const p of pages) {
    if (!p.redactions?.length) continue;
    const bySource = out.get(p.sourceId) ?? new Map<number, Rect[]>();
    bySource.set(p.sourceIndex, [...(bySource.get(p.sourceIndex) ?? []), ...p.redactions]);
    out.set(p.sourceId, bySource);
  }
  return out;
}

/** Pad a text match so ascenders, descenders and accents are covered too. */
export function padTextRect([x0, y0, x1, y1]: Rect): Rect {
  const h = y1 - y0;
  return [x0 - 1, y0 - h * 0.12, x1 + 1, y1 + h * 0.25];
}
