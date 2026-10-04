<script lang="ts">
  // Draws a text box, stamp, comment icon or image upright inside its box.
  // The box follows the page; content made for another page rotation turns with it.
  import { rgbToCss, type BoxedAnnotation, type Point } from '../lib/annotations';
  import { boxedGeometry } from '../lib/annotation-view';
  import { CSS_FAMILY, LINE_HEIGHT, TEXT_PADDING } from '../lib/fonts';
  import { STAMP_TEXT_RATIO } from '../lib/annotations';

  let {
    a,
    toScreen,
    scale,
    pageRotation,
    hidden = false,
  }: { a: BoxedAnnotation; toScreen: (p: Point) => Point; scale: number; pageRotation: number; hidden?: boolean } = $props();

  const box = $derived(boxedGeometry(a, toScreen, scale, pageRotation));
</script>

<div
  class="boxed {a.type}"
  style:left="{box.cx}px"
  style:top="{box.cy}px"
  style:width="{box.w}px"
  style:height="{box.h}px"
  style:transform="translate(-50%, -50%) rotate({box.turn}deg)"
  style:opacity={a.opacity}
  style:visibility={hidden ? 'hidden' : undefined}
>
  {#if a.type === 'text'}
    <div
      class="text"
      style:font-family={CSS_FAMILY[a.font]}
      style:font-size="{a.size * scale}px"
      style:line-height={LINE_HEIGHT}
      style:padding="{TEXT_PADDING * scale}px"
      style:color={rgbToCss(a.color)}
    >
      {#each a.lines as line, i (i)}<div class="line">{line || ' '}</div>{/each}
    </div>
  {:else if a.type === 'stamp'}
    <div
      class="stamp"
      style:border-width="{Math.max(1.5, box.h * 0.06)}px"
      style:border-radius="{box.h * 0.15}px"
      style:border-color={rgbToCss(a.color)}
      style:color={rgbToCss(a.color)}
      style:font-size="{box.h * STAMP_TEXT_RATIO}px"
      style:font-family={CSS_FAMILY['sans-bold']}
    >
      {a.label}
    </div>
  {:else if a.type === 'note'}
    <svg viewBox="0 0 22 22" width="100%" height="100%" aria-hidden="true">
      <!-- Same drawing as the saved appearance (PDF y-up flipped to screen y-down). -->
      <g transform="translate(0 22) scale(1 -1)">
        <rect x="1" y="6.16" width="20" height="15.4" rx="2.64" fill={rgbToCss(a.color)} stroke="#404040" />
        <path d="M5.5 6.16 L4.4 1 L9.9 6.16 Z" fill={rgbToCss(a.color)} />
        <path d="M4.4 17.6 H17.6 M4.4 13.86 H17.6 M4.4 10.12 H13.2" stroke="#404040" />
      </g>
    </svg>
  {:else}
    <img src={a.dataUrl} alt="" draggable="false" />
  {/if}
</div>

<style>
  .boxed {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    transform-origin: 50% 50%;
  }
  .text {
    white-space: pre;
    overflow: visible;
  }
  .stamp {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border-style: solid;
    font-weight: 700;
    white-space: nowrap;
    line-height: 1;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
