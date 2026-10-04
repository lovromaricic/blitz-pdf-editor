<script lang="ts">
  import { tick } from 'svelte';
  import type { Actions } from '../lib/actions.svelte';
  import type { CommandId, CommandRegistry } from '../lib/commands';
  import { useViewer } from '../lib/viewer.svelte';
  import ContextMenu, { type ContextItem } from '../components/ContextMenu.svelte';
  import Thumbnail from './Thumbnail.svelte';

  let { commands, actions }: { commands: CommandRegistry; actions: Actions } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;

  const MAX_W = 120;
  const MAX_H = 150;
  /** Padding (8) + label (16) + gap (2) + spacing between items (10). */
  const CHROME = 36;
  const TOP_PAD = 8;
  const DRAG_THRESHOLD = 6;
  const EDGE = 48;

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

  function scrollIntoView(i: number) {
    const item = layout.items[i];
    if (!item || !scroller) return;
    const top = scroller.scrollTop;
    if (item.top < top) scroller.scrollTop = item.top - TOP_PAD;
    else if (item.top + item.itemHeight > top + scroller.clientHeight)
      scroller.scrollTop = item.top + item.itemHeight - scroller.clientHeight + TOP_PAD;
  }

  // Keep the current page's thumbnail in view.
  $effect(() => {
    scrollIntoView(viewer.currentIndex);
  });

  $effect(() => {
    viewHeight = scroller.clientHeight;
    const ro = new ResizeObserver(() => (viewHeight = scroller.clientHeight));
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  async function focusThumb(i: number) {
    scrollIntoView(i);
    scrollTop = scroller.scrollTop;
    await tick();
    scroller.querySelector<HTMLElement>(`[data-thumb-index="${i}"]`)?.focus();
  }

  // --- Click selection ----------------------------------------------------

  let suppressClick = false;

  function onClick(e: MouseEvent, i: number) {
    if (suppressClick) return;
    const id = doc.pages[i].id;
    const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single';
    viewer.select(id, mode);
    if (mode !== 'toggle') viewer.goToPage(i);
  }

  // --- Drag to reorder ----------------------------------------------------

  let drag = $state<{
    draggedId: string;
    startX: number;
    startY: number;
    lastY: number;
    active: boolean;
    ids: ReadonlySet<string>;
    dropIndex: number;
  } | null>(null);
  let autoScrollFrame = 0;

  function onPointerDown(e: PointerEvent, i: number) {
    // Mouse and pen only; touch drag (press and hold) arrives with the mobile layout.
    if (e.button !== 0 || e.pointerType === 'touch') return;
    drag = {
      draggedId: doc.pages[i].id,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      active: false,
      ids: new Set(),
      dropIndex: i,
    };
  }

  function updateDropIndex(clientY: number) {
    if (!drag) return;
    const rect = scroller.getBoundingClientRect();
    const y = clientY - rect.top + scroller.scrollTop;
    const i = indexAt(y);
    const item = layout.items[i];
    drag.dropIndex = item && y > item.top + item.itemHeight / 2 ? i + 1 : i;
  }

  function autoScroll() {
    if (!drag?.active) return;
    const rect = scroller.getBoundingClientRect();
    const y = drag.lastY;
    let delta = 0;
    if (y < rect.top + EDGE) delta = -Math.ceil((rect.top + EDGE - y) / 4);
    else if (y > rect.bottom - EDGE) delta = Math.ceil((y - (rect.bottom - EDGE)) / 4);
    if (delta) {
      scroller.scrollTop += delta;
      scrollTop = scroller.scrollTop;
      updateDropIndex(y);
    }
    autoScrollFrame = requestAnimationFrame(autoScroll);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    drag.lastY = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.active = true;
      drag.ids = viewer.selection.has(drag.draggedId) ? viewer.selection : new Set([drag.draggedId]);
      autoScrollFrame = requestAnimationFrame(autoScroll);
    }
    updateDropIndex(e.clientY);
  }

  function endDrag(commit: boolean) {
    cancelAnimationFrame(autoScrollFrame);
    if (drag?.active) {
      if (commit) {
        const ids = drag.ids;
        actions.move(doc.pages.filter((p) => ids.has(p.id)), drag.dropIndex);
      }
      // The click that follows a drag must not change the selection.
      suppressClick = true;
      setTimeout(() => (suppressClick = false));
    }
    drag = null;
  }

  const indicatorTop = $derived.by(() => {
    if (!drag?.active) return null;
    const i = drag.dropIndex;
    return i < layout.items.length ? layout.items[i].top - 5 : layout.total - TOP_PAD - 5;
  });

  // --- Keyboard -----------------------------------------------------------

  async function moveBy(i: number, delta: -1 | 1) {
    const page = doc.pages[i];
    if (!viewer.selection.has(page.id)) viewer.select(page.id);
    const targets = viewer.targetPages();
    const first = doc.pages.indexOf(targets[0]);
    const last = doc.pages.indexOf(targets[targets.length - 1]);
    if (delta < 0 && first === 0) return;
    if (delta > 0 && last === doc.pages.length - 1) return;
    actions.move(targets, delta < 0 ? first - 1 : last + 2);
    await focusThumb(doc.pages.indexOf(page));
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    const n = doc.pages.length;
    const go = (j: number) => {
      j = Math.max(0, Math.min(n - 1, j));
      viewer.select(doc.pages[j].id, e.shiftKey ? 'range' : 'single');
      viewer.goToPage(j);
      void focusThumb(j);
    };
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        if (e.altKey) void moveBy(i, delta);
        else go(i + delta);
        break;
      }
      case 'Home':
        go(0);
        break;
      case 'End':
        go(n - 1);
        break;
      case 'Delete':
      case 'Backspace':
        if (!viewer.selection.has(doc.pages[i].id)) viewer.select(doc.pages[i].id);
        commands.run('page.delete');
        void tick().then(() => focusThumb(viewer.currentIndex));
        break;
      case 'Escape':
        if (drag) endDrag(false);
        else viewer.clearSelection();
        break;
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        openMenuAt(i, (e.currentTarget as HTMLElement).getBoundingClientRect());
        break;
      case 'a':
        if (!(e.metaKey || e.ctrlKey)) return;
        viewer.selectAll();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // --- Context menu (same commands as the Page menu) ------------------------

  let menu = $state<{ x: number; y: number; index: number } | null>(null);

  function openMenuAt(i: number, rect: DOMRect) {
    if (!viewer.selection.has(doc.pages[i].id)) viewer.select(doc.pages[i].id);
    menu = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, index: i };
  }

  function onContextMenu(e: MouseEvent, i: number) {
    e.preventDefault();
    if (!viewer.selection.has(doc.pages[i].id)) viewer.select(doc.pages[i].id);
    menu = { x: e.clientX, y: e.clientY, index: i };
  }

  const menuItems = $derived.by((): ContextItem[] => {
    if (!menu) return [];
    const n = viewer.selection.size || 1;
    const item = (id: CommandId, label: string): ContextItem => ({
      label,
      run: () => commands.run(id),
      disabled: !commands.isEnabled(id),
    });
    return [
      item('page.rotateLeft', 'Rotate left'),
      item('page.rotateRight', 'Rotate right'),
      '-',
      item('page.delete', n > 1 ? `Delete ${n} pages` : 'Delete page'),
      item('page.extract', n > 1 ? `Extract ${n} pages…` : 'Extract page…'),
      '-',
      item('page.insertBlank', 'Insert blank page after'),
    ];
  });

  function closeMenu(restoreFocus: boolean) {
    const i = menu?.index;
    menu = null;
    if (restoreFocus && i !== undefined) void focusThumb(Math.min(i, doc.pages.length - 1));
  }
