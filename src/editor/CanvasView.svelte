<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { FLOATING_INSETS, MAX_ZOOM, MIN_ZOOM, PAGE_GAP, useViewer } from '../lib/viewer.svelte';
  import BottomBar from './BottomBar.svelte';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import X from '@lucide/svelte/icons/x';
  import PageView from './PageView.svelte';

  let { mobile = false, toolbar }: { mobile?: boolean; toolbar?: Snippet } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;

  let scroller: HTMLDivElement;
  let pagesEl: HTMLDivElement;
  /** Width of the scroller's vertical scrollbar, so floating controls center over the pages. */
  let gutter = $state(0);
  /** Desktop and tablet: toolbar and bottom controls float over the pages. */
  const floating = $derived(!mobile);

  // Pad the content so pages start below the toolbar and end above the bottom controls.
  $effect.pre(() => {
    viewer.insetTop = floating ? FLOATING_INSETS.top : PAGE_GAP;
    viewer.insetBottom = floating ? FLOATING_INSETS.bottom : PAGE_GAP;
  });

  $effect(() => {
    viewer.scrollEl = scroller;
    untrack(() => {
      // This view may replace another (phone <-> desktop layout): start from its real
      // scroll position, then return to the page the user was on.
      const page = viewer.currentIndex;
      viewer.scrollTop = scroller.scrollTop;
      viewer.viewHeight = scroller.clientHeight;
      viewer.viewWidth = scroller.clientWidth;
      // Open at fit width, but not absurdly large on wide screens. The zoom
      // adjusts the scroll position when it finishes, so return to the page after.
      void (async () => {
        await viewer.fitWidth();
        if (viewer.zoom > 1.25) await viewer.setZoom(1.25, null);
        await tick();
        viewer.goToPage(page);
      })();
    });

    let lastWidth = scroller.clientWidth;
    gutter = scroller.offsetWidth - scroller.clientWidth;
    const ro = new ResizeObserver(() => {
      gutter = scroller.offsetWidth - scroller.clientWidth;
      viewer.viewHeight = scroller.clientHeight;
      viewer.viewWidth = scroller.clientWidth;
      if (scroller.clientWidth !== lastWidth) {
        lastWidth = scroller.clientWidth;
        viewer.refit();
      }
    });
    ro.observe(scroller);

    // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms around the pointer.
    let lastFlip = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Single-page mode: scrolling past the top or bottom edge turns the page.
        if (viewer.mode !== 'single' || Math.abs(e.deltaY) < 4 || e.timeStamp - lastFlip < 400) return;
        const atTop = scroller.scrollTop <= 0;
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
        if (e.deltaY > 0 && atBottom && !viewer.isLastRow) viewer.nextPage();
        else if (e.deltaY < 0 && atTop && !viewer.isFirstRow) {
          viewer.previousPage();
          // Land at the bottom of the previous page, as if scrolling continued.
          requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
        } else return;
        lastFlip = e.timeStamp;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      void viewer.setZoom(viewer.zoom * factor, null, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });

    // Two fingers: pinch to zoom and pan together, in any tool. The page is
    // transformed live, then re-rendered at the new zoom when the fingers lift.
    let pinch: { d0: number; zoom0: number; mx0: number; my0: number; f: number; dx: number; dy: number } | null = null;
    const local = (t: Touch) => {
      const r = scroller.getBoundingClientRect();
      return [t.clientX - r.left, t.clientY - r.top];
    };
    const geometry = (e: TouchEvent) => {
      const [a, b] = [local(e.touches[0]), local(e.touches[1])];
      return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const g = geometry(e);
      pinch = { d0: g.d || 1, zoom0: viewer.zoom, mx0: g.mx, my0: g.my, f: 1, dx: 0, dy: 0 };
      pagesEl.style.transformOrigin = `${scroller.scrollLeft + g.mx}px ${scroller.scrollTop + g.my}px`;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const g = geometry(e);
      pinch.f = Math.min(MAX_ZOOM / pinch.zoom0, Math.max(MIN_ZOOM / pinch.zoom0, g.d / pinch.d0));
      pinch.dx = g.mx - pinch.mx0;
      pinch.dy = g.my - pinch.my0;
      pagesEl.style.transform = `translate(${pinch.dx}px, ${pinch.dy}px) scale(${pinch.f})`;
    };
    const onTouchEnd = async (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const p = pinch;
      pinch = null;
      pagesEl.style.transform = '';
      pagesEl.style.transformOrigin = '';
      if (Math.abs(p.f - 1) > 0.01) await viewer.setZoom(p.zoom0 * p.f, null, { x: p.mx0, y: p.my0 });
      scroller.scrollLeft -= p.dx;
      scroller.scrollTop -= p.dy;
    };
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);

    return () => {
      ro.disconnect();
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      viewer.scrollEl = null;
    };
  });

  // Page sizes arrive in the background after opening; keep a fit mode honest.
  $effect(() => {
    void viewer.layout.contentWidth;
    untrack(() => viewer.refit());
  });

  // Page Up/Down and arrow keys turn pages when the whole page fits (single and two-page modes).
  function onKeyDown(e: KeyboardEvent) {
    if (viewer.mode === 'continuous' || e.altKey || e.ctrlKey || e.metaKey) return;
    const fits = scroller.scrollHeight <= scroller.clientHeight + 1;
    const atTop = scroller.scrollTop <= 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const next = e.key === 'ArrowRight' || ((e.key === 'PageDown' || e.key === 'ArrowDown') && (fits || atBottom));
    const prev = e.key === 'ArrowLeft' || ((e.key === 'PageUp' || e.key === 'ArrowUp') && (fits || atTop));
    if (next && !viewer.isLastRow) viewer.nextPage();
    else if (prev && !viewer.isFirstRow) viewer.previousPage();
    else return;
    e.preventDefault();
  }

  let announced = $state('');
  /** First announcement: what was opened. After that, the current page as it changes. */
  let opened = true;
  $effect(() => {
    const n = viewer.pageCount;
    const text = opened
      ? `${doc.name} opened, ${n} ${n === 1 ? 'page' : 'pages'}`
      : `Page ${viewer.currentIndex + 1} of ${n}`;
    const t = setTimeout(() => {
      announced = text;
      opened = false;
    }, 700);
    return () => clearTimeout(t);
  });

  const visible = $derived.by(() => {
    const { start, end } = viewer.visibleRange;
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  });
</script>

