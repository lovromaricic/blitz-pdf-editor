<script lang="ts">
  // Non-interactive rendering of a page's markup (thumbnails), in stacking order.
  import type { PageViewport } from 'pdfjs-dist';
  import { isBoxed, type Annotation, type Point } from '../lib/annotations';
  import BoxedView from './BoxedView.svelte';
  import { pointsAttr, toPrimitives } from '../lib/annotation-view';

  let { annots, viewport }: { annots: readonly Annotation[]; viewport: PageViewport } = $props();

  const toScreen = (p: Point) => viewport.convertToViewportPoint(p[0], p[1]) as Point;
</script>

{#each annots as a (a.id)}
  {#if isBoxed(a)}
    <BoxedView {a} {toScreen} scale={viewport.scale} pageRotation={viewport.rotation} z={1} />
  {:else}
    <svg class:multiply={a.type === 'highlight'} width={viewport.width} height={viewport.height} aria-hidden="true">
      {#each toPrimitives(a, toScreen, viewport.scale) as p, i (i)}
        {#if p.kind === 'polygon'}
          <polygon points={pointsAttr(p.points)} fill={p.fill} fill-opacity={p.opacity} />
        {:else if p.kind === 'polyline'}
          <polyline points={pointsAttr(p.points)} fill="none" stroke={p.stroke} stroke-width={p.width} stroke-opacity={p.opacity} stroke-linecap="round" stroke-linejoin="round" />
        {:else}
          <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={p.fill ?? 'none'} fill-opacity={p.opacity} stroke={p.stroke ?? 'none'} stroke-width={p.width} stroke-opacity={p.opacity} />
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
    z-index: 1;
    pointer-events: none;
  }
  .multiply {
    mix-blend-mode: multiply;
  }
</style>