</script>

<svelte:window
  onpointermove={onPointerMove}
  onpointerup={() => endDrag(true)}
  onpointercancel={() => endDrag(false)}
  onkeydown={(e) => drag?.active && e.key === 'Escape' && endDrag(false)}
/>

<nav class="rail" aria-label="Page thumbnails">
  <div
    class="scroller"
    class:dragging={drag?.active}
    bind:this={scroller}
    onscroll={() => (scrollTop = scroller.scrollTop)}
  >
    <ol class="list" style:height="{layout.total}px" aria-label="Pages. Alt+Up or Alt+Down moves the selected pages.">
      {#each visible as i (doc.pages[i].id)}
        {@const item = layout.items[i]}
        {@const page = doc.pages[i]}
        <li style:top="{item.top}px">
          <Thumbnail
            {page}
            index={i}
            scale={item.scale}
            width={item.width}
            height={item.height}
            current={viewer.currentIndex === i}
            selected={viewer.selection.has(page.id)}
            dimmed={!!drag?.active && drag.ids.has(page.id)}
            tabindex={viewer.currentIndex === i ? 0 : -1}
            onclick={(e) => onClick(e, i)}
            onpointerdown={(e) => onPointerDown(e, i)}
            onkeydown={(e) => onKeyDown(e, i)}
            oncontextmenu={(e) => onContextMenu(e, i)}
          />
        </li>
      {/each}
      {#if indicatorTop !== null}
        <li class="drop-indicator" style:top="{indicatorTop}px" aria-hidden="true"></li>
      {/if}
    </ol>
  </div>
  <div class="footer">
    <button type="button" class="btn add" onclick={() => commands.run('page.insertFromFile')}>+ Add pages</button>
  </div>
</nav>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} label="Page actions" items={menuItems} onClose={closeMenu} />
{/if}

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
  .scroller.dragging {
    cursor: grabbing;
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
  .drop-indicator {
    height: 3px;
    border-radius: 2px;
    background: var(--color-accent);
    pointer-events: none;
  }
  .footer {
    padding: var(--space-2);
    border-top: var(--border-width) solid var(--color-border);
  }
  .add {
    width: 100%;
    font-size: var(--font-size-sm);
  }
</style>
