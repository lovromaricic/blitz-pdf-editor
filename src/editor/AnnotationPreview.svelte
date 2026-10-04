<script lang="ts">
  // Non-interactive rendering of a page's markup (thumbnails).
  import type { PageViewport } from 'pdfjs-dist';
  import { isBoxed, type Annotation, type Point } from '../lib/annotations';
  import BoxedView from './BoxedView.svelte';
  import { pointsAttr, toPrimitives } from '../lib/annotation-view';

  let { annots, viewport }: { annots: readonly Annotation[]; viewport: PageViewport } = $props();

  const toScreen = (p: Point) => viewport.convertToViewportPoint(p[0], p[1]) as Point;
  const groups = $derived([
    { multiply: true, prims: annots.filter((a) => a.type === 'highlight').flatMap((a) => toPrimitives(a, toScreen, viewport.scale)) },
    { multiply: false, prims: annots.filter((a) => a.type !== 'highlight').flatMap((a) => toPrimitives(a, toScreen, viewport.scale)) },
  ]);
</script>

{#each annots.filter(isBoxed) as a (a.id)}
  <BoxedView {a} {toScreen} scale={viewport.scale} pageRotation={viewport.rotation} />
{/each}

{#each groups as g, gi (gi)}
  {#if g.prims.length}
    <svg class:multiply={g.multiply} width={viewport.width} height={viewport.height} aria-hidden="true">
      {#each g.prims as p, i (i)}
        {#if p.kind === 'polygon'}
          <polygon points={pointsAttr(p.points)} fill={p.fill} fill-opacity={p.opacity} />
        {:else if p.kind === 'polyline'}
          <polyline points={pointsAttr(p.points)} fill="none" stroke={p.stroke} stroke-width={p.width} stroke-opacity={p.opacity} stroke-linecap="round" stroke-linejoin="round" />
        {:else}
          <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={p.fill ?? 'none'} fill-opacity={p.opacity} stroke={p.stroke} stroke-width={p.width} stroke-opacity={p.opacity} />
        {/if}
      {/each}
    </svg>
  {/if}
{/each}

<style>
  svg {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }
  .multiply {
    mix-blend-mode: multiply;
  }
</style>
