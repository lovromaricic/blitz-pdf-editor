<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { MAX_ZOOM, MIN_ZOOM, useViewer } from '../lib/viewer.svelte';
  import BottomBar from './BottomBar.svelte';
  import PageView from './PageView.svelte';

  let { mobile = false }: { mobile?: boolean } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;

  let scroller: HTMLDivElement;
  let pagesEl: HTMLDivElement;

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
    const ro = new ResizeObserver(() => {
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
  $effect(() => {
    const text = `Page ${viewer.currentIndex + 1} of ${viewer.pageCount}`;
    const t = setTimeout(() => (announced = text), 700);
    return () => clearTimeout(t);
  });

  const visible = $derived.by(() => {
    const { start, end } = viewer.visibleRange;
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  });
</script>

<div class="canvas-column">
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
      </div>
    {:else if viewer.notice}
      {#key viewer.notice.id}
        <div class="toast" class:error={viewer.notice.error} role={viewer.notice.error ? 'alert' : 'status'}>
          <span>{viewer.notice.text}</span>
          <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (viewer.notice = null)}>×</button>
        </div>
      {/key}
    {/if}
  </div>
  <!-- Announces the page once scrolling settles, not on every scroll step. -->
  <div class="visually-hidden" id="page-announcer" aria-live="polite">{announced}</div>
  {#if mobile}
    <div class="page-pill" aria-hidden="true">{viewer.currentIndex + 1} / {viewer.pageCount}</div>
  {:else}
    <BottomBar />
  {/if}
</div>

<style>
  .canvas-column {
    position: relative;
    display: grid;
    grid-template-rows: 1fr auto;
    min-width: 0;
    min-height: 0;
  }
  .status {
    position: absolute;
    left: 50%;
    bottom: 56px;
    z-index: 10;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100% - 2 * var(--space-4));
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    font-size: var(--font-size-sm);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
    pointer-events: auto;
  }
  .toast.error {
    max-width: 480px;
    border: 2px solid var(--color-error-bg);
  }
  .toast progress {
    width: 120px;
  }
  .dismiss {
    border: 0;
    background: none;
    color: inherit;
    font-size: var(--font-size-lg);
    line-height: 1;
  }
  .scroller {
    position: relative;
    overflow: auto;
    /* One finger scrolls natively; two-finger pinch is handled above. */
    touch-action: pan-x pan-y;
    background: var(--color-canvas-bg);
    scrollbar-gutter: stable;
    outline: none;
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
    background: rgb(0 0 0 / 0.65);
    color: #fff;
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
