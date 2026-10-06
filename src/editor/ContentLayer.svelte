<script lang="ts">
  // The PDF's own content on one page while the Edit content tool is on: each
  // text block and image is a target (outlined on hover, with a short label
  // after a moment; selected on click, Shift+click adds). Our own objects sit
  // above this layer and keep precedence. Geometry comes from the content
  // worker's analysis, in PDF space, converted with the page's viewport, so
  // rotation and zoom need no special cases.
  import type { PageViewport } from 'pdfjs-dist';
  import type { PageRef } from '../lib/document.svelte';
  import type { ContentItem } from '../lib/content-editing.svelte';
  import { useActions } from '../lib/actions.svelte';
  import { useViewer } from '../lib/viewer.svelte';
  import { CONTENT_STRINGS as S } from '../lib/strings';

  let { page, viewport }: { page: PageRef; viewport: PageViewport } = $props();

  const viewer = useViewer();
  const actions = useActions();

  const active = $derived(viewer.tool === 'content');
  const source = $derived(viewer.doc.source(page));

  // Analyze the page (in the worker) when the tool is on and the page is shown.
  $effect(() => {
    if (!active || !source) return;
    viewer.content.request(source, page.sourceIndex);
    void viewer.content.checkLock(source);
  });

  const analysis = $derived(active && source ? viewer.content.get(source, page.sourceIndex) : undefined);
  const locked = $derived(!!source && viewer.content.locked.get(source.id) === true);
  /** Images first (drawn below), then text blocks in reading order. */
  const items = $derived.by((): ContentItem[] => {
    if (!analysis || typeof analysis !== 'object' || analysis.status !== 'ok' || locked) return [];
    return [...analysis.items].sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'image' ? -1 : 1));
  });
  const note = $derived.by(() => {
    if (!active) return null;
    if (locked) return S.restricted;
    if (analysis === 'failed' || (typeof analysis === 'object' && analysis.status === 'unreadable')) return S.unreadable;
    if (typeof analysis !== 'object') return null;
    if (analysis.scan) return S.scan;
    if (!analysis.items.length) return S.nothing;
    return null;
  });
  const selected = $derived(viewer.contentSelection?.pageId === page.id ? viewer.contentSelection.ids : []);

  /** An item's box on screen: its quad's corners through the viewport. */
  function box(item: ContentItem) {
    const [p0, p1, , p3] = item.quad.map(([x, y]) => viewport.convertToViewportPoint(x, y) as [number, number]);
    return {
      left: p3[0],
      top: p3[1],
      width: Math.max(1, Math.hypot(p1[0] - p0[0], p1[1] - p0[1])),
      height: Math.max(1, Math.hypot(p3[0] - p0[0], p3[1] - p0[1])),
      angle: (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI,
    };
  }

  const describe = (item: ContentItem) => (item.kind === 'text' ? S.hitText(item.text ?? '') : S.hitImage(item.width ?? 0, item.height ?? 0));

  function select(item: ContentItem, add: boolean) {
    const ids = add && selected.length ? (selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id]) : [item.id];
    viewer.selectContent(ids.length ? { pageId: page.id, ids } : null);
  }

  function onDown(e: PointerEvent, item: ContentItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(item, e.shiftKey);
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    e.preventDefault();
  }

  function onMenu(e: MouseEvent, item: ContentItem) {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.includes(item.id)) select(item, false);
    viewer.contextMenu = { x: e.clientX, y: e.clientY, pageId: page.id, objectId: null, point: null, contentId: item.id };
  }

  function onKey(e: KeyboardEvent, item: ContentItem) {
    if (e.key === 'Enter' && item.kind === 'text') {
      void actions.enterContentEditing({ pageId: page.id, itemId: item.id, edit: true });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selected.includes(item.id)) select(item, false);
      void actions.deleteContent();
    } else if (e.key === 'Escape' && viewer.leaveContentTool()) {
      viewer.announce('Edit content closed');
    } else if (e.key === 'Escape' && selected.length) {
      viewer.selectContent(null);
      viewer.announce('Selection cleared');
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // --- Hover: an outline at once, the label after a moment ---------------------------

  let hovered = $state<string | null>(null);
  let labelled = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function enter(item: ContentItem) {
    hovered = item.id;
    clearTimeout(timer);
    timer = setTimeout(() => (labelled = item.id), 500);
  }
  function leave(item: ContentItem) {
    if (hovered === item.id) hovered = null;
    clearTimeout(timer);
    labelled = null;
  }
  const label = $derived.by(() => {
    const item = items.find((i) => i.id === labelled);
    if (!item) return null;
    const pts = item.quad.map(([x, y]) => viewport.convertToViewportPoint(x, y) as [number, number]);
    return { text: item.kind === 'text' ? S.textBlock : S.image, x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])) };
  });
</script>

{#if active}
  <!-- A click on the page outside any content clears the selection. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="content-layer"
    onpointerdown={(e) => {
      // Entered by a double-click: an empty spot goes back to the tool before. Else it clears the selection.
      if (e.button === 0 && e.target === e.currentTarget && !viewer.leaveContentTool()) viewer.selectContent(null);
    }}
  >
    {#each items as item (item.id)}
      {@const b = box(item)}
      <div
        class="content-hit"
        class:hovered={hovered === item.id}
        class:selected={selected.includes(item.id)}
        role="button"
        tabindex="0"
        data-content-id={item.id}
        data-kind={item.kind}
        aria-label={item.blocked ? `${describe(item)}. ${item.blocked}` : describe(item)}
        aria-pressed={selected.includes(item.id)}
        aria-describedby={item.blocked ? undefined : item.convert ? `content-hint-edit-${page.id}` : `content-hint-${page.id}`}
        style:left="{b.left}px"
        style:top="{b.top}px"
        style:width="{b.width}px"
        style:height="{b.height}px"
        style:transform="rotate({b.angle}deg)"
        onpointerdown={(e) => onDown(e, item)}
        onpointerenter={() => enter(item)}
        onpointerleave={() => leave(item)}
        oncontextmenu={(e) => onMenu(e, item)}
        onkeydown={(e) => onKey(e, item)}
        ondblclick={(e) => {
          if (item.kind === 'text') void actions.enterContentEditing({ pageId: page.id, itemId: item.id, caret: [e.clientX, e.clientY], edit: true });
        }}
        onfocus={() => !selected.includes(item.id) && select(item, false)}
      ></div>
    {/each}
    <span class="visually-hidden" id="content-hint-{page.id}">{S.hitHint}</span>
    <span class="visually-hidden" id="content-hint-edit-{page.id}">{S.hitHintEdit}</span>
    {#if label}
      <span class="content-label" aria-hidden="true" style:left="{label.x}px" style:top="{label.y}px">{label.text}</span>
    {/if}
    {#if note}
      <p class="content-note" role="status">{note}</p>
    {/if}
  </div>
{/if}

<style>
  .content-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
  }
  .content-hit {
    position: absolute;
    box-sizing: border-box;
    transform-origin: 0 0;
    border-radius: 2px;
    cursor: pointer;
    outline: none;
  }
  .content-hit.hovered {
    outline: 1px dashed var(--accent);
    outline-offset: 2px;
  }
  /* Selected and keyboard focus look the same: one ring. */
  .content-hit.selected,
  .content-hit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .content-label {
    position: absolute;
    transform: translateY(calc(-100% - 6px));
    padding: 2px var(--space-2);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-size-xs);
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
  }
  .content-note {
    position: absolute;
    top: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 2 * var(--space-4));
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-size-sm);
    text-align: center;
    pointer-events: none;
  }
</style>
