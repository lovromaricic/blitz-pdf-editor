<script lang="ts">
  // Crop mode for one inserted image: the whole original at the object's scale
  // and turn, the part outside the crop frame shaded, the frame with 8
  // handles. Handles resize the frame; dragging the image moves it under the
  // still frame. Keys: arrows move the image (Shift: 10 px), Alt+arrows resize
  // from the bottom-right, Enter applies, Escape cancels, Tab goes to the
  // panel's crop controls. Changes go to actions.setCropView (nothing is in the
  // document until applied).
  import { MediaQuery } from 'svelte/reactivity';
  import { dragHandle, HANDLES, moveImage, ratioValue, resizeFromCorner, type CropSession, type Handle } from '../lib/image-crop';
  import type { Frame } from '../lib/image-geometry';
  import { CROP_STRINGS } from '../lib/strings';
  import { useActions } from '../lib/actions.svelte';

  let { session, frame, scale }: { session: CropSession; frame: Frame; scale: number } = $props();

  const actions = useActions();
  const coarse = new MediaQuery('(pointer: coarse), (max-width: 720px)');
  const HANDLE = 10;

  const s = $derived(scale);
  const img = $derived(session.view.image.map((v) => v * s) as [number, number, number, number]);
  const fr = $derived(session.view.frame.map((v) => v * s) as [number, number, number, number]);
  const ratio = $derived(ratioValue(session.ratio, session.px, session.portrait));
  const flip = $derived(session.base.flipX || session.base.flipY ? `scale(${session.base.flipX ? -1 : 1}, ${session.base.flipY ? -1 : 1})` : undefined);

  const NAMES: Record<string, string> = {
    '-1,-1': 'top left',
    '0,-1': 'top',
    '1,-1': 'top right',
    '1,0': 'right',
    '1,1': 'bottom right',
    '0,1': 'bottom',
    '-1,1': 'bottom left',
    '-1,0': 'left',
  };
  const CURSORS: Record<string, string> = {
    '-1,-1': 'nwse-resize',
    '1,1': 'nwse-resize',
    '1,-1': 'nesw-resize',
    '-1,1': 'nesw-resize',
    '0,-1': 'ns-resize',
    '0,1': 'ns-resize',
    '1,0': 'ew-resize',
    '-1,0': 'ew-resize',
  };

  /** A screen move (px) in the object's own axes, in points. */
  function local(dx: number, dy: number): [number, number] {
    const t = (frame.turn * Math.PI) / 180;
    return [(dx * Math.cos(t) + dy * Math.sin(t)) / s, (-dx * Math.sin(t) + dy * Math.cos(t)) / s];
  }

  let frameEl: HTMLDivElement | undefined = $state();

  function drag(e: PointerEvent, h: Handle | null) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    frameEl?.focus({ preventScroll: true });
    const start = session.view;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const [dx, dy] = local(ev.clientX - x0, ev.clientY - y0);
      actions.setCropView(h ? dragHandle(start, h, dx, dy, session.px, ratio) : moveImage(start, dx, dy));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Native listeners: the page's own pointerdown (selection, marquee) must not see these. */
  const dragFrom = (h: Handle | null) => (node: HTMLElement) => {
    const down = (e: PointerEvent) => drag(e, h);
    node.addEventListener('pointerdown', down);
    return () => node.removeEventListener('pointerdown', down);
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') actions.applyCrop();
    else if (e.key === 'Escape') actions.cancelCrop();
    else if (e.key === 'Tab' && !e.shiftKey) {
      // On to the crop controls in the panel.
      const first = document.querySelector<HTMLElement>('[data-crop-controls] input, [data-crop-controls] button');
      if (!first) return;
      first.focus();
    } else if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey) {
      const step = e.shiftKey ? 10 : 1;
      const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
      if (!d) return;
      if (e.altKey) {
        // The frame's own right and bottom edges (as seen upright).
        actions.setCropView(resizeFromCorner(session.view, d[0] / s, d[1] / s, session.px, ratio));
      } else {
        // The image, in the direction pressed on screen.
        actions.setCropView(moveImage(session.view, ...local(d[0], d[1])));
      }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Focus comes here when crop mode starts, so keys act on the crop right away.
  $effect(() => {
    frameEl?.focus({ preventScroll: true });
  });
</script>

<div class="crop-mode" data-crop-keep style:left="{frame.cx}px" style:top="{frame.cy}px" style:transform="rotate({frame.turn}deg)">
  <!-- The whole original; drag it to move it under the frame. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="image" style:left="{img[0]}px" style:top="{img[1]}px" style:width="{img[2]}px" style:height="{img[3]}px" {@attach dragFrom(null)}>
    <img src={session.base.dataUrl} alt="" draggable="false" style:transform={flip} />
    <svg class="shade" width={img[2]} height={img[3]} aria-hidden="true">
      <path
        fill-rule="evenodd"
        d="M0 0H{img[2]}V{img[3]}H0Z M{fr[0] - img[0]} {fr[1] - img[1]}h{fr[2]}v{fr[3]}h{-fr[2]}Z"
      />
    </svg>
  </div>
  <!-- A custom keyboard surface (arrows, Alt+arrows, Enter, Escape), described by #crop-keys. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={frameEl}
    class="frame"
    role="application"
    tabindex="0"
    aria-label={CROP_STRINGS.frame}
    aria-describedby="crop-keys"
    style:left="{fr[0]}px"
    style:top="{fr[1]}px"
    style:width="{fr[2]}px"
    style:height="{fr[3]}px"
    onkeydown={onKey}
    {@attach dragFrom(null)}
  ></div>
  <span id="crop-keys" class="visually-hidden">{CROP_STRINGS.keys}</span>
  {#each HANDLES as h (h.join())}
    {@const hit = coarse.current ? 44 : 24}
    {@const x = fr[0] + ((h[0] + 1) / 2) * fr[2]}
    {@const y = fr[1] + ((h[1] + 1) / 2) * fr[3]}
    <!-- Handles are a pointer convenience; keyboard users use Alt+arrows. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="handle-hit"
      data-handle={NAMES[h.join()]}
      title={CROP_STRINGS.handle(NAMES[h.join()])}
      style:left="{x - hit / 2}px"
      style:top="{y - hit / 2}px"
      style:width="{hit}px"
      style:height="{hit}px"
      style:cursor={CURSORS[h.join()]}
      {@attach dragFrom(h)}
    >
      <span class="handle" style:width="{HANDLE}px" style:height="{HANDLE}px"></span>
    </div>
  {/each}
</div>

<style>
  .crop-mode {
    position: absolute;
    width: 0;
    height: 0;
    z-index: 6;
    transform-origin: 0 0;
  }
  .image {
    position: absolute;
    cursor: move;
    touch-action: none;
  }
  .image img {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
    user-select: none;
  }
  .shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .shade path {
    fill: var(--shade);
  }
  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--accent);
    cursor: move;
    touch-action: none;
  }
  .frame:focus {
    outline: none;
  }
  .frame:focus-visible {
    outline: var(--focus-ring);
    outline-offset: 2px;
  }
  .handle-hit {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
  }
  .handle {
    box-sizing: border-box;
    background: var(--surface);
    border: 1.5px solid var(--accent);
  }
</style>
