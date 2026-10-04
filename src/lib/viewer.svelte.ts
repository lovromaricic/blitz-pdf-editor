// View state for one open document: zoom, page layout, scrolling and navigation.
import { getContext, setContext, tick } from 'svelte';
import type { EditorDocument } from './document.svelte';
import { CSS_UNITS } from './pdf/pdfjs';
import { Search } from './search.svelte';

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Space around and between pages in the canvas, in CSS px. */
export const PAGE_GAP = 16;

export type FitMode = 'width' | 'page' | null;
export type Tool = 'select' | 'text' | 'highlight' | 'draw' | 'shapes' | 'stamp' | 'comment' | 'sign' | 'form';

interface PageBox {
  top: number;
  width: number;
  height: number;
}

export class Viewer {
  zoom = $state(1);
  fit = $state<FitMode>('width');
  currentIndex = $state(0);
  showThumbnails = $state(true);
  showPanel = $state(true);
  tool = $state<Tool>('select');

  /** Mirrors of the scroll container's geometry, for virtualized rendering. */
  scrollTop = $state(0);
  viewHeight = $state(0);

  scrollEl: HTMLElement | null = null;
  readonly search: Search;

  constructor(public doc: EditorDocument) {
    this.search = new Search(doc);
  }

  /** Display scale: CSS px per PDF point. */
  scale = $derived(this.zoom * CSS_UNITS);

  layout = $derived.by(() => {
    const boxes: PageBox[] = [];
    let top = PAGE_GAP;
    let maxWidth = 0;
    for (const page of this.doc.pages) {
      const size = this.doc.displaySize(page);
      const width = Math.floor(size.width * this.scale);
      const height = Math.floor(size.height * this.scale);
      boxes.push({ top, width, height });
      top += height + PAGE_GAP;
      maxWidth = Math.max(maxWidth, width);
    }
    return { boxes, totalHeight: top, maxWidth };
  });

  /** Indexes of pages close enough to the view to be in the DOM. */
  visibleRange = $derived.by(() => {
    const n = this.layout.boxes.length;
    if (n === 0) return { start: 0, end: -1 };
    const overscan = Math.max(this.viewHeight, 400);
    const start = this.indexAt(this.scrollTop - overscan);
    const end = this.indexAt(this.scrollTop + this.viewHeight + overscan);
    return { start, end };
  });

  get pageCount() {
    return this.doc.pages.length;
  }

  // --- Navigation -------------------------------------------------------

  /** Set while a programmatic scroll is in flight, so the page we jumped to stays current. */
  private lockedIndex: number | null = null;

  goToPage(index: number, offsetInPage = 0) {
    const i = clamp(index, 0, this.pageCount - 1);
    this.currentIndex = i;
    const box = this.layout.boxes[i];
    if (this.scrollEl && box) {
      this.lockedIndex = i;
      this.scrollEl.scrollTop = box.top - PAGE_GAP + offsetInPage;
      // Scroll events fire before animation frame callbacks, so this clears the lock after them.
      requestAnimationFrame(() => (this.lockedIndex = null));
    }
  }

  nextPage() {
    this.goToPage(this.currentIndex + 1);
  }

  previousPage() {
    this.goToPage(this.currentIndex - 1);
  }

  /** Called on scroll: the current page is the one crossing the upper third of the view. */
  updateCurrentFromScroll() {
    const el = this.scrollEl;
    if (!el) return;
    this.scrollTop = el.scrollTop;
    this.viewHeight = el.clientHeight;
    if (this.lockedIndex !== null) {
      this.currentIndex = this.lockedIndex;
      return;
    }
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const probe = atBottom ? el.scrollHeight - 1 : el.scrollTop + el.clientHeight / 3;
    this.currentIndex = this.indexAt(probe);
  }

  indexAt(y: number) {
    const boxes = this.layout.boxes;
    let lo = 0;
    let hi = boxes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (boxes[mid].top <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // --- Zoom -------------------------------------------------------------

  /** Change zoom, keeping the point at the view's center (or the given anchor) in place. */
  async setZoom(zoom: number, fit: FitMode = null, anchor?: { x: number; y: number }) {
    const z = clamp(Math.round(zoom * 1000) / 1000, MIN_ZOOM, MAX_ZOOM);
    this.fit = fit;
    if (z === this.zoom) return;

    const el = this.scrollEl;
    if (!el) {
      this.zoom = z;
      return;
    }
    const ax = anchor?.x ?? el.clientWidth / 2;
    const ay = anchor?.y ?? el.clientHeight / 2;
    // Remember which page is under the anchor and where within it.
    const y = el.scrollTop + ay;
    const i = this.indexAt(y);
    const box = this.layout.boxes[i];
    const fracY = box ? (y - box.top) / box.height : 0;
    const contentX = el.scrollLeft + ax;
    const fracX = el.scrollWidth > 0 ? contentX / el.scrollWidth : 0.5;

    this.zoom = z;
    await tick();

    const nb = this.layout.boxes[i];
    if (nb) el.scrollTop = nb.top + fracY * nb.height - ay;
    el.scrollLeft = fracX * el.scrollWidth - ax;
  }

  zoomIn() {
    const next = ZOOM_STEPS.find((s) => s > this.zoom * 1.05) ?? MAX_ZOOM;
    void this.setZoom(next);
  }

  zoomOut() {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < this.zoom / 1.05) ?? MIN_ZOOM;
    void this.setZoom(prev);
  }

  actualSize() {
    void this.setZoom(1);
  }

  fitWidth() {
    void this.setZoom(this.fitWidthZoom(), 'width');
  }

  fitPage() {
    void this.setZoom(this.fitPageZoom(), 'page');
  }

  /** Re-apply the active fit mode (after a resize or page size change). */
  refit() {
    if (this.fit === 'width') void this.setZoom(this.fitWidthZoom(), 'width');
    else if (this.fit === 'page') void this.setZoom(this.fitPageZoom(), 'page');
  }

  private fitWidthZoom() {
    const el = this.scrollEl;
    if (!el || this.pageCount === 0) return 1;
    let widest = 0;
    for (const p of this.doc.pages) widest = Math.max(widest, this.doc.displaySize(p).width);
    return (el.clientWidth - 2 * PAGE_GAP) / (widest * CSS_UNITS);
  }

  private fitPageZoom() {
    const el = this.scrollEl;
    const page = this.doc.pages[this.currentIndex];
    if (!el || !page) return 1;
    const size = this.doc.displaySize(page);
    return Math.min(
      (el.clientWidth - 2 * PAGE_GAP) / (size.width * CSS_UNITS),
      (el.clientHeight - 2 * PAGE_GAP) / (size.height * CSS_UNITS),
    );
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const KEY = Symbol('viewer');

export function provideViewer(v: Viewer) {
  setContext(KEY, v);
}

export function useViewer(): Viewer {
  return getContext<Viewer>(KEY);
}
