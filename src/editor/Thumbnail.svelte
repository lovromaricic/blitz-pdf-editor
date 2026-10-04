<script lang="ts">
  import type { PageRef } from '../lib/document.svelte';
  import { releaseCanvas, renderToCanvas, thumbnailQueue, viewportFor } from '../lib/pdf/render';
  import { useViewer } from '../lib/viewer.svelte';

  let {
    page,
    index,
    scale,
    width,
    height,
    current,
    onSelect,
  }: {
    page: PageRef;
    index: number;
    scale: number;
    width: number;
    height: number;
    current: boolean;
    onSelect: () => void;
  } = $props();

  const viewer = useViewer();
  let host: HTMLSpanElement;
  let canvas: HTMLCanvasElement | null = null;
  let rendered = $state(false);

  $effect(() => {
    const rotation = page.rotation;
    const s = scale;
    const signal = { cancelled: false };
    let cancelRender: (() => void) | undefined;

    (async () => {
      const release = await thumbnailQueue.acquire(signal);
      if (!release) return;
      try {
        const pdfPage = await viewer.doc.source(page).pdf.getPage(page.sourceIndex + 1);
        if (signal.cancelled) return;
        const handle = renderToCanvas(pdfPage, viewportFor(pdfPage, s, rotation));
        cancelRender = handle.cancel;
        const next = await handle.promise;
        if (!next || signal.cancelled) return;
        if (canvas) host.replaceChild(next, canvas);
        else host.appendChild(next);
        releaseCanvas(canvas);
        canvas = next;
        rendered = true;
      } catch {
        // Leave the placeholder; the main view reports render errors.
      } finally {
        release();
      }
    })();

    return () => {
      signal.cancelled = true;
      cancelRender?.();
    };
  });

  $effect(() => () => {
    releaseCanvas(canvas);
    canvas = null;
  });
</script>

<button
  type="button"
  class="thumb"
  class:current
  aria-label="Page {index + 1}"
  aria-current={current ? 'page' : undefined}
  onclick={onSelect}
>
  <span class="frame" style:width="{width}px" style:height="{height}px">
    <span class="canvas-host" bind:this={host}></span>
    {#if !rendered}<span class="placeholder" aria-hidden="true"></span>{/if}
  </span>
  <span class="num" aria-hidden="true">{index + 1}</span>
</button>

<style>
  .thumb {
    display: grid;
    justify-items: center;
    gap: 2px;
    width: 100%;
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
  }
  .frame {
    position: relative;
    display: block;
    background: #fff;
    box-shadow: 0 0 0 1px var(--color-border);
  }
  .thumb:hover .frame {
    box-shadow: 0 0 0 2px var(--color-border-strong);
  }
  .thumb.current .frame {
    box-shadow: 0 0 0 3px var(--color-accent);
  }
  .canvas-host,
  .placeholder {
    position: absolute;
    inset: 0;
  }
  .canvas-host :global(canvas) {
    display: block;
  }
  .placeholder {
    background: var(--color-surface);
  }
  .num {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    line-height: 16px;
  }
  .thumb.current .num {
    color: var(--color-text);
    font-weight: 600;
  }
</style>
