// View state for one open document: zoom, page layout, scrolling and navigation.
import { isGroupId, unitOf, type ObjectSelection } from './object-selection';
import { limitRect, type LimitKind } from './page-bounds';
import { marginPoints } from './snapping';
import type { CropSession } from './image-crop';
import { ContentEditing } from './content-editing.svelte';
import { ContentModeReturn } from './content-route';
import { getContext, setContext, tick } from 'svelte';
import type { EditorDocument, PageRef } from './document.svelte';
import type { Margins } from './page-ops';
import { HIGHLIGHT_COLORS, INK_COLORS, NOTE_COLORS, STAMPS, type Annotation, type FontFamily, type Rect, type Rgb, type ShapeKind, type TextAlign } from './annotations';
import { DEFAULT_LINE_SPACING } from './text-format';
import type { RichEditorApi } from './rich-text/api';
import { lastTextStyle, loadFonts } from './fonts';
import { decorationResolver } from './pdf/pdf-writer';
import { computeLayout, indexAtY, pagesPerRow, rowAtY, rowStartOf, type ViewMode } from './layout';
import { CSS_UNITS } from './pdf/pdfjs';
import { Search } from './search.svelte';
import { friendlyError } from './friendly-error';

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Space around and between pages in the canvas, in CSS px. */
export const PAGE_GAP = 16;

/**
 * Desktop and tablet: the toolbar pill and the bottom controls float over the
 * pages. The content is padded so page 1 starts below the pill and the last
 * page scrolls clear of the bottom controls, and scrolling to a page or match
 * keeps it out from under them. Each is 16px edge + control height + 20px.
 */
export const FLOATING_INSETS = { top: 16 + 50 + 20, bottom: 16 + 48 + 20 };

export type FitMode = 'width' | 'page' | null;
/** Tool panels shown in the right-hand panel (opened from menus). */
export type ToolPanel =
  | 'ocr'
  | 'redact'
  | 'extract'
  | 'split'
  | 'merge'
  | 'crop'
  | 'watermark'
  | 'pageNumbers'
  | 'protect'
  | 'unlock'
  | 'compress'
  | 'imagesToPdf'
  | 'exportImages';

export interface Task {
  label: string;
  /** 0..1, or null when unknown. */
  progress: number | null;
  /** Present for jobs that can be stopped (shows a Cancel button). */
  cancel?: () => void;
}

export type Tool = 'select' | 'content' | 'text' | 'highlight' | 'draw' | 'shapes' | 'stamp' | 'comment' | 'sign' | 'form';

/** Settings each markup tool uses for new annotations. */
export interface ToolProps {
  highlight: { color: Rgb; opacity: number; wholeLine: boolean };
  draw: { color: Rgb; width: number; opacity: number };
  shapes: { shape: ShapeKind; color: Rgb; fill: Rgb | null; width: number; opacity: number };
  text: {
    font: FontFamily;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    align: TextAlign;
    lineSpacing: number;
    background: Rgb | null;
    size: number;
    color: Rgb;
    opacity: number;
  };
  stamp: { label: string; color: Rgb };
  comment: { color: Rgb };
}

/** The user's signature for this session only (never stored). */
export interface Signature {
  dataUrl: string;
  /** Pixel size, for the aspect ratio. */
  width: number;
  height: number;
}

export interface AnnotRef {
  pageId: string;
  id: string;
}

export class Viewer {
  zoom = $state(1);
  fit = $state<FitMode>('width');
  currentIndex = $state(0);
  showThumbnails = $state(true);
  showPanel = $state(true);
  tool = $state<Tool>('select');
  mode = $state<ViewMode>('continuous');
  toolProps = $state<ToolProps>({
    highlight: { color: HIGHLIGHT_COLORS[0].rgb, opacity: 0.5, wholeLine: false },
    draw: { color: INK_COLORS[0].rgb, width: 2, opacity: 1 },
    shapes: { shape: 'rect', color: INK_COLORS[1].rgb, fill: null, width: 2, opacity: 1 },
    // The last font used in this session (memory only).
    text: {
      ...lastTextStyle,
      underline: false,
      strike: false,
      align: 'left',
      lineSpacing: DEFAULT_LINE_SPACING,
      background: null,
      size: 12,
      color: INK_COLORS[0].rgb,
      opacity: 1,
    },
    stamp: { label: STAMPS[0].label, color: STAMPS[0].color },
    comment: { color: NOTE_COLORS[0].rgb },
  });
  signature = $state.raw<Signature | null>(null);
  /** Set to open the signature dialog. */
  signatureDialog = $state(false);
  /** A comment just placed: the panel focuses its text box. */
  focusNoteText = $state(false);
  /**
   * Objects selected with the Select tool: units (objects, or whole groups) on
   * one page. One plain object is the common case: `selectedAnnot`.
   */
  objectSelection = $state.raw<ObjectSelection | null>(null);

