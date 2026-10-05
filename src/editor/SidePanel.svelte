<script lang="ts">
  import { tick } from 'svelte';
  // Contextual panel: a tool panel if one is open, else the selected pages, else document info.
  import type { Actions } from '../lib/actions.svelte';
  import type { CommandRegistry } from '../lib/commands';
  import { formatBytes } from '../lib/files';
  import { useViewer } from '../lib/viewer.svelte';
  import CompressPanel from './panels/CompressPanel.svelte';
  import OcrPanel from './panels/OcrPanel.svelte';
  import RedactPanel from './panels/RedactPanel.svelte';
  import CropPanel from './panels/CropPanel.svelte';
  import ImagesToPdfPanel from './panels/ImagesToPdfPanel.svelte';
  import ExportImagesPanel from './panels/ExportImagesPanel.svelte';
  import PageNumbersPanel from './panels/PageNumbersPanel.svelte';
  import ProtectPanel from './panels/ProtectPanel.svelte';
  import UnlockPanel from './panels/UnlockPanel.svelte';
  import WatermarkPanel from './panels/WatermarkPanel.svelte';
  import ExtractPanel from './panels/ExtractPanel.svelte';
  import CommentPanel from './panels/CommentPanel.svelte';
  import FormPanel from './panels/FormPanel.svelte';
  import MarkupPanel from './panels/MarkupPanel.svelte';
  import SignPanel from './panels/SignPanel.svelte';
  import ImagePanel from './panels/ImagePanel.svelte';
  import StampPanel from './panels/StampPanel.svelte';
  import TextPanel from './panels/TextPanel.svelte';
  import MergePanel from './panels/MergePanel.svelte';
  import PagesPanel from './panels/PagesPanel.svelte';
  import PanelHeader from './panels/PanelHeader.svelte';
  import SplitPanel from './panels/SplitPanel.svelte';

  let { commands, actions, inSheet = false }: { commands: CommandRegistry; actions: Actions; inSheet?: boolean } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;

  // Opening a tool (Merge, Compress…) moves focus to its panel, so keyboard and
  // screen-reader users land where the work is.
  let panelEl: HTMLElement;
  let lastPanel: typeof viewer.panel = null;
  $effect(() => {
    const p = viewer.panel;
    if (p && p !== lastPanel) void tick().then(() => panelEl?.focus());
    lastPanel = p;
  });

  /** Which markup panel to show: the selected annotation's kind, else the active tool's. */
  const markup = $derived.by(() => {
    const annot = actions.selectedAnnot?.annot;
    // Inserted images have their own panel; signatures stay with Sign.
    if (annot?.type === 'image' && annot.role === 'image') return 'image';
    const key = annot?.type ?? viewer.tool;
    const map: Record<string, string> = {
      highlight: 'vector', ink: 'vector', draw: 'vector', shape: 'vector', shapes: 'vector',
      text: 'text', stamp: 'stamp', note: 'comment', comment: 'comment', image: 'sign', sign: 'sign',
      form: 'form',
    };
    return map[key] ?? null;
  });
</script>

<!-- In a phone sheet (itself a labelled region) this is a plain container, not a second landmark. -->
<svelte:element this={inSheet ? 'div' : 'aside'} class="panel" class:in-sheet={inSheet} aria-label={inSheet ? undefined : 'Properties'} tabindex="-1" bind:this={panelEl}>
  {#if viewer.panel === 'extract'}
    <ExtractPanel {actions} />
  {:else if viewer.panel === 'split'}
    <SplitPanel {actions} />
  {:else if viewer.panel === 'merge'}
    <MergePanel {actions} />
  {:else if viewer.panel === 'crop'}
    <CropPanel />
  {:else if viewer.panel === 'watermark'}
    <WatermarkPanel />
  {:else if viewer.panel === 'pageNumbers'}
    <PageNumbersPanel />
  {:else if viewer.panel === 'protect'}
    <ProtectPanel />
  {:else if viewer.panel === 'unlock'}
    <UnlockPanel />
  {:else if viewer.panel === 'exportImages'}
    <ExportImagesPanel />
  {:else if viewer.panel === 'ocr'}
    <OcrPanel />
  {:else if viewer.panel === 'redact'}
    <RedactPanel />
  {:else if viewer.panel === 'compress'}
    <CompressPanel />
  {:else if viewer.panel === 'imagesToPdf'}
    <ImagesToPdfPanel />
  {:else if markup === 'vector'}
    <MarkupPanel />
  {:else if markup === 'text'}
    <TextPanel />
  {:else if markup === 'stamp'}
    <StampPanel />
  {:else if markup === 'comment'}
    <CommentPanel />
  {:else if markup === 'sign'}
    <SignPanel />
  {:else if markup === 'image'}
    <ImagePanel />
  {:else if markup === 'form'}
    <FormPanel {commands} />
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
</svelte:element>

<style>
  .panel {
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--space-5);
    border-left: var(--border-width) solid var(--border);
    background: var(--surface);
  }
  /* Focused by code when a tool opens (never by Tab: tabindex -1), so no ring on the whole panel. */
  .panel:focus {
    outline: none;
  }
  .panel.in-sheet {
    padding: 0;
    border: 0;
    overflow: visible;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3) var(--space-4);
    margin: 0;
    font-size: var(--font-size-sm);
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    font-weight: 600;
  }
  .wrap {
    overflow-wrap: anywhere;
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
  }
</style>
