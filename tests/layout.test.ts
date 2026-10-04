import { describe, expect, it } from 'vitest';
import { computeLayout, indexAtY } from '../src/lib/layout';

const sizes = [
  { width: 100, height: 200 },
  { width: 100, height: 150 },
  { width: 200, height: 100 },
];

describe('computeLayout', () => {
  it('continuous: one page per row, centered, stacked with gaps', () => {
    const l = computeLayout({ sizes, mode: 'continuous', gap: 10, viewWidth: 400, currentIndex: 0 });
    expect(l.boxes.map((b) => [b.top, b.left])).toEqual([
      [10, 150],
      [220, 150],
      [380, 100],
    ]);
    expect(l.totalHeight).toBe(490);
    expect(l.contentWidth).toBe(220);
    expect(indexAtY(l, 0)).toBe(0);
    expect(indexAtY(l, 230)).toBe(1);
    expect(indexAtY(l, 9999)).toBe(2);
  });

  it('two pages: pairs meet at the center, shorter page centered vertically', () => {
    const l = computeLayout({ sizes, mode: 'two', gap: 10, viewWidth: 400, currentIndex: 0 });
    expect(l.rows.map((r) => r.start)).toEqual([0, 2]);
    // The odd last page (200 wide) sits on the left, so the center line leaves room for it.
    expect(l.contentWidth).toBe(10 + 200 + 5 + 5 + 100 + 10);
    expect(l.boxes[0]).toMatchObject({ top: 10, left: 145 });
    expect(l.boxes[1]).toMatchObject({ top: 35, left: 255 });
    expect(l.boxes[2]).toMatchObject({ top: 220, left: 45 });
  });

  it('two pages: a wide left page never pushes past the left edge', () => {
    const wide = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 300, height: 100 },
      { width: 50, height: 100 },
    ];
    const l = computeLayout({ sizes: wide, mode: 'two', gap: 10, viewWidth: 400, currentIndex: 0 });
    expect(Math.min(...l.boxes.map((b) => b.left))).toBe(10);
    // All rows share one center line.
    expect(l.boxes[0].left + 100 + 5).toBe(l.boxes[2].left + 300 + 5);
    expect(l.contentWidth).toBe(10 + 300 + 5 + 5 + 100 + 10);
  });

  it('single: only the current page is laid out', () => {
    const l = computeLayout({ sizes, mode: 'single', gap: 10, viewWidth: 400, currentIndex: 2 });
    expect(l.rows).toEqual([{ start: 2, top: 10, height: 100 }]);
    expect(l.totalHeight).toBe(120);
    expect(l.boxes[2]).toMatchObject({ top: 10, left: 100 });
  });

  it('never places a page left of the gap when content is wider than the view', () => {
    const l = computeLayout({ sizes, mode: 'continuous', gap: 10, viewWidth: 50, currentIndex: 0 });
    expect(Math.min(...l.boxes.map((b) => b.left))).toBeGreaterThanOrEqual(10);
  });
});

describe('floating controls padding', () => {
  it('starts the first page below the top inset and ends the content after the bottom inset', () => {
    const sizes = [{ width: 100, height: 200 }, { width: 100, height: 200 }];
    const l = computeLayout({ sizes, mode: 'continuous', gap: 16, viewWidth: 300, currentIndex: 0, padTop: 86, padBottom: 84 });
    expect(l.boxes[0].top).toBe(86);
    expect(l.boxes[1].top).toBe(86 + 200 + 16);
    expect(l.totalHeight).toBe(86 + 200 + 16 + 200 + 84);
  });

  it('defaults to the page gap', () => {
    const l = computeLayout({ sizes: [{ width: 100, height: 200 }], mode: 'continuous', gap: 16, viewWidth: 300, currentIndex: 0 });
    expect(l.boxes[0].top).toBe(16);
    expect(l.totalHeight).toBe(16 + 200 + 16);
  });
});
