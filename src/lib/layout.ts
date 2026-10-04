// Page layout for the canvas: where each page sits, in CSS pixels. Pure, so it's testable.

export type ViewMode = 'continuous' | 'single' | 'two';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Layout {
  boxes: Box[];
  totalHeight: number;
  /** Width the content needs (widest row plus gaps). */
  contentWidth: number;
  /** Rows in order: first page index, top and height. */
  rows: Row[];
}

export interface Row {
  start: number;
  top: number;
  height: number;
}

export interface LayoutInput {
  /** Displayed page sizes in CSS px (already scaled). */
  sizes: { width: number; height: number }[];
  mode: ViewMode;
  gap: number;
  /** Visible width of the scroll area, used to center rows. */
  viewWidth: number;
  /** In single-page mode only this page is laid out. */
  currentIndex: number;
}

export function pagesPerRow(mode: ViewMode) {
  return mode === 'two' ? 2 : 1;
}

/** First page index of the row containing `index`. */
export function rowStartOf(mode: ViewMode, index: number) {
  return mode === 'two' ? index - (index % 2) : index;
}

export function computeLayout({ sizes, mode, gap, viewWidth, currentIndex }: LayoutInput): Layout {
  const n = sizes.length;
  const perRow = pagesPerRow(mode);
  const rows: number[][] = [];
  if (mode === 'single') {
    if (n > 0) rows.push([Math.min(Math.max(currentIndex, 0), n - 1)]);
  } else {
    for (let i = 0; i < n; i += perRow) rows.push(Array.from({ length: Math.min(perRow, n - i) }, (_, k) => i + k));
  }

  // Two-page rows meet at a shared center line, so each side needs room for its widest page.
  let contentWidth: number;
  let center = 0;
  if (mode === 'two') {
    const leftNeed = gap + Math.max(0, ...rows.map((r) => sizes[r[0]].width)) + gap / 2;
    const rightNeed = gap / 2 + Math.max(0, ...rows.map((r) => (r[1] !== undefined ? sizes[r[1]].width : 0))) + gap;
    contentWidth = leftNeed + rightNeed;
    center = leftNeed + Math.max(0, viewWidth - contentWidth) / 2;
  } else {
    contentWidth = Math.max(0, ...rows.map((r) => sizes[r[0]].width)) + 2 * gap;
  }
  const width = Math.max(viewWidth, contentWidth);

  // Pages not laid out (single mode) all sit at the top, hidden by the view.
  const boxes: Box[] = sizes.map((s) => ({ top: gap, left: gap, width: s.width, height: s.height }));
  let top = gap;
  const rowInfo: Row[] = [];
  for (const row of rows) {
    const rowH = Math.max(...row.map((i) => sizes[i].height));
    rowInfo.push({ start: row[0], top, height: rowH });
    if (mode === 'two' && row.length === 2) {
      // Pages meet at the center line, each vertically centered in the row.
      const [a, b] = row;
      boxes[a] = { top: top + (rowH - sizes[a].height) / 2, left: center - gap / 2 - sizes[a].width, width: sizes[a].width, height: sizes[a].height };
      boxes[b] = { top: top + (rowH - sizes[b].height) / 2, left: center + gap / 2, width: sizes[b].width, height: sizes[b].height };
    } else {
      for (const i of row) {
        const left = mode === 'two' ? center - gap / 2 - sizes[i].width : (width - sizes[i].width) / 2;
        boxes[i] = { top, left: Math.max(gap, left), width: sizes[i].width, height: sizes[i].height };
      }
    }
    top += rowH + gap;
  }

  return { boxes, totalHeight: top, contentWidth, rows: rowInfo };
}

/** Index of the row at content y (the last row starting at or above y). */
export function rowAtY(layout: Layout, y: number): number {
  const { rows } = layout;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** First page of the row at content y. */
export function indexAtY(layout: Layout, y: number): number {
  return layout.rows[rowAtY(layout, y)]?.start ?? 0;
}
