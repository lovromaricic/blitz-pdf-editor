<script lang="ts">
  // Compare two PDFs: the open document (as edited) next to another file, with
  // the words that differ highlighted, a list of changes, and synced scrolling.
  // Compares text only; everything stays on this device.
  import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist';
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import X from '@lucide/svelte/icons/x';
  import { diffWords, readPages, type ComparePage } from '../../lib/compare';
  import { hunkKind, type Hunk, type Word } from '../../lib/compare-diff';
  import { openWithPassword, type EditorDocument } from '../../lib/document.svelte';
  import { readPdfFiles } from '../../lib/files';
  import { friendlyError } from '../../lib/friendly-error';
  import { askPassword } from '../../lib/open-files.svelte';
  import { ICON } from '../tools';
  import ComparePageView, { type Mark } from './ComparePageView.svelte';

  let { doc, file, onClose }: { doc: EditorDocument; file: File; onClose: () => void } = $props();

  const GAP = 16;
  /** The change list shows this many; the arrows still step through all of them. */
  const LIST_LIMIT = 500;

  interface Side {
    name: string;
    pages: ComparePage[];
    viewports: PageViewport[];
    words: Word[];
  }

  let dialog: HTMLDialogElement;
  let status = $state<{ state: 'loading'; text: string } | { state: 'error'; text: string } | { state: 'ready' }>({
    state: 'loading',
    text: 'Reading the documents…',
  });
  let a = $state.raw<Side | null>(null);
  let b = $state.raw<Side | null>(null);
  let hunks = $state.raw<Hunk[]>([]);
  let active = $state(-1);
  let sync = $state(true);
  /** Phones show one document at a time. */
  const phone = new MediaQuery('(max-width: 720px)');
  let shown = $state<'a' | 'b'>('a');

  const controller = new AbortController();
  let other: PDFDocumentProxy | null = null;

  onMount(() => {
    dialog.showModal();
    void load();
    return () => {
      controller.abort();
      void other?.loadingTask.destroy();
    };
  });

  async function load() {
    const signal = controller.signal;
    try {
      // svelte-ignore state_referenced_locally (fixed for this view)
      const intake = await readPdfFiles([file]);
      if (!intake.accepted.length) throw new Error(intake.rejected[0]?.reason ?? 'This file could not be opened.');
      other = (await openWithPassword(intake.accepted[0], askPassword)).pdf;
      signal.throwIfAborted();

      const pagesA: ComparePage[] = doc.pages.map((p) => ({ pdf: doc.source(p).pdf, index: p.sourceIndex, rotation: p.rotation }));
      const pagesB: ComparePage[] = Array.from({ length: other.numPages }, (_, i) => ({ pdf: other!, index: i, rotation: 0 }));
      const total = pagesA.length + pagesB.length;
      let done = 0;
      const tick = () => (status = { state: 'loading', text: `Reading text… ${Math.round((++done / total) * 100)}%` });
      const readA = await readPages(pagesA, signal, tick);
      const readB = await readPages(pagesB, signal, tick);
      a = { name: doc.name, pages: pagesA, ...readA };
      b = { name: intake.accepted[0].name, pages: pagesB, ...readB };

      if (!readA.words.length || !readB.words.length) {
        status = { state: 'ready' };
        return;
      }
      status = { state: 'loading', text: 'Comparing…' };
      hunks = await diffWords(readA.words, readB.words, signal);
      status = { state: 'ready' };
    } catch (e) {
      if (signal.aborted) return;
      status = { state: 'error', text: friendlyError(e) };
    }
  }

  // --- Highlights ---------------------------------------------------------------

  /** Marks per page for one side: removed words on the left, added words on the right. */
  function marksFor(side: Side | null, which: 'a' | 'b'): Mark[][] {
    if (!side) return [];
    const out: Mark[][] = side.pages.map(() => []);
    hunks.forEach((h, k) => {
      const [start, end] = which === 'a' ? [h.aStart, h.aEnd] : [h.bStart, h.bEnd];
      for (let i = start; i < end; i++) out[side.words[i].page].push({ rect: side.words[i].rect, hunk: k });
    });
    return out;
  }
  const marksA = $derived(marksFor(a, 'a'));
  const marksB = $derived(marksFor(b, 'b'));

  /** Where a change sits on one side: its first word, or the word next to where it would be. */
  function anchor(side: Side, start: number, end: number): Word | undefined {
    return side.words[start < end ? start : Math.max(0, start - 1)] ?? side.words[0];
  }

  function snippet(side: Side, start: number, end: number) {
    const text = side.words
      .slice(start, Math.min(end, start + 12))
      .map((w) => w.text)
      .join(' ');
    return end - start > 12 ? `${text}…` : text;
  }

  const changes = $derived(
    a && b
      ? hunks.slice(0, LIST_LIMIT).map((h, k) => {
          const kind = hunkKind(h);
          const page = (kind === 'added' ? anchor(b!, h.bStart, h.bEnd)!.page : anchor(a!, h.aStart, h.aEnd)!.page) + 1;
          return { k, kind, page, before: snippet(a!, h.aStart, h.aEnd), after: snippet(b!, h.bStart, h.bEnd) };
        })
      : [],
  );

  // --- Layout and scrolling -------------------------------------------------

  let colA = $state<HTMLElement>();
  let colB = $state<HTMLElement>();
  let widthA = $state(0);
  let widthB = $state(0);

  function layout(side: Side | null, colWidth: number) {
    if (!side) return { tops: [], heights: [], width: 0, total: 0 };
    const width = Math.max(100, colWidth - 2 * GAP);
    const tops: number[] = [];
    const heights: number[] = [];
    let y = GAP;
    for (const vp of side.viewports) {
      const h = Math.round((vp.height * width) / vp.width);
      tops.push(y);
      heights.push(h);
      y += h + GAP;
    }
    return { tops, heights, width, total: y };
  }
  const layA = $derived(layout(a, widthA));
  const layB = $derived(layout(b, widthB));

  /** Scroll events caused by syncing are ignored until this time. */
  let quietUntil = 0;

  function onScroll(from: 'a' | 'b') {
    if (!sync || performance.now() < quietUntil || phone.current) return;
    const [src, dst, ls, ld] = from === 'a' ? [colA, colB, layA, layB] : [colB, colA, layB, layA];
    if (!src || !dst || !ld.tops.length) return;
    // Same page and the same position within it.
    const y = src.scrollTop + GAP;
    let i = 0;
    while (i + 1 < ls.tops.length && ls.tops[i + 1] <= y) i++;
    const frac = Math.min(1, Math.max(0, (y - ls.tops[i]) / ls.heights[i]));
    const j = Math.min(i, ld.tops.length - 1);
    quietUntil = performance.now() + 80;
    dst.scrollTop = ld.tops[j] + frac * ld.heights[j] - GAP;
  }

  function reveal(side: Side, col: HTMLElement | undefined, lay: ReturnType<typeof layout>, word: Word | undefined) {
    if (!col || !word) return;
    const vp = side.viewports[word.page];
    const scale = lay.width / vp.width;
    const [, y1] = vp.clone({ scale }).convertToViewportPoint(word.rect[0], word.rect[3]);
    col.scrollTop = lay.tops[word.page] + y1 - col.clientHeight / 3;
  }

  function go(k: number) {
    if (!a || !b || !hunks.length) return;
    active = (k + hunks.length) % hunks.length;
    const h = hunks[active];
    quietUntil = performance.now() + 150;
    reveal(a, colA, layA, anchor(a, h.aStart, h.aEnd));
    reveal(b, colB, layB, anchor(b, h.bStart, h.bEnd));
    document.getElementById(`change-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  const KIND_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed' };
  const noText = $derived(status.state === 'ready' && a && b && (!a.words.length || !b.words.length));
</script>

<dialog bind:this={dialog} class="compare" aria-labelledby="compare-title" onclose={onClose}>
  <header class="bar">
    <h2 id="compare-title">Compare</h2>
    {#if status.state === 'ready' && !noText}
      <p class="count" role="status">
        {#if hunks.length === 0}
          No differences in the text
        {:else if active >= 0}
          Change {active + 1} of {hunks.length}
        {:else}
          {hunks.length} {hunks.length === 1 ? 'change' : 'changes'}
        {/if}
      </p>
      {#if hunks.length}
        <div class="nav">
          <button type="button" class="icon-btn" aria-label="Previous change" onclick={() => go(active - 1)}>
            <ChevronUp size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn" aria-label="Next change" onclick={() => go(active + 1)}>
            <ChevronDown size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if !phone.current}
        <label class="sync"><input type="checkbox" bind:checked={sync} /> Scroll together</label>
      {/if}
    {/if}
    <button type="button" class="icon-btn close" aria-label="Close compare" onclick={() => dialog.close()}>
      <X size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
    </button>
  </header>

  {#if status.state === 'loading'}
    <p class="message" role="status">{status.text}</p>
  {:else if status.state === 'error'}
    <div class="message"><p class="card card-error" role="alert">{status.text}</p></div>
  {:else if a && b}
    {#if noText}
      <div class="message">
        <p class="card" role="status">
          {#if !a.words.length && !b.words.length}Neither document{:else if !a.words.length}The open document{:else}{b.name}{/if}
          has any text to compare: it looks like a scan. Run Tools › Make text searchable (OCR) on it first, then compare again.
        </p>
      </div>
    {/if}
    {#if phone.current}
      <div class="segmented" role="radiogroup" aria-label="Document shown">
        <button type="button" role="radio" aria-checked={shown === 'a'} onclick={() => (shown = 'a')}>Open document</button>
        <button type="button" role="radio" aria-checked={shown === 'b'} onclick={() => (shown = 'b')}>Other file</button>
      </div>
    {/if}
    <div class="body" class:phone={phone.current}>
      {#if !phone.current && hunks.length}
        <nav class="changes" aria-label="Changes">
          <ol>
            {#each changes as c (c.k)}
              <li>
                <button type="button" id="change-{c.k}" class:active={c.k === active} aria-current={c.k === active} onclick={() => go(c.k)}>
                  <span class="meta">{KIND_LABEL[c.kind]} · page {c.page}</span>
                  {#if c.before}<del>{c.before}</del>{/if}
                  {#if c.after}<ins>{c.after}</ins>{/if}
                </button>
              </li>
            {/each}
          </ol>
          {#if hunks.length > LIST_LIMIT}<p class="more">Showing the first {LIST_LIMIT}. Use the arrows to see the rest.</p>{/if}
        </nav>
      {/if}
      {#each [{ id: 'a' as const, side: a, lay: layA, marks: marksA, kind: 'removed' as const }, { id: 'b' as const, side: b, lay: layB, marks: marksB, kind: 'added' as const }] as c (c.id)}
        {#if !phone.current || shown === c.id}
          <div class="col">
            <h3 class="col-name"><span class="swatch {c.kind}" aria-hidden="true"></span>{c.side.name}</h3>
            {#if c.id === 'a'}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be focusable to scroll by keyboard) -->
              <div class="scroll" bind:this={colA} bind:clientWidth={widthA} onscroll={() => onScroll('a')} tabindex="0" role="region" aria-label="{c.side.name}">
                {@render pages(c.side, c.lay, c.marks, c.kind, colA)}
              </div>
            {:else}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be focusable to scroll by keyboard) -->
              <div class="scroll" bind:this={colB} bind:clientWidth={widthB} onscroll={() => onScroll('b')} tabindex="0" role="region" aria-label="{c.side.name}">
                {@render pages(c.side, c.lay, c.marks, c.kind, colB)}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</dialog>

{#snippet pages(side: Side, lay: ReturnType<typeof layout>, marks: Mark[][], kind: 'removed' | 'added', root: HTMLElement | undefined)}
  <div class="track" style:height="{lay.total}px">
    {#if root && lay.width > 0}
      {#each side.pages as page, i (i)}
        <ComparePageView
          {page}
          viewport1={side.viewports[i]}
          top={lay.tops[i]}
          width={lay.width}
          marks={marks[i] ?? []}
          {kind}
          activeHunk={active}
          {root}
          label="Page {i + 1}"
        />
      {/each}
    {/if}
  </div>
{/snippet}

<style>
  .compare {
    width: 100vw;
    max-width: none;
    height: 100vh;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--bg);
    color: var(--text);
  }
  .compare[open] {
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--titlebar-height);
    padding: 0 var(--space-3) 0 var(--space-4);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 700;
  }
  .count {
    margin: 0 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-size-sm);
  }
  .nav {
    display: flex;
    gap: var(--space-1);
  }
  .sync {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }
  .close {
    margin-left: auto;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
  }
  .icon-btn:hover {
    background: var(--surface-2);
  }
  .message {
    margin: 0;
    padding: var(--space-6) var(--space-4);
    color: var(--muted);
    text-align: center;
  }
  .message .card {
    max-width: 36rem;
    margin: 0 auto;
    color: var(--text);
    text-align: left;
  }
  .body {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    min-height: 0;
  }
  .body:has(.changes) {
    grid-template-columns: var(--panel-width) minmax(0, 1fr) minmax(0, 1fr);
  }
  .body.phone {
    grid-template-columns: minmax(0, 1fr);
  }
  .changes {
    overflow-y: auto;
    border-right: var(--border-width) solid var(--border);
    background: var(--surface);
  }
  .changes ol {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
  }
  .changes button {
    display: grid;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-size: var(--font-size-sm);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .changes button:hover {
    background: var(--surface-2);
  }
  .changes button.active {
    background: var(--accent-soft);
  }
  .meta {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-weight: 600;
  }
  .changes button.active .meta {
    color: var(--accent-strong);
  }
  del,
  ins {
    padding: 0 2px;
    border-radius: 2px;
    text-decoration: none;
  }
  del {
    background: var(--diff-removed);
  }
  ins {
    background: var(--diff-added);
  }
  .more {
    margin: 0;
    padding: var(--space-2) var(--space-4) var(--space-4);
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  .col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--canvas);
  }
  .col + .col {
    border-left: var(--border-width) solid var(--border);
  }
  .col-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
    font-size: var(--font-size-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .swatch {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .swatch.removed {
    background: var(--diff-removed);
  }
  .swatch.added {
    background: var(--diff-added);
  }
  .scroll {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .scroll:focus-visible {
    outline: var(--focus-ring);
    outline-offset: -2px;
  }
  .track {
    position: relative;
  }
  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
  }
  .segmented button {
    min-height: var(--touch-target);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: var(--font-size-sm);
  }
  .segmented button[aria-checked='true'] {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  @media (max-width: 720px), (pointer: coarse) {
    .icon-btn {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