  /** The selected object when exactly one plain object (not a group) is selected. */
  get selectedAnnot(): AnnotRef | null {
    const s = this.objectSelection;
    return s && s.ids.length === 1 && !isGroupId(s.ids[0]) ? { pageId: s.pageId, id: s.ids[0] } : null;
  }
  /** The PDF's own content (Edit content tool): what's on each page, and deleting it. */
  readonly content = new ContentEditing();
  /** Open the text editor on a text box (and put the caret at a point on screen). Taken by its page's layer. */
  editRequest = $state.raw<{ pageId: string; id: string; caret?: [number, number] } | null>(null);
  /** Where Edit content goes back to when it was entered by a double-click. */
  readonly contentReturn = new ContentModeReturn();
  /** Original content selected with the Edit content tool: items on one page (ids from its analysis). */
  contentSelection = $state.raw<{ pageId: string; ids: string[] } | null>(null);
  /** Crop mode for one inserted image (see actions.startCrop), or null. */
  imageCrop = $state.raw<CropSession | null>(null);
  /** The selected annotation while it's being dragged (not yet in the document), for live panel values. */
  livePreview = $state.raw<Annotation | null>(null);
  /**
   * The canvas context menu: for an object (`objectId`) or an empty spot of a
   * page (`point`, in PDF space, where "Paste here" puts things). Opened by a
   * right-click, a long press, the Menu key or Shift+F10; Editor.svelte shows it.
   */
  contextMenu = $state.raw<{ x: number; y: number; pageId: string; objectId: string | null; point: [number, number] | null; contentId?: string } | null>(null);
  /** While a text box is being typed in: its editor (formats the selection or the typing style). */
  textEditor = $state.raw<RichEditorApi | null>(null);
  /** Image panel: corner handles and size fields keep the image's proportions. */
  imageAspectLock = $state(true);

  /** Page ids selected in the thumbnail rail. */
  selection = $state.raw<ReadonlySet<string>>(new Set());
  private anchorId: string | null = null;
  panel = $state<ToolPanel | null>(null);
  task = $state<Task | null>(null);
  /** While the crop panel is open: pages show uncropped, with these margins (on-screen orientation, points) shaded. */
  cropPreview = $state.raw<{ ids: ReadonlySet<string>; margins: Margins } | null>(null);
  notice = $state<{ text: string; id: number; error: boolean } | null>(null);
  /** Read out by screen readers (a visually hidden live region), e.g. "Image deleted". */
  announcement = $state('');
  /** Redaction also removes the document's properties (title, author…). */
  redactRemoveInfo = $state(true);

  /** Mirrors of the scroll container's geometry, for virtualized rendering. */
  scrollTop = $state(0);
  viewHeight = $state(0);
  viewWidth = $state(0);

  scrollEl: HTMLElement | null = null;
  /** Content padding above the first and below the last page (floating controls on desktop). */
  insetTop = $state(PAGE_GAP);
  insetBottom = $state(PAGE_GAP);
  readonly search: Search;

  constructor(public doc: EditorDocument) {
    this.search = new Search(doc);
  }

  /** Load fonts (once) when something on the pages needs them. */
  ensureFonts() {
    if (!this.fontsReady) void loadFonts().then(() => (this.fontsReady = true));
  }

  /** Watermark and page number per page (follows page order and settings). */
  decorationFor = $derived.by(() => decorationResolver(this.doc));
  /** Fonts are needed to measure watermarks and numbers before showing them. */
  fontsReady = $state(false);

  /** Display scale: CSS px per PDF point. */
  scale = $derived(this.zoom * CSS_UNITS);

