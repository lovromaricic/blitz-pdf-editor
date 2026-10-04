<script lang="ts">
  // Areas marked for redaction on one page. Always shown while pending; while
  // the Redact panel is open, drag to mark an area and use × to remove one.
  import type { PageViewport } from 'pdfjs-dist';
  import X from '@lucide/svelte/icons/x';
  import { normRect, round, type Point, type Rect } from '../lib/annotations';
  import { useActions } from '../lib/actions.svelte';
  import type { PageRef } from '../lib/document.svelte';
  import { capturePointer } from '../lib/dom';
  import { useViewer } from '../lib/viewer.svelte';

  let { page, viewport, index }: { page: PageRef; viewport: PageViewport; index: number } = $props();

  const viewer = useViewer();
  const actions = useActions();
  const active = $derived(viewer.panel === 'redact');

  let host = $state<HTMLDivElement>();
  let drag = $state<{ pointerId: number; start: Point; end: Point } | null>(null);

  function toPdf(e: PointerEvent): Point {
    const r = host!.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    return [round(x), round(y)];
  }

  function screenBox([x0, y0, x1, y1]: Rect) {
    const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
    const [bx, by] = viewport.convertToViewportPoint(x1, y1);
    return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    e.preventDefault();
    capturePointer(host!, e.pointerId);
    const p = toPdf(e);
    drag = { pointerId: e.pointerId, start: p, end: p };
  }

  function onMove(e: PointerEvent) {
    if (drag?.pointerId === e.pointerId) drag = { ...drag, end: toPdf(e) };
  }

  function onUp(e: PointerEvent) {
    if (drag?.pointerId !== e.pointerId) return;
    const rect = normRect(drag.start, drag.end);
    drag = null;
    // Ignore clicks: at least a couple of points each way.
    if (rect[2] - rect[0] >= 2 && rect[3] - rect[1] >= 2) actions.markRedaction(page.id, rect);
  }

  const marks = $derived((page.redactions ?? []).map(screenBox));
  const draft = $derived(drag ? screenBox(normRect(drag.start, drag.end)) : null);
</script>

{#if active || marks.length}
  <div
    bind:this={host}
    class="redact"
    class:active
    role="presentation"
    onpointerdown={active ? onDown : undefined}
    onpointermove={active ? onMove : undefined}
    onpointerup={active ? onUp : undefined}
    onpointercancel={() => (drag = null)}
  >
    {#each marks as m, k (k)}
      <div class="mark" style:left="{m.left}px" style:top="{m.top}px" style:width="{m.width}px" style:height="{m.height}px">
        {#if active}
          <button
            type="button"
            class="remove"
            aria-label="Remove redaction mark {k + 1} on page {index + 1}"
            onclick={() => actions.removeRedaction(page.id, k)}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        {/if}
      </div>
    {/each}
    {#if draft}
      <div class="mark draft" style:left="{draft.left}px" style:top="{draft.top}px" style:width="{draft.width}px" style:height="{draft.height}px"></div>
    {/if}
  </div>
{/if}

<style>
  .redact {
    position: absolute;
    inset: 0;
    z-index: 8;
    pointer-events: none;
  }
  .redact.active {
    pointer-events: auto;
    cursor: crosshair;
    touch-action: none;
  }
  .mark {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid var(--redact-mark);
    background: var(--redact-mark-fill);
  }
  .mark.draft {
    border-style: dashed;
  }
  .remove {
    position: absolute;
    top: -11px;
    right: -11px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--redact-mark);
    color: var(--on-accent);
    cursor: pointer;
    pointer-events: auto;
  }
  .remove:hover {
    background: var(--danger);
  }
  @media (pointer: coarse) {
    .remove::after {
      /* A 44px touch target around the small visible button. */
      content: '';
      position: absolute;
      inset: -11px;
    }
  }
</style>
