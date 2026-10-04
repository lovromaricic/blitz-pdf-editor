<script lang="ts">
  import { APP_NAME } from '../config';
  import type { SearchMatch } from '../lib/search.svelte';
  import { useViewer } from '../lib/viewer.svelte';
  import SearchBox from './SearchBox.svelte';

  let { onReveal }: { onReveal: (m: SearchMatch) => void } = $props();
  const viewer = useViewer();
</script>

<header class="titlebar">
  <div class="brand">
    <span class="logo" aria-hidden="true">Logo</span>
    <span class="app-name">{APP_NAME}</span>
  </div>
  <span class="divider" aria-hidden="true"></span>
  <h1 class="file-name" title={viewer.doc.name}>{viewer.doc.name}</h1>
  {#if viewer.doc.dirty}<span class="edited">Edited</span>{/if}
  <div class="spacer"></div>
  <SearchBox {onReveal} />
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 48px;
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .logo {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-placeholder);
    color: var(--color-text-muted);
    font-size: 9px;
    text-transform: uppercase;
  }
  .app-name {
    font-weight: 700;
    font-size: var(--font-size-sm);
  }
  .divider {
    width: var(--border-width);
    height: 20px;
    background: var(--color-border);
  }
  .file-name {
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-sm);
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edited {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }
  .spacer {
    flex: 1;
  }
</style>
