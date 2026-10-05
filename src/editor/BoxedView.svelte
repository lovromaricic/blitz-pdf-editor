<script lang="ts">
  // Draws a text box, stamp, comment icon or image upright inside its box.
  // The box follows the page; content made for another page rotation turns with it.
  import { NOTE_OUTLINE, rgbToCss, type BoxedAnnotation, type Point } from '../lib/annotations';
  import { boxedGeometry } from '../lib/annotation-view';
  import { cssFamily, resolveStyle, TEXT_PADDING } from '../lib/fonts';
  import { decorationMetrics, metricsState, textMeasure } from '../lib/font-metrics-store.svelte';
  import { layoutTextBox } from '../lib/text-box-layout';
  import { lineSpacingOf } from '../lib/text-format';
  import { STAMP_TEXT_RATIO } from '../lib/annotations';
  import { bubblePath, NOTE_LINE_WIDTH, NOTE_LINES, NOTE_STROKE, toSvgPath, type Segment } from '../lib/note-shape';

  let {
    a,
    toScreen,
    scale,
    pageRotation,
    hidden = false,
    z,
  }: {
    a: BoxedAnnotation;
    toScreen: (p: Point) => Point;
    scale: number;
    pageRotation: number;
    hidden?: boolean;
    /** Stacking level, shared with the other objects on the page so their order decides. */
    z?: number;
  } = $props();

  const box = $derived(boxedGeometry(a, toScreen, scale, pageRotation));

  /** Text boxes: lines and underline/strikethrough bars from the shared layout (the PDF uses the same). */
  const layout = $derived.by(() => {
    void metricsState.version; // lay out again once the font's metrics arrive
    return a.type === 'text' ? layoutTextBox(a, textMeasure(a, a.size), decorationMetrics(a)) : null;
  });

  const BUBBLE_SVG = toSvgPath(bubblePath());
  const LINES_SVG = toSvgPath(NOTE_LINES.flatMap(([x1, y, x2]): Segment[] => [['M', x1, y], ['L', x2, y]]));
</script>

<!-- The kind goes in data-kind, not a class: a "stamp" or "text" class here would also
     pick up the inner element's styles below (that gave every stamp an extra dark border). -->
<div
  class="boxed"
  data-kind={a.type}
  style:left="{box.cx}px"
  style:top="{box.cy}px"
  style:width="{box.w}px"
  style:height="{box.h}px"
  style:transform="translate(-50%, -50%) rotate({box.turn}deg)"
  style:opacity={a.opacity}
  style:background={a.type === 'text' && a.background ? rgbToCss(a.background) : undefined}
  style:visibility={hidden ? 'hidden' : undefined}
  style:z-index={z}
  aria-hidden="true"
>
  {#if a.type === 'text' && layout}
    <div
      class="text"
      style:font-family={cssFamily(a.font)}
      style:font-weight={resolveStyle(a).bold ? 700 : 400}
      style:font-style={resolveStyle(a).italic ? 'italic' : 'normal'}
      style:font-size="{a.size * scale}px"
      style:line-height={lineSpacingOf(a)}
      style:padding-top="{TEXT_PADDING * scale}px"
      style:color={rgbToCss(a.color)}
    >
      {#each layout.lines as l, i (i)}
        <div class="line" style:padding-left="{l.x * scale}px">
          {#if l.wordSpacing}<span>{l.text.slice(0, l.indent)}</span><span style:word-spacing="{l.wordSpacing * scale}px">{l.text.slice(l.indent)}</span>{:else}{l.text || ' '}{/if}
        </div>
      {/each}
    </div>
    {#each layout.bars as b, i (i)}
      <div
        class="bar"
        style:left="{b.x * scale}px"
        style:top="{b.y * scale}px"
        style:width="{b.w * scale}px"
        style:height="{Math.max(1, b.h * scale)}px"
        style:background={rgbToCss(a.color)}
      ></div>
    {/each}
  {:else if a.type === 'stamp'}
    <div
      class="stamp"
      style:border-width="{Math.max(1.5, box.h * 0.06)}px"
      style:border-radius="{box.h * 0.15}px"
      style:border-color={rgbToCss(a.color)}
      style:color={rgbToCss(a.color)}
      style:font-size="{box.h * STAMP_TEXT_RATIO}px"
      style:font-family={cssFamily('sans')}
    >
      {a.label}
    </div>
  {:else if a.type === 'note'}
    <!-- Same drawing as the saved appearance (note-shape.ts). The viewBox scales the outline with the icon. -->
    <svg viewBox="0 0 22 22" width="100%" height="100%" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">
      <path d={BUBBLE_SVG} fill={rgbToCss(a.color)} stroke={rgbToCss(NOTE_OUTLINE)} stroke-width={NOTE_STROKE} />
      <path d={LINES_SVG} fill="none" stroke={rgbToCss(NOTE_OUTLINE)} stroke-width={NOTE_LINE_WIDTH} />
    </svg>
  {:else if a.type === 'image'}
    <img
      src={a.dataUrl}
      alt=""
      draggable="false"
      style:transform={a.type === 'image' && (a.flipX || a.flipY) ? `scale(${a.flipX ? -1 : 1}, ${a.flipY ? -1 : 1})` : undefined}
    />
  {/if}
</div>

<style>
  .boxed {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    transform-origin: 50% 50%;
  }
  /* The same glyph advances as the PDF: no kerning, no ligatures. */
  .text {
    white-space: pre;
    overflow: visible;
    font-kerning: none;
    font-variant-ligatures: none;
    font-feature-settings:
      'kern' 0,
      'liga' 0,
      'clig' 0,
      'calt' 0,
      'dlig' 0;
  }
  .bar {
    position: absolute;
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