  layout = $derived.by(() =>
    computeLayout({
      sizes: this.doc.pages.map((page) => {
        const size = this.cropPreview ? this.doc.fullDisplaySize(page) : this.doc.displaySize(page);
        return { width: Math.floor(size.width * this.scale), height: Math.floor(size.height * this.scale) };
      }),
      mode: this.mode,
      gap: PAGE_GAP,
      viewWidth: this.viewWidth,
      // Only single-page mode depends on the current page.
      currentIndex: this.mode === 'single' ? this.currentIndex : 0,
      padTop: this.insetTop,
      padBottom: this.insetBottom,
    }),
  );

  /** Indexes of pages close enough to the view to be in the DOM. */
  visibleRange = $derived.by(() => {
    const { rows, boxes } = this.layout;
    if (boxes.length === 0) return { start: 0, end: -1 };
    if (this.mode === 'single') return { start: this.currentIndex, end: this.currentIndex };
    const overscan = Math.max(this.viewHeight, 400);
    const first = rowAtY(this.layout, this.scrollTop - overscan);
    const last = rowAtY(this.layout, this.scrollTop + this.viewHeight + overscan);
    return { start: rows[first].start, end: (rows[last + 1]?.start ?? boxes.length) - 1 };
  });

  get pageCount() {
    return this.doc.pages.length;
  }

  // --- Selection --------------------------------------------------------

