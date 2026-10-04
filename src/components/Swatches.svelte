<script lang="ts">
  // Preset color swatches plus a "+" swatch that opens the custom color picker.
  // A custom color in use takes the "+" position, with the selection ring.
  import Plus from '@lucide/svelte/icons/plus';
  import { tick } from 'svelte';
  import { rgbToCss, sameRgb, type Rgb } from '../lib/annotations';
  import { toHex } from '../lib/color';
  import { rememberColor } from '../lib/recent-colors.svelte';
  import ColorPicker from './ColorPicker.svelte';

  let {
    label,
    colors,
    value,
    onChange,
    allowNone = false,
    custom = true,
  }: {
    label: string;
    colors: { name: string; rgb: Rgb }[];
    value: Rgb | null;
    onChange: (c: Rgb | null) => void;
    allowNone?: boolean;
    /** Offer the custom color picker. */
    custom?: boolean;
  } = $props();

  const options = $derived<{ name: string; rgb: Rgb | null }[]>(allowNone ? [{ name: 'None', rgb: null }, ...colors] : colors);
  /** The current color isn't one of the presets. */
  const isCustom = $derived(value !== null && !options.some((o) => sameRgb(o.rgb, value)));
  const anyChecked = $derived(options.some((o) => sameRgb(o.rgb, value)));

  function onKey(e: KeyboardEvent, i: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + options.length) % options.length;
    onChange(options[next].rgb);
    ((e.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  // --- Custom color popover -------------------------------------------------------

  let open = $state(false);
  let plusBtn = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();
  /** The color when the picker opened, to know whether a custom color was chosen. */
  let startHex = '';
  /** The eyedropper is picking: a click anywhere is the pick, not "close". */
  let picking = false;
  let latest: Rgb | null = null;
  const uid = Math.random().toString(36).slice(2, 8);

  function openPicker() {
    startHex = value ? toHex(value) : '';
    latest = null;
    open = true;
  }

  async function close(returnFocus = true) {
    if (!open) return;
    open = false;
    if (latest && toHex(latest) !== startHex) rememberColor(latest);
    if (returnFocus) {
      await tick();
      plusBtn?.focus();
    }
  }

  function onPicking(on: boolean) {
    // Some browsers also deliver the picking click to the page just after the pick ends.
    if (on) picking = true;
    else setTimeout(() => (picking = false), 400);
  }

  function onPick(rgb: Rgb) {
    latest = rgb;
    onChange(rgb);
  }

  // Click outside closes.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (picking) return;
      const t = e.target as Node;
      if (popover?.contains(t) || plusBtn?.contains(t)) return;
      // Hand focus back to "+" unless the click lands on something that takes focus itself.
      const takesFocus = (t as Element).closest?.('button, input, select, textarea, a, [tabindex]');
      void close(!takesFocus);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  function onPopoverKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // Handled here: the editor must not also treat it as "deselect".
    e.preventDefault();
    e.stopPropagation();
    void close();
  }
</script>

<div class="wrap">
  <div class="swatches">
    <div class="presets" role="radiogroup" aria-label={label}>
      {#each options as c, i (c.name)}
        {@const checked = sameRgb(c.rgb, value)}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          aria-label={c.name}
          title={c.name}
          tabindex={checked || (!anyChecked && i === 0) ? 0 : -1}
          class="swatch"
          class:none={c.rgb === null}
          style:background={c.rgb ? rgbToCss(c.rgb) : undefined}
          onclick={() => onChange(c.rgb)}
          onkeydown={(e) => onKey(e, i)}
        ></button>
      {/each}
    </div>
    {#if custom}
      <button
        bind:this={plusBtn}
        type="button"
        class="swatch plus"
        class:selected={isCustom}
        style:background={isCustom && value ? rgbToCss(value) : undefined}
        aria-label={isCustom && value ? `Custom color ${toHex(value)}, selected` : 'Custom color'}
        title={isCustom && value ? `Custom color ${toHex(value)}` : 'Custom color'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `picker-${uid}` : undefined}
        onclick={() => (open ? close() : openPicker())}
      >
        {#if !isCustom}<Plus size={18} strokeWidth={1.7} aria-hidden="true" />{/if}
      </button>
    {/if}
  </div>

  {#if open}
    <!-- Phones: a bottom sheet over a dimmed page. -->
    <div class="backdrop" aria-hidden="true"></div>
    <div bind:this={popover} class="popover" id="picker-{uid}" role="dialog" aria-label="Custom {label.toLowerCase()}" tabindex="-1" onkeydown={onPopoverKey}>
      <ColorPicker value={value ?? [0, 0, 0]} label="Custom {label.toLowerCase()}" onChange={onPick} onPicking={onPicking} />
      <button type="button" class="btn done" onclick={() => close()}>Done</button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .swatches,
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .swatch {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--border);
    transition: box-shadow var(--transition-fast);
  }
  /* Selected: white inner ring, accent outer ring. */
  .swatch[aria-checked='true'],
  .swatch.plus.selected {
    box-shadow:
      inset 0 0 0 2px var(--surface),
      0 0 0 2px var(--accent);
  }
  .swatch.none {
    background:
      linear-gradient(135deg, transparent 46%, var(--danger) 46% 54%, transparent 54%),
      var(--surface);
  }
  .swatch.plus {
    background: var(--surface);
    color: var(--muted);
  }
  .swatch.plus:hover:not(.selected) {
    background: var(--surface-2);
  }
  .popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    z-index: 50;
    display: grid;
    gap: var(--space-3);
    width: min(264px, 100%);
    min-width: 232px;
    padding: var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-overlay);
  }
  .popover:focus {
    outline: none;
  }
  .backdrop {
    display: none;
  }
  .done {
    min-height: 34px;
  }
  /* Phones: a 40px swatch inside a 44px tap area; the picker becomes a bottom sheet. */
  @media (max-width: 720px), (pointer: coarse) {
    .swatches,
    .presets {
      gap: 6px;
    }
    .swatch {
      width: var(--touch-target);
      height: var(--touch-target);
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    .done {
      min-height: var(--touch-target);
    }
  }
  @media (max-width: 720px) {
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 400;
      display: block;
      background: var(--backdrop);
    }
    .popover {
      position: fixed;
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 401;
      width: auto;
      max-height: 85dvh;
      overflow-y: auto;
      padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    }
  }
</style>
