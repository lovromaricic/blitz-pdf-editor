<script lang="ts">
  import { APP_NAME } from '../config';
  import type { SearchMatch } from '../lib/search.svelte';
  import { useViewer } from '../lib/viewer.svelte';
  import SearchBox from './SearchBox.svelte';

  let { onReveal }: { onReveal: (m: SearchMatch) => void } = $props();
  const viewer = useViewer();
</script>

<header class="titlebar">
  <span class="app-name">{APP_NAME}</span>
  <span class="divider" aria-hidden="true"></span>
  <h1 class="file-name" title={viewer.doc.name}>{viewer.doc.name}</h1>
  {#if viewer.doc.dirty}<span class="edited">Edited</span>{/if}
  <div class="spacer"></div>
  <SearchBox {onReveal} />
</header>

<style>
  .titlebar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-3);
    height: var(--titlebar-height);
    padding: 0 var(--space-4);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
  }
  .app-name {
    flex-shrink: 0;
    font-size: var(--font-size-base);
    font-weight: 700;
  }
  .divider {
    width: var(--border-width);
    height: 22px;
    background: var(--border);
  }
  .file-name {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--font-size-md);
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edited {
    flex-shrink: 0;
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
</style>
