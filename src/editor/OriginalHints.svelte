<script module lang="ts">
  /** The tip shows once per session (memory only, nothing is stored). */
  let tipShown = false;
</script>

<script lang="ts">
  // With the Select tool: hints that the PDF's own content can be edited.
  // - Over text blocks the page's analysis has already found, the text cursor
  //   (between words too). Nothing is analyzed just for this.
  // - Once per session, after resting on the PDF's text for about a second,
  //   a tip: "Double-click text or an image to edit it". Any action hides it;
  //   it never takes input.
  import type { PageViewport } from 'pdfjs-dist';
  import type { PageRef } from '../lib/document.svelte';
  import { useViewer } from '../lib/viewer.svelte';
  import { CONTENT_STRINGS as S } from '../lib/strings';

  let { page, viewport }: { page: PageRef; viewport: PageViewport } = $props();
  const viewer = useViewer();

  let anchor: HTMLSpanElement;
  let tip = $state<{ x: number; y: number } | null>(null);

  const OWN = '.annot, .handle, .rich-editor, .crop-mode, .content-layer, input, textarea, select, button';

  $effect(() => {
    if (viewer.tool !== 'select') return;
    const host = anchor.parentElement!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let at = { x: 0, y: 0 };

    const inTextBlock = (e: PointerEvent) => {
      const a = viewer.content.get(viewer.doc.source(page), page.sourceIndex);
      if (!a || typeof a !== 'object') return false;
      const r = host.getBoundingClientRect();
      const [x, y] = viewport.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      return a.items.some((i) => {
        if (i.kind !== 'text') return false;
        const xs = i.quad.map((p) => p[0]);
        const ys = i.quad.map((p) => p[1]);
        return x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys);
      });
    };

    const onMove = (e: PointerEvent) => {
      const t = e.target as Element;
      at = { x: e.clientX, y: e.clientY };
      if (t.closest(OWN)) {
        host.style.cursor = '';
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      host.style.cursor = inTextBlock(e) ? 'text' : '';
      if (tipShown || e.pointerType === 'touch') return;
      const onText = !!t.closest('.textLayer span');
      if (!onText) {
        clearTimeout(timer);
        timer = undefined;
      } else if (!timer) {
        timer = setTimeout(() => {
          if (tipShown) return;
          tipShown = true;
          tip = { x: at.x, y: at.y };
        }, 1000);
      }
    };
    const onLeave = () => {
      host.style.cursor = '';
      clearTimeout(timer);
      timer = undefined;
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      onLeave();
    };
  });

  // Any action hides the tip.
  $effect(() => {
    if (!tip) return;
    const hide = () => (tip = null);
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll'] as const;
    for (const ev of events) window.addEventListener(ev, hide, { capture: true, passive: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, hide, { capture: true });
    };
  });
  $effect(() => {
    if (viewer.tool !== 'select') tip = null;
  });
</script>

<span bind:this={anchor} hidden></span>
{#if tip}
  <div class="tip" role="status" style:left="{tip.x}px" style:top="{tip.y}px">{S.tip}</div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 30;
    transform: translate(12px, 16px);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-overlay);
    color: var(--text);
    font-size: var(--font-size-sm);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
