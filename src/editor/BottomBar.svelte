<script lang="ts">
  import { MAX_ZOOM, MIN_ZOOM, useViewer } from '../lib/viewer.svelte';

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
    <button type="button" class="icon-btn" aria-label="Previous page" disabled={viewer.currentIndex <= 0} onclick={() => viewer.previousPage()}>‹</button>
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
    <button type="button" class="icon-btn" aria-label="Next page" disabled={viewer.currentIndex >= viewer.pageCount - 1} onclick={() => viewer.nextPage()}>›</button>
  </div>

  <div class="cluster">
    <button type="button" class="icon-btn" aria-label="Zoom out" disabled={viewer.zoom <= MIN_ZOOM} onclick={() => viewer.zoomOut()}>−</button>
    <output class="zoom" aria-label="Zoom level">{Math.round(viewer.zoom * 100)}%</output>
    <button type="button" class="icon-btn" aria-label="Zoom in" disabled={viewer.zoom >= MAX_ZOOM} onclick={() => viewer.zoomIn()}>+</button>
    <button type="button" class="text-btn" class:active={viewer.fit === 'width'} aria-pressed={viewer.fit === 'width'} onclick={() => viewer.fitWidth()}>Fit width</button>
  </div>
</div>

<style>
  .bottombar {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-1) var(--space-3);
    border-top: var(--border-width) solid var(--color-border);
    background: var(--color-bg);
    font-size: var(--font-size-sm);
  }
  .cluster {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .icon-btn,
  .text-btn {
    min-width: 32px;
    height: 32px;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }
  .icon-btn {
    font-size: var(--font-size-lg);
    line-height: 1;
  }
  .text-btn {
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
  }
  .text-btn.active {
    background: var(--color-active-bg);
    border-color: var(--color-border-strong);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:hover:not(:disabled) {
    background: var(--color-surface);
  }
  .page-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .page-field input {
    height: 32px;
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    text-align: center;
    font-size: var(--font-size-sm);
  }
  .of {
    color: var(--color-text-muted);
    white-space: nowrap;
  }
  .zoom {
    min-width: 3.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
