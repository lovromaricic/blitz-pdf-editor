// Snapping (smart guides) while an object is moved or resized. Everything is
// in the page layer's screen pixels (y down), so the pull feels the same at
// every zoom. Candidate lines are collected once when a drag starts; each
// move then only measures the dragged box against them. No DOM here.
import type { Rect } from './annotations';

/** How close (screen px) an edge or center must come to a line to snap to it. */
export const SNAP_PX = 6;

/** Which of a box's lines a candidate pulls: its start (left/top), middle, or end (right/bottom). */
export type Feature = 'start' | 'mid' | 'end';
export type GuideKind = 'margin' | 'center' | 'object';

export interface Candidate {
  /** Position of the line (x for vertical lines, y for horizontal ones). */
  at: number;
  accepts: readonly Feature[];
  kind: GuideKind;
  /** What it is, for the guide's label and screen readers ("left margin", "page center", "aligned with Text"). */
  label: string;
}

export interface Candidates {
  x: Candidate[];
  y: Candidate[];
}

export interface Guide {
  axis: 'x' | 'y';
  at: number;
  kind: GuideKind;
  label: string;
}

/** Margins in the page layer's px (already limited for small pages). */
export interface MarginLines {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Another object's lines: its box (screen) and what it's called. */
export interface OtherObject {
  box: Rect;
  label: string;
}

const ALL: readonly Feature[] = ['start', 'mid', 'end'];

/**
 * The lines that may pull: margins only when shown (each pulls the matching
 * edge), the page center and other objects' edges and centers only with
 * smart guides on. Nothing hidden ever pulls.
 */
export function candidates(opts: { page: Rect; margins: MarginLines | null; smart: boolean; others: readonly OtherObject[] }): Candidates {
  const x: Candidate[] = [];
  const y: Candidate[] = [];
  const m = opts.margins;
  if (m) {
    x.push({ at: m.left, accepts: ['start'], kind: 'margin', label: 'left margin' }, { at: m.right, accepts: ['end'], kind: 'margin', label: 'right margin' });
    y.push({ at: m.top, accepts: ['start'], kind: 'margin', label: 'top margin' }, { at: m.bottom, accepts: ['end'], kind: 'margin', label: 'bottom margin' });
  }
  if (opts.smart) {
    const p = opts.page;
    x.push({ at: (p[0] + p[2]) / 2, accepts: ['mid'], kind: 'center', label: 'page center' });
    y.push({ at: (p[1] + p[3]) / 2, accepts: ['mid'], kind: 'center', label: 'page middle' });
    for (const o of opts.others) {
      const label = `aligned with ${o.label}`;
      const b = o.box;
      for (const at of [b[0], (b[0] + b[2]) / 2, b[2]]) x.push({ at, accepts: ALL, kind: 'object', label });
      for (const at of [b[1], (b[1] + b[3]) / 2, b[3]]) y.push({ at, accepts: ALL, kind: 'object', label });
    }
  }
  return { x, y };
}

const RANK: Record<GuideKind, number> = { margin: 0, center: 1, object: 2 };

/**
 * The nearest pull along one axis for a box spanning [lo, hi]: the move that
 * puts one of its lines on a candidate, within `threshold`, and every line
 * that then matches (several guides can show at once). Ties go to margins,
 * then the page center, then other objects.
 */
export function snapAxis(lo: number, hi: number, cands: readonly Candidate[], threshold = SNAP_PX): { d: number; hits: Candidate[] } | null {
  const lines: Record<Feature, number> = { start: lo, mid: (lo + hi) / 2, end: hi };
  let best: { d: number; c: Candidate } | null = null;
  for (const c of cands) {
    for (const f of c.accepts) {
      const d = c.at - lines[f];
      if (Math.abs(d) > threshold) continue;
      if (!best || Math.abs(d) < Math.abs(best.d) - 1e-9 || (Math.abs(Math.abs(d) - Math.abs(best.d)) < 1e-9 && RANK[c.kind] < RANK[best.c.kind])) best = { d, c };
    }
  }
  if (!best) return null;
  const d = best.d;
  // Everything lined up after that move (within half a pixel): one guide each.
  const hits = cands.filter((c) => c.accepts.some((f) => Math.abs(c.at - (lines[f] + d)) < 0.5));
  return { d, hits };
}

/** Snap a moved box: the extra move (dx, dy) and the guides to draw. */
export function snapBox(box: Rect, c: Candidates, threshold = SNAP_PX): { dx: number; dy: number; guides: Guide[] } {
  const sx = snapAxis(box[0], box[2], c.x, threshold);
  const sy = snapAxis(box[1], box[3], c.y, threshold);
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, guides: [...guidesOf('x', sx), ...guidesOf('y', sy)] };
}

/** Snap one dragged edge (resizing): its new position and guides. */
export function snapEdge(axis: 'x' | 'y', v: number, c: Candidates, threshold = SNAP_PX): { v: number; guides: Guide[] } {
  const any = (axis === 'x' ? c.x : c.y).map((k) => ({ ...k, accepts: ALL }));
  const s = snapAxis(v, v, any, threshold);
  return { v: v + (s?.d ?? 0), guides: guidesOf(axis, s) };
}

function guidesOf(axis: 'x' | 'y', s: { hits: Candidate[] } | null): Guide[] {
  if (!s) return [];
  const seen = new Set<number>();
  return s.hits.filter((h) => !seen.has(Math.round(h.at * 2)) && seen.add(Math.round(h.at * 2))).map((h) => ({ axis, at: h.at, kind: h.kind, label: h.label }));
}
