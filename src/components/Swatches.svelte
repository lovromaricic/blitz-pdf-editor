<script lang="ts">
  import { rgbToCss, sameRgb, type Rgb } from '../lib/annotations';

  let {
    label,
    colors,
    value,
    onChange,
    allowNone = false,
  }: {
    label: string;
    colors: { name: string; rgb: Rgb }[];
    value: Rgb | null;
    onChange: (c: Rgb | null) => void;
    allowNone?: boolean;
  } = $props();

  const options = $derived<{ name: string; rgb: Rgb | null }[]>(allowNone ? [{ name: 'None', rgb: null }, ...colors] : colors);

  function onKey(e: KeyboardEvent, i: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + options.length) % options.length;
    onChange(options[next].rgb);
    ((e.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }
</script>

<div class="swatches" role="radiogroup" aria-label={label}>
  {#each options as c, i (c.name)}
    {@const checked = sameRgb(c.rgb, value)}
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={c.name}
      title={c.name}
      tabindex={checked || (value === null && i === 0) ? 0 : -1}
      class="swatch"
      class:none={c.rgb === null}
      style:background={c.rgb ? rgbToCss(c.rgb) : undefined}
      onclick={() => onChange(c.rgb)}
      onkeydown={(e) => onKey(e, i)}
    ></button>
  {/each}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .swatch {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 2px solid var(--color-bg);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--color-border-strong);
  }
  @media (max-width: 640px), (pointer: coarse) {
    .swatch {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
  .swatch[aria-checked='true'] {
    box-shadow: 0 0 0 2px var(--color-accent);
  }
  .swatch.none {
    background: linear-gradient(135deg, transparent 45%, var(--color-text-muted) 45% 55%, transparent 55%), var(--color-bg);
  }
</style>
