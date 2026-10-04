<script lang="ts">
  import { useViewer } from '../lib/viewer.svelte';
  import type { SearchMatch } from '../lib/search.svelte';

  let { onReveal }: { onReveal: (m: SearchMatch) => void } = $props();

  const viewer = useViewer();
  const search = viewer.search;

  let value = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  function runNow() {
    clearTimeout(timer);
    void search.run(value, viewer.currentIndex, onReveal);
  }

  function onInput() {
    clearTimeout(timer);
    if (!value.trim()) {
      search.clear();
      return;
    }
    timer = setTimeout(runNow, 300);
  }

  function step(delta: 1 | -1) {
    if (search.query !== value) return runNow();
    const m = search.step(delta);
    if (m) onReveal(m);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      value = '';
      search.clear();
    }
  }

  const status = $derived.by(() => {
    if (!search.query) return '';
    if (search.matches.length === 0) return search.running ? 'Searching…' : 'No results';
    const pos = search.active >= 0 ? `${search.active + 1} / ` : '';
    return `${pos}${search.matches.length}${search.running ? '+' : ''}`;
  });
</script>

<div class="search" role="search">
  <label for="doc-search" class="visually-hidden">Search in document</label>
  <input
    id="doc-search"
    type="search"
    placeholder="Search in document"
    autocomplete="off"
    spellcheck="false"
    bind:value
    oninput={onInput}
    onkeydown={onKey}
  />
  <span class="status" aria-live="polite">{status}</span>
  <button type="button" class="nav" aria-label="Previous result" disabled={search.matches.length === 0} onclick={() => step(-1)}>‹</button>
  <button type="button" class="nav" aria-label="Next result" disabled={search.matches.length === 0} onclick={() => step(1)}>›</button>
</div>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  input {
    width: 240px;
    min-width: 0;
    height: 32px;
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    font-size: var(--font-size-sm);
  }
  .status {
    min-width: 4.5rem;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    text-align: right;
    white-space: nowrap;
  }
  .nav {
    width: 32px;
    height: 32px;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    font-size: var(--font-size-lg);
    line-height: 1;
  }
  .nav:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
