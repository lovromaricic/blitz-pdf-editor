<script module lang="ts">
  /**
   * The editor that owns the window-wide shortcuts and clipboard. Svelte adds
   * and removes the window listeners with each editor; this also makes sure
   * that, should two ever be mounted at once, only one of them acts.
   */
  let owner: symbol | null = null;
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { focusLost, focusSink, installFocusModality } from '../lib/focus';
  import { app, closeDocument } from '../lib/app-state.svelte';
  import { Actions, provideActions } from '../lib/actions.svelte';
  import { describe } from '../lib/annotations';
  import { IMAGE_ACCEPT } from '../lib/image-input';
  import { COMMANDS, CommandRegistry, comboFromEvent, isTextField, type CommandId, type CommandMeta } from '../lib/commands';
  import { CLIPBOARD_KEYS, ClipboardShortcuts } from '../lib/clipboard-shortcuts';
  import { imageAcceptAttr, kindOf } from '../lib/landing/accepted-files';
  import { heicDecodes } from '../lib/landing/heic-probe';
  import { IMAGE_STRINGS } from '../lib/strings';
  import type { EditorDocument } from '../lib/document.svelte';
  import { openFiles } from '../lib/open-files.svelte';
  import { viewportFor } from '../lib/pdf/render';
  import type { SearchMatch } from '../lib/search.svelte';
  import { PAGE_GAP, provideViewer, Viewer } from '../lib/viewer.svelte';
  import { APP_NAME, REPORT_PROBLEM_URL } from '../config';
  import CanvasView from '../editor/CanvasView.svelte';
  import CompareView from '../editor/compare/CompareView.svelte';
  import HelpDialog, { type HelpTopic } from '../editor/HelpDialog.svelte';
  import SignatureDialog from '../editor/SignatureDialog.svelte';
  import NewPdfDialog from '../editor/NewPdfDialog.svelte';
  import MobileMenu from '../editor/mobile/MobileMenu.svelte';
  import MobileTopBar from '../editor/mobile/MobileTopBar.svelte';
  import PagesSheet from '../editor/mobile/PagesSheet.svelte';
  import Sheet from '../editor/mobile/Sheet.svelte';
  import ToolStrip from '../editor/mobile/ToolStrip.svelte';
  import { MARKUP_TOOLS } from '../editor/tools';
  import X from '@lucide/svelte/icons/x';
  import { MediaQuery } from 'svelte/reactivity';
  import MenuBar from '../editor/MenuBar.svelte';
  import SidePanel from '../editor/SidePanel.svelte';
  import ThumbnailRail from '../editor/ThumbnailRail.svelte';
  import TitleBar from '../editor/TitleBar.svelte';
  import Toolbar from '../editor/Toolbar.svelte';

  let { doc }: { doc: EditorDocument } = $props();

  // svelte-ignore state_referenced_locally (the editor is re-created per document)
  const viewer = new Viewer(doc);
  installFocusModality();
  provideViewer(viewer);
  // svelte-ignore state_referenced_locally
  const actions = new Actions(doc, viewer);
  provideActions(actions);
  // Handy for debugging in the browser console during development only.
  // svelte-ignore state_referenced_locally
  if (import.meta.env.DEV) Object.assign(window, { __viewer: viewer, __doc: doc, __actions: actions });

  let openInput: HTMLInputElement;
  let insertInput: HTMLInputElement;
  let imageInput: HTMLInputElement;
  /** HEIC is offered only where this browser can decode it. */
  let heic = $state(false);
  void heicDecodes().then((ok) => (heic = ok));
  let compareInput: HTMLInputElement;
  /** The other file in Compare, while it's open. */
  let compareFile = $state<File | null>(null);

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
    // A third of the way down, and never under the floating toolbar.
    viewer.goToPage(index, minY + viewer.insetTop - Math.max(el.clientHeight / 3, viewer.insetTop + 24));
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

  // Phones get their own layout: same features, different chrome.
  const phone = new MediaQuery('(max-width: 720px)');
  let menuOpen = $state(false);
  let pagesOpen = $state(false);
  /** The properties sheet shows only when there's something to set. */
  const sheetVisible = $derived(!!viewer.panel || !!viewer.selectedAnnot || viewer.tool !== 'select');
  let help = $state<HelpTopic | null>(null);
  let newPdfOpen = $state(false);

  const commands = new CommandRegistry({
    // File
    'file.newBlank': { run: () => (newPdfOpen = true), enabled: idle },
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
    'edit.duplicate': { run: () => actions.duplicateAnnotation(), enabled: () => !!viewer.selectedAnnot },
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

    // Layer order of the selected object (also in the context menu and the Properties panel).
    'object.bringToFront': { run: () => actions.moveSelectedLayer('front'), enabled: () => actions.canMoveSelected('front') },
    'object.bringForward': { run: () => actions.moveSelectedLayer('forward'), enabled: () => actions.canMoveSelected('forward') },
    'object.sendBackward': { run: () => actions.moveSelectedLayer('backward'), enabled: () => actions.canMoveSelected('backward') },
    'object.sendToBack': { run: () => actions.moveSelectedLayer('back'), enabled: () => actions.canMoveSelected('back') },

    // Text formatting shortcuts (only while a text box is selected or edited; otherwise the key is left alone).
    'text.bold': { run: () => void actions.toggleTextStyle('bold'), enabled: () => actions.canStyleText() },
    'text.italic': { run: () => void actions.toggleTextStyle('italic'), enabled: () => actions.canStyleText() },
    'text.underline': { run: () => void actions.toggleTextStyle('underline'), enabled: () => actions.canStyleText() },
    'text.link': { run: () => viewer.textEditor?.openLink(), enabled: () => !!viewer.textEditor },

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
    'page.insertImage': { run: () => imageInput.click(), enabled: idle },
    'page.insertFromFile': { run: () => insertInput.click(), enabled: idle },
    'page.crop': { run: () => openPanel('crop'), enabled: idle },
    'page.numbers': { run: () => openPanel('pageNumbers') },
    'page.goTo': { run: () => focusById('page-number-input') },

    // Tools
    'tools.merge': { run: () => openPanel('merge'), enabled: idle },
    'tools.compress': { run: () => openPanel('compress'), enabled: idle },
    'tools.ocr': { run: () => openPanel('ocr'), enabled: idle },
    'tools.redact': { run: () => openPanel('redact'), enabled: idle },
    'tools.compare': { run: () => compareInput.click(), enabled: idle },
    'tools.split': { run: () => openPanel('split'), enabled: () => idle() && doc.pages.length > 1 },
    // Always available: on a PDF without fields it explains instead of changing anything.
    'tools.flatten': { run: () => void actions.flattenForms(), enabled: idle },
    'tools.watermark': { run: () => openPanel('watermark') },
    'tools.protect': { run: () => openPanel('protect') },
    'tools.unlock': { run: () => openPanel('unlock'), enabled: () => !!doc.settings.protection },

    // Help
    'help.guide': { run: () => (help = 'guide') },
    'help.shortcuts': { run: () => (help = 'shortcuts') },
    'help.report': { run: () => window.open(REPORT_PROBLEM_URL, '_blank', 'noopener'), enabled: () => !!REPORT_PROBLEM_URL },
    'help.about': { run: () => (help = 'about') },

    // Tool shortcuts (same tools as the toolbar).
    ...Object.fromEntries(
      MARKUP_TOOLS.map((t) => [`tool.${t.id}`, { run: () => viewer.setTool(t.id), checked: () => viewer.tool === t.id }]),
    ),
  }, (id) => {
    // Opening a menu keeps the text box being typed in; any command but a text one finishes it first.
    if (!(COMMANDS[id] as CommandMeta).whileEditing) viewer.textEditor?.finish();
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

  async function onPickImages(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    imageInput.value = '';
    if (list.length) await actions.insertImageFiles(list);
  }

  // --- Clipboard: objects copied in the app, and images from other apps --------

  /**
   * Copy, cut and paste: one action per keystroke (clipboard-shortcuts.ts).
   * The clipboard event is the source: it brings images and text from other
   * apps. Copying an object puts only a marker on the system clipboard (never
   * its content); the object itself stays in the tab. Every path runs the same
   * commands as the Edit menu.
   */
  const CLIPBOARD_MARK = 'application/x-blitz-object';
  const me = Symbol('editor');
  $effect(() => {
    owner = me;
    return () => {
      if (owner === me) owner = null;
    };
  });
  const clipboard = new ClipboardShortcuts((id) => commands.run(id));

  function clipboardShortcut(e: KeyboardEvent) {
    const combo = comboFromEvent(e);
    const id = combo ? CLIPBOARD_KEYS[combo] : undefined;
    if (!id || isTextField(e.target) || document.querySelector('dialog[open]')) return false;
    clipboard.keydown(id);
    return true;
  }

  function onClipboard(e: ClipboardEvent) {
    if (owner !== me) return;
    if (compareFile || isTextField(e.target) || document.querySelector('dialog[open]')) return;
    const type = e.type as 'copy' | 'cut' | 'paste';
    if (type === 'paste') {
      const data = e.clipboardData;
      const ours = !!data?.types.includes(CLIPBOARD_MARK);
      const images = Array.from(data?.files ?? []).filter((f) => f.type.startsWith('image/'));
      const text = data?.getData('text/plain') ?? '';
      // Our own object (its marker is on the clipboard), else what another app copied last.
      const what = ours && actions.canPaste() ? 'object' : images.length ? 'images' : text.trim() ? 'text' : actions.canPaste() ? 'object' : null;
      if (!what) return;
      e.preventDefault();
      if (!clipboard.event('paste')) return;
      if (what === 'object') commands.run('edit.paste');
      else if (what === 'images') void actions.insertImageFiles(images);
      else void actions.pasteText(text);
      return;
    }
    // Copy or cut: an object if one is selected, else the browser copies selected text.
    if (!viewer.selectedAnnot) return;
    e.preventDefault();
    e.clipboardData?.setData(CLIPBOARD_MARK, '1');
    if (clipboard.event(type)) commands.run(type === 'cut' ? 'edit.cut' : 'edit.copy');
  }

  // --- Dropping image files onto a page -------------------------------------------

  const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  function onDragOver(e: DragEvent) {
    if (!carriesFiles(e) || compareFile) return;
    // Never let the browser open the file instead of the editor.
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }

  function onDrop(e: DragEvent) {
    if (!carriesFiles(e) || compareFile) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer!.files);
    if (files.length === 0 || document.querySelector('dialog[open]')) return;
    if (files.every((f) => kindOf(f) === 'pdf')) return viewer.notify(IMAGE_STRINGS.dropPdf);
    // On a page: centered under the cursor. Anywhere else: the current page.
    const pageEl = (e.target as Element).closest?.<HTMLElement>('.page[data-index]');
    const box = pageEl?.getBoundingClientRect();
    const drop = pageEl && box ? { index: Number(pageEl.dataset.index), point: [(e.clientX - box.left) / viewer.scale, (e.clientY - box.top) / viewer.scale] as [number, number] } : undefined;
    void actions.insertImageFiles(files, drop);
  }

  // After any page edit (including undo/redo): keep selection valid and refresh search hits.
  $effect(() => {
    void doc.pages;
    untrack(() => {
      // Whatever had focus may have been removed (an object, a page, a field): find it a home.
      void tick().then(recoverFocus);
      viewer.syncAfterEdit();
      const q = viewer.search.query;
      if (q) void viewer.search.run(q, viewer.currentIndex, () => {});
    });
  });

  /**
   * Focus that fell on <body> (its element was removed: an object, a page, a
   * closed popover) goes to the selected object if there is one, else to the
   * editor's non-visual sink, never to the canvas scroll container.
   */
  function recoverFocus() {
    if (!focusLost() || document.querySelector('dialog[open]')) return;
    const sel = viewer.selectedAnnot;
    const el = sel && document.querySelector<HTMLElement>(`[data-annot-id="${sel.id}"]`);
    if (el) el.focus({ preventScroll: true });
    else focusSink();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (owner !== me) return;
    // Compare is a separate full-screen view: editor shortcuts don't apply there.
    if (compareFile) return;
    // A key pressed with focus lost: give it a home first (Tab keeps the browser's own starting point).
    if (e.key !== 'Tab') recoverFocus();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    // Single-key shortcuts don't apply inside dialogs or menus.
    const inOverlay = !!document.querySelector('dialog[open]') || !!(e.target as HTMLElement).closest?.('[role="menu"], [role="menubar"]');
    if (!inOverlay && clipboardShortcut(e)) return;
    if (!(plain && inOverlay) && commands.handleKey(e)) return;
    // Backspace never navigates back (older browsers did), unless it's editing text.
    if (e.key === 'Backspace' && !isTextField(e.target)) e.preventDefault();
    // Esc steps back: deselect the annotation, then return to the Select tool.
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [role="menu"]')) return;
      if (viewer.selectedAnnot) viewer.selectAnnot(null);
      else if (viewer.tool !== 'select') viewer.setTool('select');
    }
  }

  // The tab title names the document and shows unsaved changes.
  $effect(() => {
    document.title = `${doc.dirty ? '• ' : ''}${doc.name} – ${APP_NAME}`;
    return () => (document.title = APP_NAME);
  });

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

