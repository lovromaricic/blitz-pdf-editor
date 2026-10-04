<script lang="ts">
  import type { Actions } from '../../lib/actions.svelte';
  import { formatPageRange, parsePageRange } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let { actions }: { actions: Actions } = $props();
  const viewer = useViewer();
  const doc = viewer.doc;

  // svelte-ignore state_referenced_locally (prefilled once from the selection when opened)
  let range = $state(formatPageRange(viewer.targetPages().map((p) => doc.pages.indexOf(p))));
  let removeAfter = $state(false);

  const parsed = $derived(parsePageRange(range, doc.pages.length));
  const removesAll = $derived(removeAfter && parsed !== null && parsed.length === doc.pages.length);

  function run(e: SubmitEvent) {
    e.preventDefault();
    if (!parsed || removesAll) return;
    void actions.extract(
      parsed.map((i) => doc.pages[i]),
      removeAfter,
    );
  }
</script>

<PanelHeader title="Extract pages" onClose={() => (viewer.panel = null)} />

<form class="panel-form" onsubmit={run}>
  <p>Save some pages as a new PDF. This document stays open.</p>
  <div class="field">
    <label for="extract-range">Pages</label>
    <input
      id="extract-range"
      type="text"
      bind:value={range}
      aria-invalid={parsed === null}
      aria-describedby="extract-hint"
      autocomplete="off"
    />
    <span class="hint" id="extract-hint">
      {#if parsed === null}
        <span class="error">Enter pages between 1 and {doc.pages.length}, e.g. 1-3, 5</span>
      {:else}
        {parsed.length} of {doc.pages.length} pages. Example: 1-3, 5, 8-
      {/if}
    </span>
  </div>
  <label class="option">
    <input type="checkbox" bind:checked={removeAfter} />
    Delete these pages from this document
  </label>
  {#if removesAll}
    <p class="error" role="alert">A document needs at least one page left.</p>
  {/if}
  <div class="actions">
    <button type="submit" class="btn btn-primary" disabled={!parsed || removesAll || !!viewer.task}>Extract and download</button>
  </div>
</form>