  /** single: only this page; toggle: add/remove (Ctrl/Cmd); range: from the anchor (Shift). */
  select(id: string, mode: 'single' | 'toggle' | 'range' = 'single') {
    const pages = this.doc.pages;
    this.objectSelection = null;
    if (mode === 'range' && this.anchorId) {
      const a = pages.findIndex((p) => p.id === this.anchorId);
      const b = pages.findIndex((p) => p.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.selection = new Set(pages.slice(lo, hi + 1).map((p) => p.id));
        return;
      }
    }
    if (mode === 'toggle') {
      const next = new Set(this.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.selection = next;
    } else {
      this.selection = new Set([id]);
    }
    this.anchorId = id;
  }

  selectAll() {
    this.selection = new Set(this.doc.pages.map((p) => p.id));
  }

  clearSelection() {
    this.selection = new Set();
    this.anchorId = null;
  }

  setTool(tool: Tool) {
    if (tool === 'text' || tool === 'stamp') void loadFonts();
    if (tool === 'sign' && !this.signature) this.signatureDialog = true;
    this.tool = tool;
    this.objectSelection = null;
    this.contentSelection = null;
    this.contentReturn.reset();
    this.panel = null;
    window.getSelection()?.removeAllRanges();
  }

  /** Leave Edit content for the tool it was entered from (by a double-click). False when it stays. */
  leaveContentTool(): boolean {
    if (this.tool !== 'content') return false;
    const back = this.contentReturn.leave();
    if (!back) return false;
    this.setTool(back);
    return true;
  }

  /** Select original content (Edit content tool) on one page, or nothing. Clears other selections. */
  selectContent(sel: { pageId: string; ids: string[] } | null) {
    this.contentSelection = sel && sel.ids.length ? sel : null;
    if (this.contentSelection) {
      this.objectSelection = null;
      if (this.selection.size) this.selection = new Set();
      this.panel = null;
    }
  }

  selectAnnot(ref: AnnotRef | null) {
    this.selectObjects(ref ? { pageId: ref.pageId, ids: [ref.id] } : null);
  }

  /** Select objects (units) on one page, or nothing. */
  selectObjects(sel: ObjectSelection | null) {
    const next = sel && sel.ids.length ? sel : null;
    const cur = this.objectSelection;
    // Selecting what's already selected changes nothing (and wakes nothing that follows it).
    const same = !!next && !!cur && cur.pageId === next.pageId && cur.ids.length === next.ids.length && cur.ids.every((id, i) => id === next.ids[i]);
    if (!same) this.objectSelection = next;
    if (next) {
      this.contentSelection = null;
      if (this.selection.size) this.selection = new Set();
      this.panel = null;
    }
  }


  /** Pages an action applies to: the selection (in document order), else the current page. */
  targetPages(): PageRef[] {
    const pages = this.doc.pages;
    if (this.selection.size > 0) return pages.filter((p) => this.selection.has(p.id));
    const current = pages[this.currentIndex];
    return current ? [current] : [];
  }

  /** The page most of the view shows (between the floating controls). */
  mostVisibleIndex(): number {
    if (this.mode === 'single' || !this.scrollEl) return this.currentIndex;
    const top = this.scrollTop + this.insetTop;
    const bottom = this.scrollTop + this.viewHeight - this.insetBottom;
    let best = this.currentIndex;
    let most = 0;
    const { start, end } = this.visibleRange;
    for (let i = start; i <= end; i++) {
      const b = this.layout.boxes[i];
      const shown = Math.min(bottom, b.top + b.height) - Math.max(top, b.top);
      if (shown > most) [best, most] = [i, shown];
    }
    return best;
  }

  /** "The current page" for adding things: the page selected in the rail, else the one most in view. */
  activePageIndex(): number {
    const pages = this.doc.pages;
    const selected = pages.findIndex((p) => this.selection.has(p.id));
    return selected >= 0 ? selected : this.mostVisibleIndex();
  }

  /**
   * The part of page `index` that is on screen and not under the floating
   * controls, in points from the top-left of the page as shown. Null when none.
   */
  visiblePageArea(index: number): [number, number, number, number] | null {
    const el = this.scrollEl?.querySelector<HTMLElement>(`.page[data-index="${index}"]`);
    if (!this.scrollEl || !el) return null;
    const view = this.scrollEl.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const x1 = Math.max(view.left, box.left);
    const x2 = Math.min(view.left + this.scrollEl.clientWidth, box.right);
    const y1 = Math.max(view.top + this.insetTop, box.top);
    const y2 = Math.min(view.top + this.scrollEl.clientHeight - this.insetBottom, box.bottom);
    if (x2 - x1 < 1 || y2 - y1 < 1) return null;
    const s = this.scale;
    return [(x1 - box.left) / s, (y1 - box.top) / s, (x2 - box.left) / s, (y2 - box.top) / s];
  }

  /** Keep selection and current page valid after the page list changes. */
  syncAfterEdit() {
    const ids = new Set(this.doc.pages.map((p) => p.id));
    if ([...this.selection].some((id) => !ids.has(id))) {
      this.selection = new Set([...this.selection].filter((id) => ids.has(id)));
    }
    if (this.currentIndex > this.pageCount - 1) this.currentIndex = Math.max(0, this.pageCount - 1);
    // Selected objects that are gone (deleted, undone, their page removed) drop out.
    const sel = this.objectSelection;
    if (sel) {
      const units = new Set((this.doc.pages.find((p) => p.id === sel.pageId)?.annots ?? []).map(unitOf));
      const ids = sel.ids.filter((id) => units.has(id));
      if (ids.length !== sel.ids.length) this.objectSelection = ids.length ? { pageId: sel.pageId, ids } : null;
    }
  }

  // --- Feedback ---------------------------------------------------------

  // Guides (View menu): editor-only, in memory for this tab, for every page; never saved anywhere.
  /** Show the margin guides (they also pull objects when shown). */
  showMargins = $state(false);
  /** Snap objects to the page center and to each other while dragging. */
  smartGuides = $state(true);
  /** The margin, in millimetres (limited per page to a quarter of its smaller side). */
  marginMm = $state(25);
  /** The margins (only while shown) are a hard limit for objects moved, resized, added or typed into. */
  keepInMargins = $state(false);

  /** Show or hide the margins; hiding them also ends "Keep objects inside margins". */
  toggleMargins() {
    this.showMargins = !this.showMargins;
    if (!this.showMargins) this.keepInMargins = false;
  }

  /** The margin on a page, in points (the same on every side). */
  marginOn(page: PageRef) {
    const b = this.doc.pageBounds(page);
    return marginPoints(this.marginMm, b[2] - b[0], b[3] - b[1]);
  }

  /**
   * Where objects on a page may go (PDF space): the page, or the margin when
   * "Keep objects inside margins" is on (an edge of `box` already past the
   * margin is limited where it is). The page edge always holds.
   */
  limitFor(page: PageRef, box?: Rect | null) {
    const margin = this.showMargins && this.keepInMargins ? this.marginOn(page) : null;
    return limitRect(this.doc.pageBounds(page), margin, box);
  }

  /** Something stopped at a limit: the page edge, or the margin. */
  limitHit(pageId: string, kind: LimitKind) {
    if (kind === 'page') return this.edgeHit(pageId);
    this.flash('margin', pageId, 'Stopped at the margin');
  }

  /** The page whose margin an object just stopped at (its margin line flashes). */
  marginFlash = $state<string | null>(null);

  /** The page whose edge an object just stopped at (a brief outline). */
  edgeFlash = $state<string | null>(null);
  private edgeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEdgeNotice = 0;

  /**
   * Something stopped at the page edge: outline the page briefly (not with
   * reduced motion) and say so, at most once a second.
   */
  edgeHit(pageId: string) {
    this.flash('edge', pageId, 'Stopped at the page edge');
  }

  /** A brief outline (not with reduced motion) and a notice, at most once a second. */
  private flash(what: 'edge' | 'margin', pageId: string, notice: string) {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (what === 'edge') this.edgeFlash = pageId;
      else this.marginFlash = pageId;
      clearTimeout(this.edgeTimer);
      this.edgeTimer = setTimeout(() => (this.edgeFlash = this.marginFlash = null), 350);
    }
    const now = Date.now();
    if (now - this.lastEdgeNotice >= 1000) {
      this.lastEdgeNotice = now;
      this.announce(notice);
    }
  }

