<script lang="ts">
  import { untrack } from 'svelte';
  import { PAGE_GAP, useViewer } from '../lib/viewer.svelte';
  import BottomBar from './BottomBar.svelte';
  import PageView from './PageView.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  let scroller: HTMLDivElement;

  $effect(() => {
    viewer.scrollEl = scroller;
    untrack(() => {
      viewer.viewHeight = scroller.clientHeight;
      // Open at fit width, but not absurdly large on wide screens.
      viewer.fitWidth();
      if (viewer.zoom > 1.25) void viewer.setZoom(1.25, null);
    });

    let lastWidth = scroller.clientWidth;
    const ro = new ResizeObserver(() => {
      viewer.viewHeight = scroller.clientHeight;
      if (scroller.clientWidth !== lastWidth) {
        lastWidth = scroller.clientWidth;
        viewer.refit();
      }
    });
    ro.observe(scroller);

    // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms around the pointer.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      void viewer.setZoom(viewer.zoom * factor, null, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      ro.disconnect();
      scroller.removeEventListener('wheel', onWheel);
      viewer.scrollEl = null;
    };
  });

  // Page sizes arrive in the background after opening; keep a fit mode honest.
  $effect(() => {
    void viewer.layout.maxWidth;
    untrack(() => viewer.refit());
  });

  const visible = $derived.by(() => {
    const { start, end } = viewer.visibleRange;
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  });
</script>

<div class="canvas-column">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    class="scroller"
    bind:this={scroller}
    onscroll={() => viewer.updateCurrentFromScroll()}
    onclick={(e) => {
      // Clicking the gray background (not a page) clears the page selection.
      // A pointer convenience only: Escape in the thumbnail rail does the same.
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pages')) viewer.clearSelection();
    }}
    tabindex="-1"
    role="document"
    aria-label="Document"
  >
    <div
      class="pages"
      style:height="{viewer.layout.totalHeight}px"
      style:min-width="{viewer.layout.maxWidth + 2 * PAGE_GAP}px"
    >
      {#each visible as i (doc.pages[i].id)}
        {@const box = viewer.layout.boxes[i]}
        <PageView page={doc.pages[i]} index={i} top={box.top} width={box.width} height={box.height} />
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
        <div class="toast" role="status">
          <span>{viewer.notice.text}</span>
          <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (viewer.notice = null)}>×</button>
        </div>
      {/key}
    {/if}
  </div>
  <BottomBar />
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
    background: var(--color-canvas-bg);
    scrollbar-gutter: stable;
    outline: none;
  }
  .pages {
    position: relative;
  }
</style>
