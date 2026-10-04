<script lang="ts">
  import { untrack } from 'svelte';
  import { app, closeDocument } from '../lib/app-state.svelte';
  import { Actions, provideActions } from '../lib/actions.svelte';
  import { describe } from '../lib/annotations';
  import { IMAGE_ACCEPT } from '../lib/image-input';
  import { CommandRegistry } from '../lib/commands';
  import type { EditorDocument } from '../lib/document.svelte';
  import { openFiles } from '../lib/open-files.svelte';
  import { viewportFor } from '../lib/pdf/render';
  import type { SearchMatch } from '../lib/search.svelte';
  import { PAGE_GAP, provideViewer, Viewer } from '../lib/viewer.svelte';
  import { REPORT_PROBLEM_URL } from '../config';
  import CanvasView from '../editor/CanvasView.svelte';
  import HelpDialog, { type HelpTopic } from '../editor/HelpDialog.svelte';
  import SignatureDialog from '../editor/SignatureDialog.svelte';
  import MenuBar from '../editor/MenuBar.svelte';
  import SidePanel from '../editor/SidePanel.svelte';
  import ThumbnailRail from '../editor/ThumbnailRail.svelte';
  import TitleBar from '../editor/TitleBar.svelte';
  import Toolbar from '../editor/Toolbar.svelte';

  let { doc }: { doc: EditorDocument } = $props();

  // svelte-ignore state_referenced_locally (the editor is re-created per document)
  const viewer = new Viewer(doc);
  provideViewer(viewer);
  // svelte-ignore state_referenced_locally
  const actions = new Actions(doc, viewer);
  provideActions(actions);

  let openInput: HTMLInputElement;
  let insertInput: HTMLInputElement;

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

  let isFullscreen = $state(false);

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => {});
  }

  function openPanel(panel: NonNullable<Viewer['panel']>) {
    viewer.panel = panel;
    viewer.showPanel = true;
  }

  const idle = () => !viewer.task;
  let help = $state<HelpTopic | null>(null);

  const commands = new CommandRegistry({
    // File
    'file.open': { run: () => openInput.click() },
    'file.save': { run: () => void actions.save(), enabled: idle },
    'file.saveCopy': { run: () => void actions.saveCopy(), enabled: idle },
    'file.exportText': { run: () => void actions.exportText(), enabled: idle },
    'file.exportImages': { run: () => openPanel('exportImages'), enabled: idle },
    'file.createFromImages': { run: () => openPanel('imagesToPdf'), enabled: idle },
    'file.print': { run: () => void actions.print(), enabled: idle },
    'file.close': {
      run: async () => {
        if (await actions.confirmLeave('close it')) closeDocument();
      },
    },

    // Edit
    'edit.undo': {
      run: () => doc.undo(),
      enabled: () => doc.history.canUndo && idle(),
      label: () => (doc.history.undoLabel ? `Undo ${lowerFirst(doc.history.undoLabel)}` : 'Undo'),
    },
    'edit.redo': {
      run: () => doc.redo(),
      enabled: () => doc.history.canRedo && idle(),
      label: () => (doc.history.redoLabel ? `Redo ${lowerFirst(doc.history.redoLabel)}` : 'Redo'),
    },
    // Until markup objects exist (Phase 5), Select all selects all pages.
    'edit.selectAll': { run: () => viewer.selectAll(), label: () => 'Select all pages' },
    // Delete acts on selected pages until markup objects exist (Phase 5).
    // Cut/Copy only take over when an annotation is selected; otherwise the browser copies selected text.
    'edit.cut': { run: () => actions.cutAnnotation(), enabled: () => !!viewer.selectedAnnot },
    'edit.copy': { run: () => actions.copyAnnotation(), enabled: () => !!viewer.selectedAnnot },
    'edit.paste': { run: () => actions.pasteAnnotation(), enabled: () => actions.canPaste() },
    'edit.delete': {
      run: () => {
        const sel = viewer.selectedAnnot;
        if (sel) actions.deleteAnnotation(sel.pageId, sel.id);
        else actions.delete();
      },
      enabled: () => !!viewer.selectedAnnot || (viewer.selection.size > 0 && actions.canDelete()),
      label: () => {
        const sel = actions.selectedAnnot;
        if (sel) return `Delete ${describe(sel.annot).toLowerCase()}`;
        const n = viewer.selection.size;
        return n > 0 ? `Delete ${n === 1 ? 'page' : `${n} pages`}` : 'Delete';
      },
    },
    'edit.find': { run: () => focusById('doc-search') },

    // View
    'view.zoomIn': { run: () => viewer.zoomIn() },
    'view.zoomOut': { run: () => viewer.zoomOut() },
    'view.fitWidth': { run: () => viewer.fitWidth(), checked: () => viewer.fit === 'width' },
    'view.fitPage': { run: () => viewer.fitPage(), checked: () => viewer.fit === 'page' },
    'view.actualSize': { run: () => viewer.actualSize() },
    'view.singlePage': { run: () => void viewer.setMode('single'), checked: () => viewer.mode === 'single' },
    'view.continuous': { run: () => void viewer.setMode('continuous'), checked: () => viewer.mode === 'continuous' },
    'view.twoPages': { run: () => void viewer.setMode('two'), checked: () => viewer.mode === 'two' },
    'view.thumbnails': { run: () => (viewer.showThumbnails = !viewer.showThumbnails), checked: () => viewer.showThumbnails },
    'view.panel': { run: () => (viewer.showPanel = !viewer.showPanel), checked: () => viewer.showPanel },
    'view.fullscreen': { run: toggleFullscreen, checked: () => isFullscreen },

    // Page (selection, or the current page when nothing is selected)
    'page.rotateLeft': { run: () => actions.rotate(-90) },
    'page.rotateRight': { run: () => actions.rotate(90) },
    'page.delete': { run: () => actions.delete(), enabled: () => actions.canDelete() },
    'page.extract': { run: () => openPanel('extract'), enabled: idle },
    'page.insertBlank': { run: () => void actions.insertBlank() },
    'page.insertFromFile': { run: () => insertInput.click(), enabled: idle },
    'page.crop': { run: () => openPanel('crop'), enabled: idle },
    'page.numbers': { run: () => openPanel('pageNumbers') },
    'page.goTo': { run: () => focusById('page-number-input') },

    // Tools
    'tools.merge': { run: () => openPanel('merge'), enabled: idle },
    'tools.compress': { run: () => openPanel('compress'), enabled: idle },
    'tools.split': { run: () => openPanel('split'), enabled: () => idle() && doc.pages.length > 1 },
    'tools.flatten': { run: () => actions.flattenForms(), enabled: () => actions.canFlatten() },
    'tools.watermark': { run: () => openPanel('watermark') },
    'tools.protect': { run: () => openPanel('protect') },
    'tools.unlock': { run: () => openPanel('unlock'), enabled: () => !!doc.settings.protection },

    // Help
    'help.guide': { run: () => (help = 'guide') },
    'help.shortcuts': { run: () => (help = 'shortcuts') },
    'help.report': { run: () => window.open(REPORT_PROBLEM_URL, '_blank', 'noopener'), enabled: () => !!REPORT_PROBLEM_URL },
    'help.about': { run: () => (help = 'about') },
  });

  function lowerFirst(s: string) {
    return s[0].toLowerCase() + s.slice(1);
  }

  async function onPickOpen(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    openInput.value = '';
    if (!list.length || !(await actions.confirmLeave('open another file'))) return;
    const rejected = await openFiles(list);
    if (rejected.length) app.openWarnings = rejected;
  }

  async function onPickInsert(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    insertInput.value = '';
    if (list.length) await actions.insertFromFiles(list);
  }

  // After any page edit (including undo/redo): keep selection valid and refresh search hits.
  $effect(() => {
    void doc.pages;
    untrack(() => {
      viewer.syncAfterEdit();
      const q = viewer.search.query;
      if (q) void viewer.search.run(q, viewer.currentIndex, () => {});
    });
  });

  function onKeyDown(e: KeyboardEvent) {
    if (commands.handleKey(e)) return;
    // Esc steps back: deselect the annotation, then return to the Select tool.
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [role="menu"]')) return;
      if (viewer.selectedAnnot) viewer.selectAnnot(null);
      else if (viewer.tool !== 'select') viewer.setTool('select');
    }
  }

  // Watermarks and page numbers are measured with the embedded fonts.
  $effect(() => {
    if (doc.settings.watermark || doc.settings.pageNumbers) viewer.ensureFonts();
  });

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!doc.dirty) return;
    e.preventDefault();
    // Older browsers need returnValue set to show the prompt.
    e.returnValue = '';
  }
</script>

<svelte:window onkeydown={onKeyDown} onbeforeunload={onBeforeUnload} />
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
    {#if viewer.showThumbnails}<ThumbnailRail {commands} {actions} />{/if}
    <CanvasView />
    {#if viewer.showPanel}<SidePanel {commands} {actions} />{/if}
  </div>

  <HelpDialog topic={help} onClose={() => (help = null)} />
  <SignatureDialog />

  <input
    bind:this={openInput}
    class="visually-hidden"
    type="file"
    accept="application/pdf,.pdf"
    multiple
    tabindex="-1"
    aria-hidden="true"
    onchange={(e) => onPickOpen(e.currentTarget.files)}
  />
  <input
    bind:this={insertInput}
    class="visually-hidden"
    type="file"
    accept="application/pdf,.pdf,{IMAGE_ACCEPT}"
    multiple
    tabindex="-1"
    aria-hidden="true"
    onchange={(e) => onPickInsert(e.currentTarget.files)}
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