  /** Tell screen-reader users what just happened, without anything on screen. */
  announce(text: string) {
    // Cleared first, so the same words twice in a row are read again.
    this.announcement = '';
    queueMicrotask(() => (this.announcement = text));
  }

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Show a short message. Errors stay until dismissed. */
  notify(text: string, { error = false } = {}) {
    clearTimeout(this.noticeTimer);
    this.notice = { text, id: Date.now(), error };
    if (!error) this.noticeTimer = setTimeout(() => (this.notice = null), 6000);
  }

  /**
   * Run a slow job with a progress indicator; errors become a notice. With
   * `cancellable`, the job gets an AbortSignal and the notice a Cancel button.
   */
  async runTask<T>(
    label: string,
    job: (progress: (p: number) => void, signal: AbortSignal) => Promise<T>,
    { cancellable = false, delay = 0 } = {},
  ): Promise<T | undefined> {
    const controller = new AbortController();
    const task: Task = { label, progress: null, cancel: cancellable ? () => controller.abort() : undefined };
    // With a delay, quick jobs finish without flashing a progress message.
    const shown = delay ? setTimeout(() => (this.task = task), delay) : undefined;
    if (!delay) this.task = task;
    try {
      return await job((p) => {
        task.progress = p;
        if (this.task) this.task.progress = p;
      }, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) {
        this.notify('Cancelled.');
        return undefined;
      }
      this.notify(friendlyError(e), { error: true });
      return undefined;
    } finally {
      clearTimeout(shown);
      this.task = null;
    }
  }

  // --- Navigation -------------------------------------------------------

  /** Set while a programmatic scroll is in flight, so the page we jumped to stays current. */
  private lockedIndex: number | null = null;

  /**
   * Scroll so the page's row starts just below the top inset (clear of the
   * toolbar). With `offsetInPage`, scroll that much further down instead.
   */
  goToPage(index: number, offsetInPage = 0) {
    const i = clamp(index, 0, this.pageCount - 1);
    this.currentIndex = i;
    const box = this.layout.boxes[i];
    if (this.scrollEl && box) {
      this.lockedIndex = i;
      // With no offset, show the top of the page's row (two-page rows can mix heights).
      const rowTop = this.layout.rows[rowAtY(this.layout, box.top)]?.top ?? box.top;
      this.scrollEl.scrollTop = offsetInPage ? box.top - this.insetTop + offsetInPage : rowTop - this.insetTop;
      // Don't wait for the scroll event (browsers delay it in background tabs).
      this.scrollTop = this.scrollEl.scrollTop;
      // Scroll events fire before animation frame callbacks, so this clears the lock after them.
      requestAnimationFrame(() => (this.lockedIndex = null));
    }
  }

  nextPage() {
    this.goToPage(rowStartOf(this.mode, this.currentIndex) + pagesPerRow(this.mode));
  }

  previousPage() {
    this.goToPage(Math.max(0, rowStartOf(this.mode, this.currentIndex) - pagesPerRow(this.mode)));
  }

  get isFirstRow() {
    return rowStartOf(this.mode, this.currentIndex) === 0;
  }

  get isLastRow() {
    return rowStartOf(this.mode, this.currentIndex) + pagesPerRow(this.mode) >= this.pageCount;
  }

