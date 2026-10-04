<script lang="ts">
  import type { CommandRegistry } from '../../lib/commands';
  import type { SearchMatch } from '../../lib/search.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import SearchBox from '../SearchBox.svelte';

  let { commands, onMenu, onReveal }: { commands: CommandRegistry; onMenu: () => void; onReveal: (m: SearchMatch) => void } = $props();
  const viewer = useViewer();
  let searching = $state(false);

  $effect(() => {
    if (searching) document.getElementById('doc-search')?.focus();
  });
</script>

<header class="topbar">
  <button type="button" class="icon-btn" aria-label="Menu" onclick={onMenu}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" fill="none" /></svg>
  </button>
  <h1 class="name" title={viewer.doc.name}>
    {viewer.doc.name}{#if viewer.doc.dirty}<span class="dot" aria-label="(edited)">•</span>{/if}
  </h1>
  <button type="button" class="icon-btn" aria-label={searching ? 'Close search' : 'Search'} aria-expanded={searching} onclick={() => (searching = !searching)}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="2" fill="none" /><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" /></svg>
  </button>
  <button type="button" class="btn btn-primary save" disabled={!commands.isEnabled('file.save')} onclick={() => commands.run('file.save')}>Save</button>
</header>
{#if searching}
  <div class="search-row"><SearchBox {onReveal} /></div>
{/if}

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    padding-top: max(var(--space-1), env(safe-area-inset-top));
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: var(--touch-target);
    height: var(--touch-target);
    flex-shrink: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
  }
  .icon-btn:active {
    background: var(--color-surface-strong);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-md);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    margin-left: var(--space-1);
    color: var(--color-text-muted);
  }
  .save {
    flex-shrink: 0;
    padding: 0 var(--space-4);
  }
  .save:disabled {
    opacity: 0.5;
  }
  .search-row {
    padding: var(--space-2);
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .search-row :global(input) {
    flex: 1;
    width: auto;
    height: var(--touch-target);
  }
  .search-row :global(.nav) {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
