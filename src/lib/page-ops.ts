// Pure operations on the page list. Each returns a new array and never mutates
// its input, so results can go straight into undo history.
import type { PageRef } from './document.svelte';

type Pages = readonly PageRef[];

export function rotatePages(pages: Pages, ids: ReadonlySet<string>, delta: number): Pages {
  return pages.map((p) => (ids.has(p.id) ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 } : p));
}

export function deletePages(pages: Pages, ids: ReadonlySet<string>): Pages {
  return pages.filter((p) => !ids.has(p.id));
}

/** Insert `added` so the first one lands at `index`. */
export function insertPages(pages: Pages, index: number, added: readonly PageRef[]): Pages {
  const at = Math.max(0, Math.min(index, pages.length));
  return [...pages.slice(0, at), ...added, ...pages.slice(at)];
}

/**
 * Move the pages in `ids` (keeping their relative order) so they sit before the
 * page currently at `targetIndex` (or at the end if targetIndex === length).
 */
export function movePages(pages: Pages, ids: ReadonlySet<string>, targetIndex: number): Pages {
  const moving = pages.filter((p) => ids.has(p.id));
  if (moving.length === 0) return pages;
  const before = pages.slice(0, targetIndex).filter((p) => !ids.has(p.id)).length;
  const rest = pages.filter((p) => !ids.has(p.id));
  const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  return next.every((p, i) => p === pages[i]) ? pages : next;
}

/**
 * Parse a page range like "1-3, 5, 8-" into 0-based indexes (sorted, unique).
 * Returns null if the text is invalid or out of bounds.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const out = new Set<number>();
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(\d*)\s*(?:(-)\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const start = m[1] ? parseInt(m[1], 10) : 1;
    const end = m[2] ? (m[3] ? parseInt(m[3], 10) : pageCount) : start;
    if (start < 1 || end > pageCount || start > end) return null;
    for (let i = start; i <= end; i++) out.add(i - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** Format 0-based indexes as a compact 1-based range string, e.g. "1-3, 5". */
export function formatPageRange(indexes: readonly number[]): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start + 1}` : `${start + 1}-${sorted[i] + 1}`);
  }
  return parts.join(', ');
}

/** Split page indexes [0, count) into consecutive chunks of `size`. */
export function chunkEvery(count: number, size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i += size) out.push(Array.from({ length: Math.min(size, count - i) }, (_, k) => i + k));
  return out;
}

/** Split [0, count) into ranges that start at each of `starts` (0-based, page 0 implied). */
export function chunkAt(count: number, starts: readonly number[]): number[][] {
  const cuts = [...new Set([0, ...starts.filter((s) => s > 0 && s < count)])].sort((a, b) => a - b);
  return cuts.map((start, k) => {
    const end = k + 1 < cuts.length ? cuts[k + 1] : count;
    return Array.from({ length: end - start }, (_, j) => start + j);
  });
}

/** Crop margins in points. For storage these are in PDF user space (unrotated). */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_MARGINS: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Convert user-space margins to margins as seen on screen after rotating the
 * page clockwise by `rotation` degrees (own /Rotate plus user rotation).
 */
export function marginsToDisplayed(m: Margins, rotation: number): Margins {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { top: m.left, right: m.top, bottom: m.right, left: m.bottom };
    case 180:
      return { top: m.bottom, right: m.left, bottom: m.top, left: m.right };
    case 270:
      return { top: m.right, right: m.bottom, bottom: m.left, left: m.top };
    default:
      return { ...m };
  }
}

/** Inverse of marginsToDisplayed. */
export function marginsFromDisplayed(m: Margins, rotation: number): Margins {
  return marginsToDisplayed(m, 360 - (((rotation % 360) + 360) % 360));
}

export function setCrop(pages: Pages, ids: ReadonlySet<string>, cropFor: (p: PageRef) => Margins | undefined): Pages {
  return pages.map((p) => {
    if (!ids.has(p.id)) return p;
    const crop = cropFor(p);
    const empty = !crop || (crop.top === 0 && crop.right === 0 && crop.bottom === 0 && crop.left === 0);
    if (empty && !p.crop) return p;
    const { crop: _old, ...rest } = p;
    return empty ? rest : { ...rest, crop };
  });
}
