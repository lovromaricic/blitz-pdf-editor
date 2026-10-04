<script lang="ts">
  // Contextual panel: a tool panel if one is open, else the selected pages, else document info.
  import type { Actions } from '../lib/actions.svelte';
  import type { CommandRegistry } from '../lib/commands';
  import { formatBytes } from '../lib/files';
  import { useViewer } from '../lib/viewer.svelte';
  import CropPanel from './panels/CropPanel.svelte';
  import ExtractPanel from './panels/ExtractPanel.svelte';
  import MarkupPanel from './panels/MarkupPanel.svelte';
  import MergePanel from './panels/MergePanel.svelte';
  import PagesPanel from './panels/PagesPanel.svelte';
  import PanelHeader from './panels/PanelHeader.svelte';
  import SplitPanel from './panels/SplitPanel.svelte';

  let { commands, actions }: { commands: CommandRegistry; actions: Actions } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;
</script>

<aside class="panel" aria-label="Properties">
  {#if viewer.panel === 'extract'}
    <ExtractPanel {actions} />
  {:else if viewer.panel === 'split'}
    <SplitPanel {actions} />
  {:else if viewer.panel === 'merge'}
    <MergePanel {actions} />
  {:else if viewer.panel === 'crop'}
    <CropPanel />
  {:else if viewer.selectedAnnot || ['highlight', 'draw', 'shapes'].includes(viewer.tool)}
    <MarkupPanel />
  {:else if viewer.selection.size > 0}
    <PagesPanel {commands} />
  {:else}
    <PanelHeader title="Document" />
    <dl>
      <dt>Name</dt>
      <dd class="wrap">{doc.name}</dd>
      {#if doc.files.length > 1}
        <dt>Files</dt>
        <dd>
          <ul>
            {#each doc.files as s (s.id)}
              <li class="wrap">{s.name}</li>
            {/each}
          </ul>
        </dd>
      {/if}
      <dt>Pages</dt>
      <dd>{doc.pages.length}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(doc.totalSize)}{doc.files.length > 1 ? ' (all files)' : ''}</dd>
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
      <dt>Changes</dt>
      <dd>{doc.dirty ? 'Not saved yet' : 'None'}</dd>
    </dl>
  {/if}
</aside>

<style>
  .panel {
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--space-4);
    border-left: var(--border-width) solid var(--color-border);
    background: var(--color-bg);
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
