<script lang="ts">
  // Phone version of the thumbnail rail: a grid in a bottom sheet.
  // Tap: go to the page (or toggle it in Select mode). Press and hold, then drag: reorder.
  import { tick } from 'svelte';
  import type { Actions } from '../../lib/actions.svelte';
  import type { CommandId, CommandRegistry } from '../../lib/commands';
  import { useViewer } from '../../lib/viewer.svelte';
  import Thumbnail from '../Thumbnail.svelte';

  let { open, commands, actions, onClose }: { open: boolean; commands: CommandRegistry; actions: Actions; onClose: () => void } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;

  let dialog: HTMLDialogElement;
  let grid = $state<HTMLOListElement | null>(null);
  let selectMode = $state(false);
  let cellWidth = $state(100);
  /** Cells near the view get a rendered thumbnail. */
  let visible = $state<ReadonlySet<string>>(new Set());

  const HOLD_MS = 450;
  const MOVE_SLOP = 8;

  $effect(() => {
    if (open && !dialog.open) {
      dialog.showModal();
      void tick().then(() => grid?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'center' }));
    } else if (!open && dialog.open) {
      dialog.close();
      selectMode = false;
    }
  });

  $effect(() => {
    void doc.pages; // re-observe when pages are added, removed or moved
    if (!grid) return;
    const measure = () => (cellWidth = Math.max(80, (grid!.clientWidth - 2 * 12) / 3));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    const io = new IntersectionObserver(
      (entries) => {
        const next = new Set(visible);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.pageId!;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        visible = next;
      },
      { root: grid.parentElement, rootMargin: '300px 0px' },
    );
    for (const cell of grid.querySelectorAll('[data-page-id]')) io.observe(cell);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  });

  function sizeFor(i: number) {
    const s = doc.displaySize(doc.pages[i]);
    const maxH = cellWidth * 1.35;
    const scale = Math.min(cellWidth / s.width, maxH / s.height);
    return { scale, width: Math.round(s.width * scale), height: Math.round(s.height * scale) };
  }

  function tap(i: number) {
    if (suppressTap) return;
    const id = doc.pages[i].id;
    if (selectMode) {
      viewer.select(id, 'toggle');
    } else {
      viewer.goToPage(i);
      onClose();
    }
  }

  // --- Press and hold, then drag ------------------------------------------------

  let hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number; index: number } | null = null;
  let drag = $state<{ id: string; ids: ReadonlySet<string>; x: number; y: number; dx: number; dy: number; target: number } | null>(null);
  let suppressTap = false;
  let scrollFrame = 0;

  function onTouchStart(e: TouchEvent, i: number) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    hold = {
      x: t.clientX,
      y: t.clientY,
      index: i,
      timer: setTimeout(() => startDrag(i, t.clientX, t.clientY), HOLD_MS),
    };
  }

  function startDrag(i: number, x: number, y: number) {
    hold = null;
    const id = doc.pages[i].id;
    navigator.vibrate?.(10);
    const ids = viewer.selection.has(id) ? viewer.selection : new Set([id]);
    drag = { id, ids, x, y, dx: 0, dy: 0, target: i };
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (hold && Math.hypot(t.clientX - hold.x, t.clientY - hold.y) > MOVE_SLOP) {
      // Moving before the hold completes is a scroll.
      clearTimeout(hold.timer);
      hold = null;
    }
    if (!drag) return;
    e.preventDefault(); // dragging, not scrolling
    drag.dx = t.clientX - drag.x;
    drag.dy = t.clientY - drag.y;
    lastY = t.clientY;
    drag.target = dropIndexAt(t.clientX, t.clientY);
  }

  function onTouchEnd() {
    if (hold) {
      clearTimeout(hold.timer);
      hold = null;
    }
    if (!drag) return;
    cancelAnimationFrame(scrollFrame);
    const { ids, target } = drag;
    drag = null;
    actions.move(doc.pages.filter((p) => ids.has(p.id)), target);
    // The touch ends with a click on the cell; don't treat it as a tap.
    suppressTap = true;
    setTimeout(() => (suppressTap = false), 350);
  }

  let lastY = 0;
  function autoScroll() {
    const scroller = grid?.parentElement;
    if (drag && scroller) {
      const r = scroller.getBoundingClientRect();
      if (lastY < r.top + 60) scroller.scrollTop -= 8;
      else if (lastY > r.bottom - 60) scroller.scrollTop += 8;
      scrollFrame = requestAnimationFrame(autoScroll);
    }
  }

  /** Index to insert before, from the cell under the finger. */
  function dropIndexAt(x: number, y: number) {
    const cells = Array.from(grid!.querySelectorAll<HTMLElement>('[data-index]'));
    let best = doc.pages.length;
    let bestDist = Infinity;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) {
        bestDist = d;
        const i = Number(cell.dataset.index);
        best = x > cx ? i + 1 : i;
      }
    }
    return best;
  }

  // Touch listeners must be non-passive so a drag can stop the sheet from scrolling.
  $effect(() => {
    if (!grid) return;
    const move = (e: TouchEvent) => onTouchMove(e);
    grid.addEventListener('touchmove', move, { passive: false });
    return () => grid?.removeEventListener('touchmove', move);
  });

  const n = $derived(viewer.selection.size);
  const action = (id: CommandId) => () => commands.run(id);
