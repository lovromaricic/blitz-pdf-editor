<script lang="ts">
  import { useActions } from '../../lib/actions.svelte';
  import { formatPageRange } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();
  const doc = viewer.doc;

  let query = $state('');
  let result = $state<string | null>(null);

  const count = $derived(actions.redactionCount);
  const markedPages = $derived(doc.pages.flatMap((p, i) => (p.redactions?.length ? [i] : [])));

  // Marking happens on the pages: switch away from any markup tool.
  $effect(() => {
    if (viewer.tool !== 'select') viewer.tool = 'select';
  });

  async function markMatches(e: SubmitEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const n = await actions.markMatches(query);
    result = n ? `Marked ${n} ${n === 1 ? 'match' : 'matches'}.` : `"${query.trim()}" was not found. Scanned pages need Make text searchable first.`;
  }
</script>

<PanelHeader title="Redact" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  <p class="hint">
    Drag on a page to mark an area, or find text to mark every place it appears. Applying removes what's under the marks from the
    file for good, not just covers it.
  </p>

  <form class="field" onsubmit={markMatches}>
    <label for="redact-find">Find text to redact</label>
    <input id="redact-find" type="text" bind:value={query} placeholder="Name, number, word…" autocomplete="off" oninput={() => (result = null)} />
    <button type="submit" class="btn" disabled={!query.trim() || !!viewer.task}>Mark all matches</button>
    {#if result}<p class="hint" role="status">{result}</p>{/if}
  </form>

  <div class="field">
    <span class="label">Marked</span>
    {#if count}
      <p class="summary">
        {count}
        {count === 1 ? 'area' : 'areas'} on {markedPages.length === 1 ? 'page' : 'pages'}
        {formatPageRange(markedPages)}
      </p>
      <button type="button" class="btn btn-soft" onclick={() => actions.clearRedactions()}>Clear all marks</button>
    {:else}
      <p class="hint">Nothing marked yet.</p>
    {/if}
  </div>

  <label class="option">
    <input type="checkbox" bind:checked={viewer.redactRemoveInfo} />
    Also remove document properties (title, author, keywords)
  </label>

  <div class="actions">
    <button
      type="button"
      class="btn btn-primary"
      disabled={!count || !!viewer.task}
      onclick={() => actions.applyRedactions(viewer.redactRemoveInfo)}
    >
      Apply redaction
    </button>
  </div>
  <p class="hint">
    Marked pages are turned into images with black boxes, so their text can no longer be selected or searched. Other pages are not
    changed. You can undo until you save.
  </p>
</div>

<style>
  .summary {
    margin: 0;
  }
</style>
