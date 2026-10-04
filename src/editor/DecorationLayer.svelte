<script lang="ts">
  // Preview of the watermark and page number, exactly where they'll be saved.
  import { rgbToCss } from '../lib/annotations';
  import { layoutDecoration, type PageDecoration } from '../lib/decorations';
  import { cssFamily, measure } from '../lib/fonts';

  let { deco, width, height, scale }: { deco: PageDecoration; width: number; height: number; scale: number } = $props();

  // Width and height are the visible page in CSS px; layout works in points.
  const items = $derived(layoutDecoration(width / scale, height / scale, deco, (t, bold) => measure(t, bold ? 'sans-bold' : 'sans', 1)));
</script>

<svg class="decorations" {width} {height} aria-hidden="true">
  {#each items as it, i (i)}
    <text
      x={it.x * scale}
      y={it.y * scale}
      font-family={cssFamily('sans')}
      font-weight={it.bold ? 700 : 400}
      font-size={it.size * scale}
      fill={rgbToCss(it.color)}
      fill-opacity={it.opacity}
      transform={it.angle ? `rotate(${-it.angle} ${it.x * scale} ${it.y * scale})` : undefined}>{it.text}</text
    >
  {/each}
</svg>

<style>
  .decorations {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 3;
    pointer-events: none;
    white-space: pre;
  }
</style>
