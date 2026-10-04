<script lang="ts">
  // Custom color picker (content of the "+" swatch popover): saturation and
  // brightness area, hue slider, hex field, preview, eyedropper and the
  // session's recent colors. Every change applies live through onChange.
  import Pipette from '@lucide/svelte/icons/pipette';
  import { onMount } from 'svelte';
  import { rgbToCss, type Rgb } from '../lib/annotations';
  import { hsvToRgb, parseHex, quantize, rgbToHsv, toHex, type Hsv } from '../lib/color';
  import { recentColors } from '../lib/recent-colors.svelte';

  let {
    value,
    label,
    onChange,
    onPicking,
  }: {
    value: Rgb;
    label: string;
    onChange: (rgb: Rgb) => void;
    /** True while the screen eyedropper is active (clicks then belong to it). */
    onPicking?: (active: boolean) => void;
  } = $props();

  // svelte-ignore state_referenced_locally (the color when the picker opened)
  const previous: Rgb = [...value] as Rgb;
  // svelte-ignore state_referenced_locally
  let hsv = $state<Hsv>(rgbToHsv(value));
  const rgb = $derived(quantize(hsvToRgb(hsv)));
  let hexText = $state(toHex(previous));
  let hexError = $state(false);

  const uid = Math.random().toString(36).slice(2, 8);
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  function apply(next: Hsv, fromHex = false) {
    hsv = next;
    const out = quantize(hsvToRgb(next));
    if (!fromHex) {
      hexText = toHex(out);
      hexError = false;
    }
    onChange(out);
  }

  function applyRgb(c: Rgb) {
    const next = rgbToHsv(c);
    // Greys have no hue: keep the slider where it was.
    if (next.s === 0) next.h = hsv.h;
    apply(next);
  }

  // --- Saturation / brightness area ------------------------------------------

  let area: HTMLDivElement;
  let dragging = $state(false);

  function fromPointer(e: PointerEvent) {
    const r = area.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    apply({ ...hsv, s, v });
  }

  function onAreaDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    area.focus();
    area.setPointerCapture?.(e.pointerId);
    dragging = true;
    fromPointer(e);
  }

  function onAreaKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    apply({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + m[0])), v: Math.min(1, Math.max(0, hsv.v + m[1])) });
  }

  // --- Hex field ----------------------------------------------------------------

  function onHexInput(text: string) {
    hexText = text;
    hexError = false;
    const c = parseHex(text);
    if (c) {
      const next = rgbToHsv(c);
      if (next.s === 0) next.h = hsv.h;
      apply(next, true);
    }
  }

  function onHexCommit() {
    const c = parseHex(hexText);
    if (!c) hexError = true;
    else hexText = toHex(c);
  }

  // --- Eyedropper ---------------------------------------------------------------

  async function pickFromScreen() {
    onPicking?.(true);
    try {
      const dropper = new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
      const { sRGBHex } = await dropper.open();
      const c = parseHex(sRGBHex);
      if (c) applyRgb(c);
    } catch {
      // Cancelled with Escape: nothing to do.
    } finally {
      onPicking?.(false);
    }
  }

  // Inline gradients describe the color model itself (from the current hue), not theme colors.
  const hueCss = $derived(rgbToCss(hsvToRgb({ h: hsv.h, s: 1, v: 1 })));
  const areaBg = $derived(
    `linear-gradient(to top, ${rgbToCss([0, 0, 0])}, transparent), linear-gradient(to right, ${rgbToCss([1, 1, 1])}, ${hueCss})`,
  );
  const hueTrack = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => rgbToCss(hsvToRgb({ h, s: 1, v: 1 }))).join(', ')})`;

  onMount(() => area.focus());
</script>

<div class="picker" role="group" aria-label={label}>
  <!-- A two-dimensional slider: left/right saturation, up/down brightness. -->
  <div
    bind:this={area}
    class="area"
    class:dragging
    style:background={areaBg}
    role="slider"
    tabindex="0"
    aria-label="Saturation and brightness"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(hsv.s * 100)}
    aria-valuetext="Saturation {Math.round(hsv.s * 100)}%, brightness {Math.round(hsv.v * 100)}%"
    onpointerdown={onAreaDown}
    onpointermove={(e) => dragging && fromPointer(e)}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
    onkeydown={onAreaKey}
  >
    <span class="handle" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={rgbToCss(rgb)}></span>
  </div>

  <input
    class="hue"
    type="range"
    min="0"
    max="359"
    step="1"
    value={Math.round(hsv.h)}
    style:--track={hueTrack}
    aria-label="Hue"
    aria-valuetext="{Math.round(hsv.h)} degrees"
    oninput={(e) => apply({ ...hsv, h: +e.currentTarget.value })}
  />

  <div class="row">
    <div class="hex">
      <label for="hex-{uid}">Hex</label>
      <input
        id="hex-{uid}"
        type="text"
        value={hexText}
        spellcheck="false"
        autocomplete="off"
        maxlength="7"
        aria-invalid={hexError}
        aria-describedby={hexError ? `hex-error-${uid}` : undefined}
        oninput={(e) => onHexInput(e.currentTarget.value)}
        onblur={onHexCommit}
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), onHexCommit())}
      />
    </div>
    <div class="preview" role="img" aria-label="New color {toHex(rgb)}, previous color {toHex(previous)}">
      <span style:background={rgbToCss(rgb)}></span>
      <span style:background={rgbToCss(previous)}></span>
    </div>
    {#if hasEyeDropper}
      <button type="button" class="tool" aria-label="Pick a color from the screen" title="Pick a color from the screen" onclick={pickFromScreen}>
        <Pipette size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>
    {/if}
  </div>
  {#if hexError}<p class="error" id="hex-error-{uid}">Enter a color like #3F6FE0</p>{/if}

  {#if recentColors.list.length}
    <div class="recent">
      <span class="section-label" id="recent-{uid}">Recent</span>
      <div class="recent-list" role="group" aria-labelledby="recent-{uid}">
        {#each recentColors.list as c (toHex(c))}
          <button type="button" class="chip" style:background={rgbToCss(c)} aria-label="Use {toHex(c)}" title={toHex(c)} onclick={() => applyRgb(c)}
          ></button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .picker {
    display: grid;
    gap: var(--space-3);
  }
  .area {
    position: relative;
    height: 140px;
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px var(--border);
    cursor: crosshair;
    touch-action: none;
  }
  .handle {
    position: absolute;
    width: 16px;
    height: 16px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--text);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .hue {
    width: 100%;
    height: 20px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  .hue::-webkit-slider-runnable-track {
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--track);
  }
  .hue::-moz-range-track {
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--track);
  }
  .hue::-webkit-slider-thumb {
    width: 18px;
    height: 18px;
    margin-top: -3px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: transparent;
    box-shadow: 0 0 0 1px var(--text);
    -webkit-appearance: none;
  }
  .hue::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: transparent;
    box-shadow: 0 0 0 1px var(--text);
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .hex {
    display: grid;
    flex: 1;
    gap: var(--space-1);
    min-width: 0;
  }
  .hex label {
    font-size: var(--font-size-xs);
    font-weight: 600;
  }
  .hex input {
    width: 100%;
    min-height: 34px;
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
    text-transform: uppercase;
  }
  .hex input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .preview {
    display: flex;
    flex-shrink: 0;
    overflow: hidden;
    height: 34px;
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .preview span {
    width: 26px;
  }
  .tool {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }
  .tool:hover {
    background: var(--surface-2);
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: var(--font-size-xs);
    font-weight: 600;
  }
  .recent {
    display: grid;
    gap: var(--space-2);
  }
  .recent-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  @media (max-width: 720px), (pointer: coarse) {
    .area {
      height: 180px;
    }
    .hue {
      height: var(--touch-target);
    }
    .hex input,
    .tool,
    .preview {
      min-height: var(--touch-target);
      height: var(--touch-target);
    }
    .tool {
      width: var(--touch-target);
    }
    .chip {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