  async setMode(mode: ViewMode) {
    if (mode === this.mode) return;
    const index = this.currentIndex;
    this.mode = mode;
    await tick();
    this.refit();
    await tick();
    this.goToPage(index);
  }

  /** Called on scroll: the current page is the one crossing the upper third of the uncovered view. */
  updateCurrentFromScroll() {
    const el = this.scrollEl;
    if (!el) return;
    this.scrollTop = el.scrollTop;
    this.viewHeight = el.clientHeight;
    if (this.mode === 'single') return;
    if (this.lockedIndex !== null) {
      this.currentIndex = this.lockedIndex;
      return;
    }
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    // A third of the way down the area not covered by floating controls.
    const probe = atBottom ? el.scrollHeight - 1 : el.scrollTop + this.insetTop + (el.clientHeight - this.insetTop - this.insetBottom) / 3;
    this.currentIndex = this.indexAt(probe);
  }

  indexAt(y: number) {
    return this.mode === 'single' ? this.currentIndex : indexAtY(this.layout, y);
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
    // Don't wait for the scroll event (browsers delay it in background tabs).
    this.scrollTop = el.scrollTop;
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

  /**
   * Fitting keeps the content just below the toolbar in place (not the view's
   * center), so a page whose top is in view stays clear of the floating controls.
   */
  private fitAnchor() {
    return this.scrollEl ? { x: this.scrollEl.clientWidth / 2, y: this.insetTop } : undefined;
  }

  fitWidth() {
    return this.setZoom(this.fitWidthZoom(), 'width', this.fitAnchor());
  }

  async fitPage() {
    await this.setZoom(this.fitPageZoom(), 'page', this.fitAnchor());
    // Show the whole current page between the floating controls.
    this.goToPage(this.currentIndex);
  }

  /** Re-apply the active fit mode (after a resize or page size change). */
  refit() {
    if (this.fit === 'width') void this.setZoom(this.fitWidthZoom(), 'width', this.fitAnchor());
    else if (this.fit === 'page') void this.setZoom(this.fitPageZoom(), 'page', this.fitAnchor());
  }

  /** Rows of displayed page sizes in points, for fitting. */
  private rowSizes(): { width: number; height: number }[] {
    const pages = this.doc.pages;
    const sizeAt = (i: number) => this.doc.displaySize(pages[i]);
    if (this.mode === 'single') return pages[this.currentIndex] ? [sizeAt(this.currentIndex)] : [];
    const per = pagesPerRow(this.mode);
    const rows = [];
    for (let i = 0; i < pages.length; i += per) {
      const sizes = Array.from({ length: Math.min(per, pages.length - i) }, (_, k) => sizeAt(i + k));
      rows.push({ width: sizes.reduce((w, s) => w + s.width, 0), height: Math.max(...sizes.map((s) => s.height)) });
    }
    return rows;
  }

  private fitWidthZoom() {
    const el = this.scrollEl;
    const rows = this.rowSizes();
    if (!el || rows.length === 0) return 1;
    let widest = Math.max(...rows.map((r) => r.width));
    if (this.mode === 'two') {
      // Rows share a center line: room for the widest left page plus the widest right page.
      const pages = this.doc.pages;
      let left = 0;
      let right = 0;
      pages.forEach((p, i) => {
        const w = this.doc.displaySize(p).width;
        if (i % 2 === 0) left = Math.max(left, w);
        else right = Math.max(right, w);
      });
      widest = left + right;
    }
    const gaps = (pagesPerRow(this.mode) + 1) * PAGE_GAP;
    // Leave a pixel per page for rounding.
    return (el.clientWidth - gaps - pagesPerRow(this.mode)) / (widest * CSS_UNITS);
  }

  private fitPageZoom() {
    const el = this.scrollEl;
    const rows = this.rowSizes();
    if (!el || rows.length === 0) return 1;
    const row = this.mode === 'single' ? rows[0] : rows[Math.floor(this.currentIndex / pagesPerRow(this.mode))];
    const gaps = (pagesPerRow(this.mode) + 1) * PAGE_GAP;
    return Math.min((el.clientWidth - gaps) / (row.width * CSS_UNITS), (el.clientHeight - this.insetTop - this.insetBottom) / (row.height * CSS_UNITS));
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
