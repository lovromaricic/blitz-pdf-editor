<script lang="ts">
  // Contextual panel. Phase 2 has only the "nothing selected" state: document info.
  import { formatBytes } from '../lib/files';
  import { useViewer } from '../lib/viewer.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;
</script>

<aside class="panel" aria-label="Properties">
  <h2>Document</h2>
  <dl>
    <dt>Name</dt>
    <dd class="wrap">{doc.name}</dd>
    {#if doc.sources.size > 1}
      <dt>Files</dt>
      <dd>
        <ul>
          {#each [...doc.sources.values()] as s (s.id)}
            <li class="wrap">{s.name}</li>
          {/each}
        </ul>
      </dd>
    {/if}
    <dt>Pages</dt>
    <dd>{doc.pages.length}</dd>
    <dt>Size</dt>
    <dd>{formatBytes(doc.totalSize)}</dd>
    {#if doc.info.title}
      <dt>Title</dt>
      <dd class="wrap">{doc.info.title}</dd>
    {/if}
    {#if doc.info.author}
      <dt>Author</dt>
      <dd class="wrap">{doc.info.author}</dd>
    {/if}
    {#if doc.info.pdfVersion}
      <dt>PDF version</dt>
      <dd>{doc.info.pdfVersion}</dd>
    {/if}
  </dl>
</aside>

<style>
  .panel {
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    border-left: var(--border-width) solid var(--color-border);
    background: var(--color-bg);
  }
  h2 {
    margin-bottom: var(--space-3);
    font-size: var(--font-size-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    font-size: var(--font-size-sm);
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  .wrap {
    overflow-wrap: anywhere;
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
  }
</style>
