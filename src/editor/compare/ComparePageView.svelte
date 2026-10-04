<script lang="ts">
  // One page in a Compare column: rendered only while near the visible area,
  // with the changed words highlighted.
  import type { PageViewport } from 'pdfjs-dist';
  import type { Rect } from '../../lib/annotations';
  import type { ComparePage } from '../../lib/compare';
  import { releaseCanvas, renderToCanvas } from '../../lib/pdf/render';

  export interface Mark {
    rect: Rect;
    hunk: number;
  }

  let {
    page,
    viewport1,
    top,
    width,
    marks,
    kind,
    activeHunk,
    root,
    label,
  }: {
    page: ComparePage;
    /** Viewport at 100%. */
    viewport1: PageViewport;
    top: number;
    width: number;
    marks: Mark[];
    kind: 'removed' | 'added';
    activeHunk: number;
    root: HTMLElement;
    label: string;
  } = $props();

  let el: HTMLDivElement;
  let host: HTMLDivElement;
  let visible = $state(false);

  const viewport = $derived(viewport1.clone({ scale: width / viewport1.width }));
  const height = $derived(Math.round(viewport.height));

  $effect(() => {
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { root, rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  });

  /** The bitmap on screen; kept while re-rendering, dropped when scrolled far away. */
  let current: HTMLCanvasElement | null = null;
  function drop() {
    host?.replaceChildren();
    releaseCanvas(current);
    current = null;
  }

  $effect(() => {
    if (!visible || width <= 0) return;
    const vp = viewport;
    let cancelled = false;
    let handle: ReturnType<typeof renderToCanvas> | null = null;
    const timer = setTimeout(async () => {
      const pdfPage = await page.pdf.getPage(page.index + 1);
      if (cancelled) return;
      handle = renderToCanvas(pdfPage, vp, 'values');
      const canvas = await handle.promise.catch(() => null);
      if (cancelled || !canvas) return releaseCanvas(canvas);
      host.replaceChildren(canvas);
      releaseCanvas(current);
      current = canvas;
    }, current ? 120 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      handle?.cancel();
    };
  });

  $effect(() => {
    if (!visible) drop();
  });
  $effect(() => drop);

  const boxes = $derived(
    marks.map((m) => {
      const [ax, ay] = viewport.convertToViewportPoint(m.rect[0], m.rect[1]);
      const [bx, by] = viewport.convertToViewportPoint(m.rect[2], m.rect[3]);
      return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), active: m.hunk === activeHunk };
    }),
  );
</script>

<div bind:this={el} class="page" style:top="{top}px" style:width="{width}px" style:height="{height}px" role="img" aria-label={label}>
  <div class="canvas-host" bind:this={host}></div>
  {#each boxes as b, k (k)}
    <div
      class="mark {kind}"
      class:active={b.active}
      style:left="{b.left}px"
      style:top="{b.top}px"
      style:width="{b.width}px"
      style:height="{b.height}px"
    ></div>
  {/each}
</div>

<style>
  .page {
    position: absolute;
    left: 16px;
    overflow: hidden;
    border-radius: var(--radius-page);
    background: var(--page);
    box-shadow: var(--shadow-page);
  }
  .canvas-host,
  .canvas-host :global(canvas) {
    position: absolute;
    inset: 0;
    display: block;
  }
  .mark {
    position: absolute;
    border-radius: 2px;
    mix-blend-mode: multiply;
  }
  .removed {
    background: var(--diff-removed);
  }
  .added {
    background: var(--diff-added);
  }
  .mark.active {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    mix-blend-mode: normal;
  }
</style>
