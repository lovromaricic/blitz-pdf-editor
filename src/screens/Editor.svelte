<script lang="ts">
  import { app, closeDocument } from '../lib/app-state.svelte';
  import { CommandRegistry } from '../lib/commands';
  import type { EditorDocument } from '../lib/document.svelte';
  import { openFiles } from '../lib/open-files.svelte';
  import { viewportFor } from '../lib/pdf/render';
  import type { SearchMatch } from '../lib/search.svelte';
  import { PAGE_GAP, provideViewer, Viewer } from '../lib/viewer.svelte';
  import CanvasView from '../editor/CanvasView.svelte';
  import MenuBar from '../editor/MenuBar.svelte';
  import SidePanel from '../editor/SidePanel.svelte';
  import ThumbnailRail from '../editor/ThumbnailRail.svelte';
  import TitleBar from '../editor/TitleBar.svelte';
  import Toolbar from '../editor/Toolbar.svelte';

  let { doc }: { doc: EditorDocument } = $props();

  // svelte-ignore state_referenced_locally (the editor is re-created per document)
  const viewer = new Viewer(doc);
  provideViewer(viewer);

  let fileInput: HTMLInputElement;

  function focusById(id: string) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }

  /** Scroll so a search match sits in the upper third of the view. */
  async function revealMatch(m: SearchMatch) {
    const index = doc.pages.findIndex((p) => p.id === m.pageId);
    const page = doc.pages[index];
    const el = viewer.scrollEl;
    if (!page || !el) return;
    const pdfPage = await doc.source(page).pdf.getPage(page.sourceIndex + 1);
    const vp = viewportFor(pdfPage, viewer.scale, page.rotation);
    const pts = m.quads.flat().map(([x, y]) => vp.convertToViewportPoint(x, y));
    const minY = Math.min(...pts.map((p) => p[1]));
    const minX = Math.min(...pts.map((p) => p[0]));
    viewer.goToPage(index, minY + PAGE_GAP - el.clientHeight / 3);
    const box = viewer.layout.boxes[index];
    const pageLeft = Math.max(PAGE_GAP, (el.scrollWidth - box.width) / 2);
    const x = pageLeft + minX;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth / 3;
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => {});
  }

  let isFullscreen = $state(false);

  const commands = new CommandRegistry({
    'file.open': { run: () => fileInput.click() },
    'file.close': { run: closeDocument },
    'edit.find': { run: () => focusById('doc-search') },
    'view.zoomIn': { run: () => viewer.zoomIn() },
    'view.zoomOut': { run: () => viewer.zoomOut() },
    'view.fitWidth': { run: () => viewer.fitWidth(), checked: () => viewer.fit === 'width' },
    'view.fitPage': { run: () => viewer.fitPage(), checked: () => viewer.fit === 'page' },
    'view.actualSize': { run: () => viewer.actualSize() },
    'view.continuous': { run: () => {}, checked: () => true },
    'view.thumbnails': { run: () => (viewer.showThumbnails = !viewer.showThumbnails), checked: () => viewer.showThumbnails },
    'view.panel': { run: () => (viewer.showPanel = !viewer.showPanel), checked: () => viewer.showPanel },
    'view.fullscreen': { run: toggleFullscreen, checked: () => isFullscreen },
    'page.goTo': { run: () => focusById('page-number-input') },
  });

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    const rejected = await openFiles(Array.from(files));
    if (rejected.length) app.openWarnings = rejected;
    fileInput.value = '';
  }
</script>

<svelte:window onkeydown={(e) => commands.handleKey(e)} />
<svelte:document onfullscreenchange={() => (isFullscreen = !!document.fullscreenElement)} />

<div class="editor" class:no-rail={!viewer.showThumbnails} class:no-panel={!viewer.showPanel}>
  <TitleBar onReveal={revealMatch} />
  <MenuBar {commands} />
  <Toolbar {commands} />

  {#if app.openWarnings.length}
    <div class="warning" role="alert">
      <span>
        Could not open:
        {#each app.openWarnings as w, i (w.name + i)}
          <strong>{w.name}</strong> ({w.reason}){i < app.openWarnings.length - 1 ? '; ' : ''}
        {/each}
      </span>
      <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (app.openWarnings = [])}>×</button>
    </div>
  {/if}

  <div class="main">
    {#if viewer.showThumbnails}<ThumbnailRail />{/if}
    <CanvasView />
    {#if viewer.showPanel}<SidePanel />{/if}
  </div>

  <input
    bind:this={fileInput}
    class="visually-hidden"
    type="file"
    accept="application/pdf,.pdf"
    multiple
    tabindex="-1"
    aria-hidden="true"
    onchange={(e) => onPickFiles(e.currentTarget.files)}
  />
</div>

<style>
  .editor {
    display: grid;
    grid-template-rows: auto auto auto auto 1fr;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .main {
    display: grid;
    grid-template-columns: var(--rail-width) minmax(0, 1fr) var(--panel-width);
    min-height: 0;
    grid-row: 5;
  }
  .no-rail .main {
    grid-template-columns: minmax(0, 1fr) var(--panel-width);
  }
  .no-panel .main {
    grid-template-columns: var(--rail-width) minmax(0, 1fr);
  }
  .no-rail.no-panel .main {
    grid-template-columns: minmax(0, 1fr);
  }
  .warning {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--color-error-bg);
    border-bottom: var(--border-width) solid var(--color-border);
    font-size: var(--font-size-sm);
  }
  .dismiss {
    width: 28px;
    height: 28px;
    border: 0;
    background: none;
    font-size: var(--font-size-lg);
  }

  /* Interim narrow-screen behaviour; the real phone layout comes in Phase 7. */
  @media (max-width: 900px) {
    .main,
    .no-rail .main,
    .no-panel .main {
      grid-template-columns: var(--rail-width) minmax(0, 1fr);
    }
    .main > :global(aside) {
      display: none;
    }
    .no-rail .main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .main,
    .no-rail .main,
    .no-panel .main {
      grid-template-columns: minmax(0, 1fr);
    }
    .main > :global(nav) {
      display: none;
    }
  }
</style>
