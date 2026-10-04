<script lang="ts">
  import type { CommandRegistry } from '../../lib/commands';
  import type { SearchMatch } from '../../lib/search.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import SearchBox from '../SearchBox.svelte';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';

  let { commands, onMenu, onReveal }: { commands: CommandRegistry; onMenu: () => void; onReveal: (m: SearchMatch) => void } = $props();
  const viewer = useViewer();
  let searching = $state(false);

  $effect(() => {
    if (searching) document.getElementById('doc-search')?.focus();
  });
</script>

<header class="topbar">
  <button type="button" class="icon-btn" aria-label="Menu" onclick={onMenu}>
    <MenuIcon size={22} strokeWidth={1.7} aria-hidden="true" />
  </button>
  <h1 class="name" title={viewer.doc.name}>
    {viewer.doc.name}{#if viewer.doc.dirty}<span class="dot" aria-label="(edited)">•</span>{/if}
  </h1>
  <button type="button" class="icon-btn" aria-label={searching ? 'Close search' : 'Search'} aria-expanded={searching} onclick={() => (searching = !searching)}>
    {#if searching}<X size={22} strokeWidth={1.7} aria-hidden="true" />{:else}<Search size={22} strokeWidth={1.7} aria-hidden="true" />{/if}
  </button>
  <button type="button" class="btn btn-primary save" disabled={!commands.isEnabled('file.save')} onclick={() => commands.run('file.save')}>Save</button>
</header>
{#if searching}
  <div class="search-row"><SearchBox {onReveal} /></div>
{/if}

<style>
  .topbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    padding-top: max(var(--space-1), env(safe-area-inset-top));
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
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
    color: var(--text);
  }
  .icon-btn:active {
    background: var(--surface-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-base);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    margin-left: var(--space-1);
    color: var(--accent);
  }
  .save {
    flex-shrink: 0;
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
    border-radius: var(--radius-md);
  }
  .search-row {
    padding: var(--space-2);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
  }
  .search-row :global(.search) {
    width: 100%;
  }
  .search-row :global(.field) {
    flex: 1;
  }
  .search-row :global(input) {
    width: 100%;
    height: var(--touch-target);
  }
  .search-row :global(.nav) {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