<svelte:window
  onkeydown={onKeyDown}
  onbeforeunload={onBeforeUnload}
  oncopy={onClipboard}
  oncut={onClipboard}
  onpaste={onClipboard}
  ondragover={onDragOver}
  ondrop={onDrop}
/>
<svelte:document onfullscreenchange={() => (isFullscreen = !!document.fullscreenElement)} />

<div
  class="editor"
  class:mobile={phone.current}
  class:no-rail={!viewer.showThumbnails}
  class:no-panel={!viewer.showPanel}
>
  <a class="skip-link" href="#document-view" onclick={(e) => { e.preventDefault(); document.getElementById('document-view')?.focus(); }}>Skip to document</a>
  {#if phone.current}
    <MobileTopBar {commands} onMenu={() => (menuOpen = true)} onReveal={revealMatch} />
  {:else}
    <TitleBar onReveal={revealMatch} />
    <MenuBar {commands} />
  {/if}

  {#each doc.warnings as w, i (w)}
    <div class="warning" role="status">
      <span>{w}</span>
      <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => doc.warnings.splice(i, 1)}><X size={18} strokeWidth={1.7} aria-hidden="true" /></button>
    </div>
  {/each}

  {#if app.openWarnings.length}
    <div class="warning error" role="alert">
      <span>
        <strong>Could not open:</strong>
        {#each app.openWarnings as w, i (w.name + i)}
          <strong>{w.name}</strong> ({w.reason}){i < app.openWarnings.length - 1 ? '; ' : ''}
        {/each}
      </span>
      <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (app.openWarnings = [])}><X size={18} strokeWidth={1.7} aria-hidden="true" /></button>
    </div>
  {/if}

  {#if phone.current}
    <main class="m-canvas" id="editor-main" tabindex="-1"><CanvasView mobile /></main>
    {#if sheetVisible}
      <Sheet label="Properties" tall={!!viewer.panel}><SidePanel {commands} {actions} inSheet /></Sheet>
    {/if}
    <ToolStrip onPages={() => (pagesOpen = true)} />
    <MobileMenu {commands} open={menuOpen} onClose={() => (menuOpen = false)} />
    <PagesSheet {commands} {actions} open={pagesOpen} onClose={() => (pagesOpen = false)} />
  {:else}
    <main class="main" id="editor-main" tabindex="-1">
      {#if viewer.showThumbnails}<ThumbnailRail {commands} {actions} />{/if}
      <CanvasView>
        {#snippet toolbar()}<Toolbar {commands} />{/snippet}
      </CanvasView>
      {#if viewer.showPanel}<SidePanel {commands} {actions} />{/if}
    </main>
  {/if}

  <!-- What just happened, for screen readers (deletes move focus without anything to see). -->
  <div class="visually-hidden" aria-live="polite">{viewer.announcement}</div>

  <HelpDialog topic={help} onClose={() => (help = null)} />
  {#if compareFile}<CompareView {doc} file={compareFile} onClose={() => (compareFile = null)} />{/if}
  <SignatureDialog />
  <NewPdfDialog
    open={newPdfOpen}
    onCancel={() => (newPdfOpen = false)}
    onCreate={(s) => {
      newPdfOpen = false;
      void actions.newBlankPdf(s.width, s.height, s.pages);
    }}
  />

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
  <input
    bind:this={imageInput}
    class="visually-hidden"
    type="file"
    accept={imageAcceptAttr(heic)}
    multiple
    tabindex="-1"
    aria-hidden="true"
    onchange={(e) => onPickImages(e.currentTarget.files)}
  />
  <input
    bind:this={compareInput}
    class="visually-hidden"
    type="file"
    accept="application/pdf,.pdf"
    tabindex="-1"
    aria-hidden="true"
    onchange={(e) => {
      compareFile = e.currentTarget.files?.[0] ?? null;
      e.currentTarget.value = '';
    }}
  />
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    background: var(--bg);
  }
  /* Receives focus when the editor opens (a landmark, not a control): never draws a ring. */
  #editor-main:focus {
    outline: none;
  }
  .main {
    display: grid;
    flex: 1;
    grid-template-columns: var(--rail-width) minmax(0, 1fr) var(--panel-width);
    min-height: 0;
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
  /* Information about the open file (signed, XFA…). */
  .warning {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--surface);
    border-bottom: var(--border-width) solid var(--border);
    border-left: 4px solid var(--accent);
    font-size: var(--font-size-sm);
  }
  /* Files that could not be opened. */
  .warning.error {
    background: var(--danger-soft);
    border-left-color: var(--danger);
  }
  .warning.error strong:first-child {
    color: var(--danger);
  }
  .dismiss {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
  }
  .dismiss:hover {
    background: var(--surface-2);
  }

  .skip-link {
    position: absolute;
    left: var(--space-2);
    top: -100px;
    z-index: 1000;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--on-accent);
  }
  .skip-link:focus {
    top: var(--space-2);
  }
  .editor.mobile {
    display: flex;
    flex-direction: column;
    /* Our canvas handles pinch zoom; the page itself must not zoom. */
    touch-action: pan-x pan-y;
  }
  .m-canvas {
    position: relative;
    display: grid;
    flex: 1;
    min-height: 0;
  }

  /* Tablets and small windows: drop the side panel, then the rail. */
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
</style>
