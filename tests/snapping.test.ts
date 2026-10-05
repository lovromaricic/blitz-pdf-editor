import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/lib/annotations';
import { candidates, marginPoints, snapAxis, snapBox, snapEdge, SNAP_PX } from '../src/lib/snapping';
import { clampMove } from '../src/lib/page-bounds';

const PAGE: Rect = [0, 0, 600, 800];
const margins = { left: 36, right: 564, top: 36, bottom: 764 };
const other = { box: [300, 300, 400, 340] as Rect, label: 'Text' };

describe('snap candidates', () => {
  it('margins only when shown; center and objects only with smart guides; nothing when both are off', () => {
    expect(candidates({ page: PAGE, margins, smart: false, others: [other] }).x.map((c) => c.kind)).toEqual(['margin', 'margin']);
    expect(candidates({ page: PAGE, margins: null, smart: true, others: [other] }).x.map((c) => c.kind)).toEqual(['center', 'object', 'object', 'object']);
    const none = candidates({ page: PAGE, margins: null, smart: false, others: [other] });
    expect(none.x.length + none.y.length).toBe(0);
    expect(snapBox([40, 40, 100, 100], none)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('a margin pulls the matching edge only (left edge to the left margin, not the right edge)', () => {
    const c = candidates({ page: PAGE, margins, smart: false, others: [] });
    expect(snapBox([40, 200, 100, 260], c)).toMatchObject({ dx: -4, dy: 0 });
    expect(snapBox([0, 200, 39, 260], c).dx).toBe(0); // its right edge near the left margin: no pull
    expect(snapBox([500, 200, 560, 260], c)).toMatchObject({ dx: 4, guides: [{ axis: 'x', at: 564, label: 'right margin' }] });
  });
});

describe('snapping', () => {
  const c = candidates({ page: PAGE, margins, smart: true, others: [other] });

  it('takes the nearest line within the threshold, and nothing beyond it', () => {
    // Box center 297 → page center 300 (3 px) beats the other object's left edge 300 for the box's left 280 (20 px).
    expect(snapBox([270, 500, 324, 520], c)).toMatchObject({ dx: 3 });
    expect(snapAxis(100, 150, c.x, SNAP_PX)).toBeNull();
    expect(snapAxis(100 - 7, 100 - 7, [{ at: 100, accepts: ['start'], kind: 'object', label: '' }])).toBeNull();
  });

  it('ties go to margins, then the page center, then objects', () => {
    const tie = snapAxis(30, 30, [
      { at: 33, accepts: ['start'], kind: 'object', label: 'obj' },
      { at: 27, accepts: ['start'], kind: 'margin', label: 'margin' },
    ]);
    expect(tie?.d).toBe(-3);
  });

  it('shows every line that matches after the snap (several guides at once)', () => {
    // A box exactly as wide as the other object, close to it on both axes.
    const r = snapBox([302, 342, 402, 382], c);
    expect(r.dx).toBe(-2);
    const xs = r.guides.filter((g) => g.axis === 'x').map((g) => g.at);
    expect(xs).toEqual(expect.arrayContaining([300, 350, 400]));
  });

  it('works in screen px: the same pull at every zoom', () => {
    // The same 4 px on screen, whatever the page scale.
    for (const k of [0.5, 1, 4]) {
      const page: Rect = [0, 0, 600 * k, 800 * k];
      const cc = candidates({ page, margins: null, smart: true, others: [] });
      expect(snapBox([300 * k - 30 + 4, 10, 300 * k + 30 + 4, 20], cc).dx).toBe(-4);
      expect(snapBox([300 * k - 30 + 7, 10, 300 * k + 30 + 7, 20], cc).dx).toBe(0);
    }
  });

  it('a dragged edge (resizing) snaps to any line', () => {
    expect(snapEdge('x', 403, c)).toMatchObject({ v: 400 });
    expect(snapEdge('x', 560, c)).toMatchObject({ v: 564 });
    expect(snapEdge('y', 338, c)).toMatchObject({ v: 340 });
  });
});

describe('margins', () => {
  it('in real units: 12.7 mm is 36 pt on any page; limited to a quarter of a small page', () => {
    expect(marginPoints(12.7, 612, 792)).toBeCloseTo(36, 6);
    expect(marginPoints(25.4, 2384, 3370)).toBeCloseTo(72, 6); // A0: the same 1 in
    expect(marginPoints(25.4, 200, 280)).toBe(50); // a quarter of 200
  });
});

describe('snap, then the page edge', () => {
  it('a snap the edge would undo is not taken (clamp first wins)', () => {
    // An object at the right edge "snapping" further right isn't allowed past the edge.
    const m = clampMove([560, 100, 612, 120], [0, 0, 612, 792], 4, 0);
    expect(m).toMatchObject({ dx: 0, limited: true });
  });
});
