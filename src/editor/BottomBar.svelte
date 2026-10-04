<script lang="ts">
  import { MAX_ZOOM, MIN_ZOOM, useViewer } from '../lib/viewer.svelte';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import { ICON } from './tools';

  const viewer = useViewer();

  let pageInput = $state('');
  let editing = $state(false);
  const shown = $derived(editing ? pageInput : String(viewer.currentIndex + 1));

  function commit() {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) viewer.goToPage(n - 1);
    editing = false;
  }
</script>

<div class="bottombar" role="toolbar" aria-label="Page navigation and zoom">
  <div class="cluster">
    <button type="button" class="icon-btn" aria-label="Previous page" disabled={viewer.isFirstRow} onclick={() => viewer.previousPage()}>
      <ChevronLeft size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
    </button>
    <label class="page-field">
      <span class="visually-hidden">Current page</span>
      <input
        id="page-number-input"
        type="text"
        inputmode="numeric"
        value={shown}
        size={Math.max(2, String(viewer.pageCount).length)}
        onfocus={(e) => {
          editing = true;
          pageInput = String(viewer.currentIndex + 1);
          e.currentTarget.select();
        }}
        oninput={(e) => (pageInput = e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            editing = false;
            e.currentTarget.blur();
          }
        }}
        onblur={() => editing && commit()}
      />
      <span class="of">/ {viewer.pageCount}</span>
    </label>
    <button type="button" class="icon-btn" aria-label="Next page" disabled={viewer.isLastRow} onclick={() => viewer.nextPage()}>
      <ChevronRight size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
    </button>
  </div>

  <div class="cluster">
    <button type="button" class="icon-btn" aria-label="Zoom out" disabled={viewer.zoom <= MIN_ZOOM} onclick={() => viewer.zoomOut()}>
      <Minus size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
    </button>
    <output class="zoom" aria-label="Zoom level">{Math.round(viewer.zoom * 100)}%</output>
    <button type="button" class="icon-btn" aria-label="Zoom in" disabled={viewer.zoom >= MAX_ZOOM} onclick={() => viewer.zoomIn()}>
      <Plus size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
    </button>
    <button type="button" class="btn btn-soft fit" class:active={viewer.fit === 'width'} aria-pressed={viewer.fit === 'width'} onclick={() => viewer.fitWidth()}>Fit width</button>
  </div>
</div>

<style>
  .bottombar {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    gap: var(--space-6);
    height: var(--bottombar-height);
    padding: 0 var(--space-3);
    border-top: var(--border-width) solid var(--border);
    background: var(--surface);
    font-size: var(--font-size-sm);
  }
  .cluster {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    transition: background var(--transition-fast);
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .icon-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .fit {
    min-height: 36px;
    margin-left: var(--space-2);
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
  }
  .fit.active {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-strong);
  }
  .page-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
  }
  .page-field input {
    height: 32px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    text-align: center;
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  .of {
    color: var(--muted);
    white-space: nowrap;
  }
  .zoom {
    min-width: 3.25rem;
    text-align: center;
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
  }
</style>
