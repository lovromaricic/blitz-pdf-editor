<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { PageRef } from '../lib/document.svelte';
  import { releaseCanvas, renderToCanvas, thumbnailQueue, viewportFor } from '../lib/pdf/render';
  import { useViewer } from '../lib/viewer.svelte';
  import type { PageViewport } from 'pdfjs-dist';
  import AnnotationPreview from './AnnotationPreview.svelte';
  import DecorationLayer from './DecorationLayer.svelte';

  let {
    page,
    index,
    scale,
    width,
    height,
    current,
    selected,
    dimmed = false,
    ...rest
  }: {
    page: PageRef;
    index: number;
    scale: number;
    width: number;
    height: number;
    current: boolean;
    selected: boolean;
    dimmed?: boolean;
  } & HTMLButtonAttributes = $props();

  const viewer = useViewer();
  // Crop: draw the whole page at thumbnail scale and shift it under the clipping frame.
  const full = $derived(viewer.doc.fullDisplaySize(page));
  const crop = $derived(viewer.doc.displayedCrop(page));
  let host: HTMLSpanElement;
  let canvas: HTMLCanvasElement | null = null;
  let rendered = $state(false);
  let viewport = $state.raw<PageViewport | null>(null);

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
        const vp = viewportFor(pdfPage, s, rotation);
        viewport = vp;
        const handle = renderToCanvas(pdfPage, vp);
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
  class:selected
  class:dimmed
  aria-label="Page {index + 1}{page.rotation ? `, rotated ${page.rotation}°` : ''}"
  aria-current={current ? 'page' : undefined}
  aria-pressed={selected}
  data-thumb-index={index}
  {...rest}
>
  <span class="frame" style:width="{width}px" style:height="{height}px">
    <span
      class="canvas-host"
      bind:this={host}
      style:width="{full.width * scale}px"
      style:height="{full.height * scale}px"
      style:transform={page.crop ? `translate(${-crop.left * scale}px, ${-crop.top * scale}px)` : undefined}
    >
      {#if viewport && page.annots?.length}<AnnotationPreview annots={page.annots} {viewport} />{/if}
    </span>
    {#if viewer.fontsReady}
      {@const deco = viewer.decorationFor(page)}
      {#if deco}<DecorationLayer {deco} {width} {height} {scale} />{/if}
    {/if}
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
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  .frame {
    position: relative;
    display: block;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 0 0 1px var(--color-border);
  }
  .thumb:hover .frame {
    box-shadow: 0 0 0 2px var(--color-border-strong);
  }
  .thumb.selected {
    background: var(--color-active-bg);
  }
  .thumb.current .frame {
    box-shadow: 0 0 0 3px var(--color-accent);
  }
  .thumb.dimmed {
    opacity: 0.35;
  }
  .canvas-host {
    position: absolute;
    top: 0;
    left: 0;
  }
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
