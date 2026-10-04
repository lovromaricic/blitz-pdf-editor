<script lang="ts">
  import { useViewer } from '../lib/viewer.svelte';
  import type { SearchMatch } from '../lib/search.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import SearchIcon from '@lucide/svelte/icons/search';

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
    const pos = search.active >= 0 ? `${search.active + 1} of ` : '';
    return `${pos}${search.matches.length}${search.running ? '+' : ''}`;
  });
  const hasResults = $derived(search.matches.length > 0);
</script>

<div class="search" role="search">
  <div class="field">
    <SearchIcon class="icon" size={16} strokeWidth={1.7} aria-hidden="true" />
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
  </div>
  <span class="status" class:empty={!status} aria-live="polite">{status}</span>
  <!-- Result arrows appear only once there are results. -->
  {#if hasResults}
    <button type="button" class="nav" aria-label="Previous result" onclick={() => step(-1)}>
      <ChevronUp size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
    <button type="button" class="nav" aria-label="Next result" onclick={() => step(1)}>
      <ChevronDown size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  {/if}
</div>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .field {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .field :global(.icon) {
    position: absolute;
    left: 12px;
    color: var(--muted);
    pointer-events: none;
  }
  input {
    width: 240px;
    min-width: 0;
    height: 38px;
    padding: 0 var(--space-3) 0 36px;
    border-color: var(--surface-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-size: var(--font-size-md);
  }
  input::placeholder {
    color: var(--muted);
  }
  .status {
    padding: 0 var(--space-1);
    color: var(--muted);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
  .status.empty {
    display: none;
  }
  .nav {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
  }
  .nav:hover {
    background: var(--surface-2);
  }
</style>
