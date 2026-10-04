<script lang="ts">
  import type { Actions } from '../../lib/actions.svelte';
  import type { PageRef } from '../../lib/document.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let { actions }: { actions: Actions } = $props();
  const viewer = useViewer();
  const doc = viewer.doc;

  interface Item {
    key: string;
    name: string;
    /** Null for the open document: its pages are read at merge time. */
    pages: readonly PageRef[] | null;
  }

  let items = $state<Item[]>([{ key: 'current', name: 'This document', pages: null }]);
  let fileInput: HTMLInputElement;
  let keyCounter = 0;

  const pageCount = (item: Item) => (item.pages ?? doc.pages).length;
  const total = $derived(items.reduce((n, it) => n + pageCount(it), 0));

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const loaded = await actions.loadForMerge(Array.from(files));
    fileInput.value = '';
    if (!loaded) return;
    items = [...items, ...loaded.map((f) => ({ key: `f${++keyCounter}`, name: f.name, pages: f.pages }))];
  }

  function move(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
  }

  function remove(i: number) {
    items = items.filter((_, k) => k !== i);
  }

  function merge() {
    actions.merge(items.map((it) => ({ name: it.pages ? it.name : doc.name, pages: it.pages ?? doc.pages })));
    viewer.panel = null;
  }
</script>

<PanelHeader title="Merge PDFs" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  <p>Combine files into one document, in this order. You can undo a merge.</p>

  <ol class="files" aria-label="Files to merge">
    {#each items as item, i (item.key)}
      <li>
        <span class="name">
          <span class="title">{item.name}</span>
          <span class="hint">{pageCount(item)} {pageCount(item) === 1 ? 'page' : 'pages'}</span>
        </span>
        <span class="controls">
          <button type="button" class="mini" aria-label="Move {item.name} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
          <button type="button" class="mini" aria-label="Move {item.name} down" disabled={i === items.length - 1} onclick={() => move(i, 1)}>↓</button>
          <button type="button" class="mini" aria-label="Remove {item.name}" onclick={() => remove(i)}>×</button>
        </span>
      </li>
    {:else}
      <li class="empty">No files. Add some below.</li>
    {/each}
  </ol>

  <div class="actions">
    <button type="button" class="btn" onclick={() => fileInput.click()} disabled={!!viewer.task}>+ Add files</button>
    <button type="button" class="btn btn-primary" disabled={items.length < 2 || !!viewer.task} onclick={merge}>
      Merge {items.length} files ({total} pages)
    </button>
  </div>
  {#if items.length < 2}
    <p class="hint">Add at least one more file to merge.</p>
  {/if}

  <input
    bind:this={fileInput}
    class="visually-hidden"
    type="file"
    accept="application/pdf,.pdf"
    multiple
    tabindex="-1"
    aria-hidden="true"
    onchange={(e) => add(e.currentTarget.files)}
  />
</div>

<style>
  .files {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  li.empty {
    justify-content: center;
    color: var(--color-text-muted);
  }
  .name {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .controls {
    display: flex;
    gap: 2px;
  }
  .mini {
    width: 28px;
    height: 28px;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }
  @media (max-width: 640px), (pointer: coarse) {
    .mini {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
  .mini:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