<div class="canvas-column" class:floating>
  <!-- Focusable so keyboard users can scroll the document (WCAG scrollable-region). -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
  <div
    class="scroller"
    bind:this={scroller}
    onscroll={() => viewer.updateCurrentFromScroll()}
    onkeydown={onKeyDown}
    onclick={(e) => {
      // Clicking the gray background (not a page) clears the page selection.
      // A pointer convenience only: Escape in the thumbnail rail does the same.
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pages')) viewer.clearSelection();
    }}
    id="document-view"
    tabindex="0"
    role="document"
    aria-label="Document"
    aria-describedby="page-announcer"
    style:scroll-padding-top="{viewer.insetTop}px"
    style:scroll-padding-bottom="{viewer.insetBottom}px"
  >
    <div
      class="pages"
      bind:this={pagesEl}
      style:height="{viewer.layout.totalHeight}px"
      style:min-width="{viewer.layout.contentWidth}px"
    >
      {#each visible as i (doc.pages[i].id)}
        {@const box = viewer.layout.boxes[i]}
        <PageView page={doc.pages[i]} index={i} top={box.top} left={box.left} width={box.width} height={box.height} />
      {/each}
    </div>
  </div>
  <div class="status" aria-live="polite">
    {#if viewer.task}
      <div class="toast" role="status">
        <span>{viewer.task.label}</span>
        <progress max="1" value={viewer.task.progress ?? undefined} aria-label={viewer.task.label}></progress>
        {#if viewer.task.cancel}
          <button type="button" class="btn task-cancel" onclick={() => viewer.task?.cancel?.()}>Cancel</button>
        {/if}
      </div>
    {:else if viewer.notice}
      {#key viewer.notice.id}
        <div class="toast" class:error={viewer.notice.error} role={viewer.notice.error ? 'alert' : 'status'}>
          {#if viewer.notice.error}
            <CircleAlert class="toast-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
          {:else}
            <CircleCheck class="toast-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
          {/if}
          <span>{viewer.notice.text}</span>
          <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (viewer.notice = null)}>
            <X size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      {/key}
    {/if}
  </div>
  <!-- Announces the page once scrolling settles, not on every scroll step. -->
  <div class="visually-hidden" id="page-announcer" aria-live="polite">{announced}</div>
  {#if mobile}
    <div class="page-pill" aria-hidden="true">{viewer.currentIndex + 1} / {viewer.pageCount}</div>
  {:else}
    <!-- Over the pages, after them in the DOM so they stack on top. The wrappers let
         clicks, scrolling and text selection through; only the pills take pointer input. -->
    {#if toolbar}<div class="float top" style:right="{gutter}px">{@render toolbar()}</div>{/if}
    <div class="float bottom" style:right="{gutter}px"><BottomBar /></div>
  {/if}
</div>

<style>
  .canvas-column {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    background: var(--canvas);
    min-width: 0;
    min-height: 0;
  }
  /* Floating controls: centered over the scroll area, above the pages. */
  .float {
    position: absolute;
    left: 0;
    z-index: 20;
    display: flex;
    justify-content: center;
    padding: 0 var(--space-4);
    pointer-events: none;
  }
  .float.top {
    top: 16px;
  }
  .float.bottom {
    bottom: 16px;
  }
  .status {
    position: absolute;
    left: 50%;
    bottom: 56px;
    z-index: 30;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100% - 2 * var(--space-4));
    pointer-events: none;
  }
  /* Messages: a white card. Errors: red icon on a soft red strip. */
  /* Above the floating bottom controls. */
  .floating .status {
    bottom: 76px;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: 520px;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-size-sm);
    box-shadow: var(--shadow-overlay);
    pointer-events: auto;
  }
  .toast :global(.toast-icon) {
    flex-shrink: 0;
    color: var(--accent);
  }
  .toast.error {
    border-left: 4px solid var(--danger);
    background: var(--danger-soft);
  }
  .toast.error :global(.toast-icon) {
    color: var(--danger);
  }
  .task-cancel {
    min-height: 30px;
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
  }
  .toast progress {
    width: 120px;
    accent-color: var(--accent);
  }
  .dismiss {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
  }
  .dismiss:hover {
    background: var(--surface-2);
  }
  .scroller {
    position: relative;
    overflow: auto;
    /* One finger scrolls natively; two-finger pinch is handled above. */
    touch-action: pan-x pan-y;
    background: var(--canvas);
    scrollbar-gutter: stable;
    outline: none;
    /* Page layers' z-indexes stay inside the scroller, under the floating controls. */
    isolation: isolate;
  }
  .scroller:focus-visible {
    outline: var(--focus-ring);
    outline-offset: -3px;
  }
  .pages {
    position: relative;
    will-change: auto;
  }
  .page-pill {
    position: absolute;
    left: var(--space-3);
    bottom: var(--space-3);
    z-index: 10;
    padding: var(--space-1) var(--space-3);
    border-radius: 999px;
    background: var(--text);
    color: var(--on-accent);
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
