<script lang="ts">
  import type { Actions } from '../../lib/actions.svelte';
  import { chunkAt, chunkEvery, formatPageRange, parsePageRange } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let { actions }: { actions: Actions } = $props();
  const viewer = useViewer();
  const count = $derived(viewer.doc.pages.length);

  let mode = $state<'every' | 'after' | 'single'>('every');
  let every = $state(2);
  let after = $state('');

  const chunks = $derived.by((): number[][] | null => {
    if (mode === 'single') return chunkEvery(count, 1);
    if (mode === 'every') return Number.isInteger(every) && every >= 1 ? chunkEvery(count, every) : null;
    const cuts = parsePageRange(after, count);
    // "After page 3" means the next file starts at page 4 (index 3).
    return cuts ? chunkAt(count, cuts.map((i) => i + 1)) : null;
  });

  const preview = $derived(chunks ? chunks.slice(0, 6).map((c) => formatPageRange(c)) : []);

  function run(e: SubmitEvent) {
    e.preventDefault();
    if (chunks && chunks.length > 1) void actions.split(chunks);
  }
</script>

<PanelHeader title="Split PDF" onClose={() => (viewer.panel = null)} />

<form class="panel-form" onsubmit={run}>
  <p>Cut this document into several PDFs. This document stays as it is.</p>
  <fieldset>
    <legend>Split</legend>
    <label class="option">
      <input type="radio" name="split-mode" value="every" bind:group={mode} />
      Every
      <input type="number" min="1" max={count} bind:value={every} aria-label="Pages per file" onfocus={() => (mode = 'every')} />
      pages
    </label>
    <label class="option">
      <input type="radio" name="split-mode" value="after" bind:group={mode} />
      After pages
      <input type="text" bind:value={after} placeholder="3, 7" aria-label="Split after these pages" onfocus={() => (mode = 'after')} />
    </label>
    <label class="option">
      <input type="radio" name="split-mode" value="single" bind:group={mode} />
      Every page into its own file
    </label>
  </fieldset>

  <div class="hint" aria-live="polite">
    {#if !chunks}
      <span class="error">Check the page numbers (1 to {count}).</span>
    {:else if chunks.length < 2}
      This would create just one file. Choose where to split.
    {:else}
      Creates {chunks.length} files: {preview.join(' · ')}{chunks.length > preview.length ? ' …' : ''}. Several files download as one .zip.
    {/if}
  </div>

  <div class="actions">
    <button type="submit" class="btn btn-primary" disabled={!chunks || chunks.length < 2 || !!viewer.task}>Split and download</button>
  </div>
</form>
