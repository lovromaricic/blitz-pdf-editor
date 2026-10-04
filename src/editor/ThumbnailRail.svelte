<script lang="ts">
  import { useViewer } from '../lib/viewer.svelte';
  import Thumbnail from './Thumbnail.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  const MAX_W = 120;
  const MAX_H = 150;
  /** Padding (8) + label (16) + gap (2) + spacing between items (10). */
  const CHROME = 36;
  const TOP_PAD = 8;

  let scroller: HTMLDivElement;
  let scrollTop = $state(0);
  let viewHeight = $state(600);

  const layout = $derived.by(() => {
    let top = TOP_PAD;
    const items = doc.pages.map((page) => {
      const size = doc.displaySize(page);
      const scale = Math.min(MAX_W / size.width, MAX_H / size.height);
      const width = Math.round(size.width * scale);
      const height = Math.round(size.height * scale);
      const item = { top, width, height, scale, itemHeight: height + CHROME };
      top += item.itemHeight;
      return item;
    });
    return { items, total: top + TOP_PAD };
  });

  function indexAt(y: number) {
    const items = layout.items;
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (items[mid].top <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  const visible = $derived.by(() => {
    if (layout.items.length === 0) return [];
    const start = indexAt(scrollTop - viewHeight / 2);
    const end = indexAt(scrollTop + viewHeight * 1.5);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  });

  // Keep the current page's thumbnail in view.
  $effect(() => {
    const item = layout.items[viewer.currentIndex];
    if (!item || !scroller) return;
    const top = scroller.scrollTop;
    if (item.top < top) scroller.scrollTop = item.top - TOP_PAD;
    else if (item.top + item.itemHeight > top + scroller.clientHeight)
      scroller.scrollTop = item.top + item.itemHeight - scroller.clientHeight + TOP_PAD;
  });

  $effect(() => {
    viewHeight = scroller.clientHeight;
    const ro = new ResizeObserver(() => (viewHeight = scroller.clientHeight));
    ro.observe(scroller);
    return () => ro.disconnect();
  });
</script>

<nav class="rail" aria-label="Page thumbnails">
  <div class="scroller" bind:this={scroller} onscroll={() => (scrollTop = scroller.scrollTop)}>
    <ol class="list" style:height="{layout.total}px">
      {#each visible as i (doc.pages[i].id)}
        {@const item = layout.items[i]}
        <li style:top="{item.top}px">
          <Thumbnail
            page={doc.pages[i]}
            index={i}
            scale={item.scale}
            width={item.width}
            height={item.height}
            current={viewer.currentIndex === i}
            onSelect={() => viewer.goToPage(i)}
          />
        </li>
      {/each}
    </ol>
  </div>
  <div class="footer">
    <button type="button" class="btn add" disabled title="Available in a later phase">+ Add pages</button>
  </div>
</nav>

<style>
  .rail {
    display: grid;
    grid-template-rows: 1fr auto;
    min-height: 0;
    border-right: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .scroller {
    overflow-y: auto;
    overflow-x: hidden;
  }
  .list {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
  }
  .footer {
    padding: var(--space-2);
    border-top: var(--border-width) solid var(--color-border);
  }
  .add {
    width: 100%;
    font-size: var(--font-size-sm);
  }
  .add:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
