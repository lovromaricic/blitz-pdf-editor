<script lang="ts">
  import { TextLayer, type PDFPageProxy } from 'pdfjs-dist';
  import type { PageRef } from '../lib/document.svelte';
  import { releaseCanvas, renderToCanvas, viewportFor } from '../lib/pdf/render';
  import { useViewer } from '../lib/viewer.svelte';
  import AnnotationLayer from './AnnotationLayer.svelte';
  import FormLayer from './FormLayer.svelte';
  import DecorationLayer from './DecorationLayer.svelte';

  let {
    page,
    index,
    top,
    left,
    width,
    height,
  }: { page: PageRef; index: number; top: number; left: number; width: number; height: number } = $props();

  const viewer = useViewer();
  const doc = viewer.doc;

  let canvasHost: HTMLDivElement;
  let textHost: HTMLDivElement;
  let pdfPage = $state.raw<PDFPageProxy | null>(null);
  let failed = $state(false);
  let rendered = $state(false);
  let canvas: HTMLCanvasElement | null = null;

  $effect(() => {
    let alive = true;
    doc
      .source(page)
      .pdf.getPage(page.sourceIndex + 1)
      .then((p) => alive && (pdfPage = p))
      .catch(() => alive && (failed = true));
    return () => {
      alive = false;
    };
  });

  const viewport = $derived(pdfPage ? viewportFor(pdfPage, viewer.scale, page.rotation) : null);
  /** Cropped-away margins on screen, in CSS px. The full page is drawn and shifted under a clip. */
  const offset = $derived.by(() => {
    if (viewer.cropPreview) return { x: 0, y: 0 };
    const m = doc.displayedCrop(page);
    return { x: m.left * viewer.scale, y: m.top * viewer.scale };
  });

  // Render the canvas, then the text layer. Re-renders (zoom, rotate) are debounced and
  // keep the old bitmap stretched in place until the new one is ready.
  $effect(() => {
    const p = pdfPage;
    const vp = viewport;
    if (!p || !vp) return;

    let cancelled = false;
    let renderHandle: ReturnType<typeof renderToCanvas> | null = null;
    let textLayer: TextLayer | null = null;

    const timer = setTimeout(
      async () => {
        // Interactive fields are drawn by the form layer; flattened pages show values on the canvas.
        renderHandle = renderToCanvas(p, vp, page.flattenForm ? 'values' : 'forms');
        try {
          const next = await renderHandle.promise;
          if (!next || cancelled) return;
          if (canvas) canvasHost.replaceChild(next, canvas);
          else canvasHost.appendChild(next);
          releaseCanvas(canvas);
          canvas = next;
          rendered = true;
          failed = false;

          textHost.replaceChildren();
          textLayer = new TextLayer({
            textContentSource: p.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
            container: textHost,
            viewport: vp,
          });
          await textLayer.render();
          if (!cancelled) {
            const end = document.createElement('div');
            end.className = 'endOfContent';
            textHost.append(end);
          }
        } catch {
          if (!cancelled) failed = true;
        }
      },
      canvas ? 80 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      renderHandle?.cancel();
      textLayer?.cancel();
    };
  });

  $effect(() => () => {
    releaseCanvas(canvas);
    canvas = null;
    pdfPage?.cleanup();
  });

  const highlights = $derived.by(() => {
    const vp = viewport;
    const search = viewer.search;
    if (!vp || search.matches.length === 0) return [];
    const out: { left: number; top: number; width: number; height: number; active: boolean }[] = [];
    search.matches.forEach((m, mi) => {
      if (m.pageId !== page.id) return;
      for (const quad of m.quads) {
        const pts = quad.map(([x, y]) => vp.convertToViewportPoint(x, y));
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        out.push({ left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top, active: mi === search.active });
      }
    });
    return out;
  });
</script>

<div
  class="page"
  class:loading={!rendered}
  style:top="{top}px"
  style:left="{left}px"
  style:width="{width}px"
  style:height="{height}px"
  style:--total-scale-factor={viewport?.scale ?? 1}
  data-index={index}
  role="region"
  aria-label="Page {index + 1}"
>
  <div
    class="inner"
    style:width="{viewport?.width ?? width}px"
    style:height="{viewport?.height ?? height}px"
    style:transform={page.crop && !viewer.cropPreview ? `translate(${-offset.x}px, ${-offset.y}px)` : undefined}
  >
  <div class="canvas-host" bind:this={canvasHost}></div>
  {#if highlights.length}
    <div class="highlights" aria-hidden="true">
      {#each highlights as h, k (k)}
        <div
          class="hit"
          class:active={h.active}
          style:left="{h.left}px"
          style:top="{h.top}px"
          style:width="{h.width}px"
          style:height="{h.height}px"
        ></div>
      {/each}
    </div>
  {/if}
  <div class="textLayer" bind:this={textHost}></div>
  {#if viewport && pdfPage}<FormLayer {pdfPage} {viewport} {page} source={doc.source(page)} />{/if}
  {#if viewport}<AnnotationLayer {page} {viewport} />{/if}
  </div>
  {#if viewer.fontsReady && !viewer.cropPreview}
    {@const deco = viewer.decorationFor(page)}
    {#if deco}<DecorationLayer {deco} {width} {height} scale={viewer.scale} />{/if}
  {/if}
  {#if viewer.cropPreview?.ids.has(page.id)}
    {@const m = viewer.cropPreview.margins}
    {@const s = viewer.scale}
    <div
      class="crop-keep"
      aria-hidden="true"
      style:left="{m.left * s}px"
      style:top="{m.top * s}px"
      style:right="{m.right * s}px"
      style:bottom="{m.bottom * s}px"
    ></div>
  {/if}
  {#if failed}
    <p class="error">This page could not be displayed.</p>
  {:else if !rendered}
    <p class="placeholder" aria-hidden="true">{index + 1}</p>
  {/if}
</div>

<style>
  .page {
    position: absolute;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  }
  .page {
    overflow: hidden;
  }
  .inner {
    position: absolute;
    top: 0;
    left: 0;
  }
  .canvas-host {
    position: absolute;
    inset: 0;
  }
  .canvas-host :global(canvas) {
    display: block;
  }
  .highlights {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }
  .hit {
    position: absolute;
    background: rgb(0 0 0 / 0.18);
    border-radius: 2px;
  }
  .hit.active {
    background: rgb(0 0 0 / 0.38);
    outline: 2px solid var(--color-accent);
  }
  .textLayer {
    z-index: 2;
  }
  .crop-keep {
    position: absolute;
    z-index: 3;
    outline: 2px dashed var(--color-accent);
    /* Shade everything outside the kept area. */
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.35);
    pointer-events: none;
  }
  .placeholder,
  .error {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
  .placeholder {
    font-size: var(--font-size-xl);
    opacity: 0.4;
  }
</style>