</script>

<dialog bind:this={dialog} class="pages-sheet" aria-labelledby="pages-title" oncancel={(e) => { e.preventDefault(); onClose(); }}>
  <header>
    <h2 id="pages-title">Pages ({doc.pages.length})</h2>
    <button type="button" class="done" onclick={onClose}>Done</button>
  </header>

  <div class="scroller">
    <ol class="grid" bind:this={grid} aria-label="Pages. Press and hold a page, then drag, to move it.">
      {#each doc.pages as page, i (page.id)}
        {@const size = sizeFor(i)}
        {@const dragging = drag?.ids.has(page.id)}
        <li
          class="cell"
          class:dragging
          class:drop-before={drag && drag.target === i}
          class:drop-after={drag && i === doc.pages.length - 1 && drag.target === doc.pages.length}
          data-index={i}
          data-page-id={page.id}
          style:transform={drag?.id === page.id ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.05)` : undefined}
          ontouchstart={(e) => onTouchStart(e, i)}
          ontouchend={onTouchEnd}
          ontouchcancel={onTouchEnd}
          oncontextmenu={(e) => e.preventDefault()}
        >
          {#if visible.has(page.id)}
            <Thumbnail
              {page}
              index={i}
              scale={size.scale}
              width={size.width}
              height={size.height}
              current={viewer.currentIndex === i}
              selected={viewer.selection.has(page.id)}
              onclick={() => tap(i)}
            />
          {:else}
            <button type="button" class="placeholder" style:height="{size.height + 22}px" aria-label="Page {i + 1}" onclick={() => tap(i)}></button>
          {/if}
        </li>
      {/each}
    </ol>
  </div>

  <div class="actions" role="toolbar" aria-label="Page actions">
    <button type="button" class="act" class:on={selectMode} aria-pressed={selectMode} onclick={() => { selectMode = !selectMode; if (!selectMode) viewer.clearSelection(); }}>
      {selectMode ? (n ? `${n} selected` : 'Tap pages') : 'Select'}
    </button>
    <button type="button" class="act" onclick={action('page.rotateRight')}>Rotate</button>
    <button type="button" class="act danger" disabled={!commands.isEnabled('page.delete')} onclick={action('page.delete')}>Delete</button>
    <button type="button" class="act" onclick={() => { onClose(); commands.run('page.extract'); }}>Extract</button>
    <button type="button" class="act" onclick={action('page.insertBlank')}>Add blank</button>
    <button type="button" class="act" onclick={action('page.insertFromFile')}>Add file</button>
  </div>
</dialog>

<style>
  .pages-sheet {
    width: 100vw;
    max-width: 100vw;
    height: 82dvh;
    max-height: 82dvh;
    margin: auto 0 0;
    padding: 0;
    border: 0;
    border-top: 2px solid var(--text);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    color: var(--text);
  }
  .pages-sheet[open] {
    display: flex;
    flex-direction: column;
  }
  .pages-sheet::backdrop {
    background: var(--backdrop);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-bottom: var(--border-width) solid var(--border);
  }
  h2 {
    font-size: var(--font-size-base);
    font-weight: 700;
  }
  /* "Done" is a text button. */
  .done {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 700;
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-3);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cell {
    position: relative;
    display: grid;
    justify-items: center;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .cell.dragging {
    z-index: 2;
    opacity: 0.85;
  }
  .cell.drop-before::before,
  .cell.drop-after::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 4px;
    border-radius: var(--radius-pill);
    background: var(--accent);
  }
  .cell.drop-before::before {
    left: -8px;
  }
  .cell.drop-after::after {
    right: -8px;
  }
  .cell :global(.thumb) {
    min-height: var(--touch-target);
  }
  .placeholder {
    width: 100%;
    border: 0;
    border-radius: var(--radius-page);
    background: var(--surface-2);
  }
  .actions {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    padding: var(--space-2);
    padding-bottom: max(var(--space-2), env(safe-area-inset-bottom));
    border-top: var(--border-width) solid var(--border);
    scrollbar-width: none;
  }
  .act {
    flex-shrink: 0;
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  .act.on {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-strong);
  }
  .act.danger {
    color: var(--danger);
  }
  .act:disabled {
    opacity: 0.45;
  }
</style>
