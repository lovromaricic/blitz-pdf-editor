<script lang="ts">
  // Slider in the Mist style: soft track, accent fill up to the value, white knob.
  let {
    id,
    min,
    max,
    step,
    value,
    onInput,
    label,
  }: { id: string; min: number; max: number; step: number; value: number; onInput: (v: number) => void; label?: string } = $props();

  const fill = $derived(`${((value - min) / (max - min || 1)) * 100}%`);
</script>

<input
  {id}
  type="range"
  class="range"
  {min}
  {max}
  {step}
  {value}
  aria-label={label}
  style:--fill={fill}
  oninput={(e) => onInput(+e.currentTarget.value)}
/>

<style>
  .range {
    width: 100%;
    height: 24px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  .range::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: var(--radius-pill);
    background: linear-gradient(to right, var(--accent) var(--fill), var(--surface-2) var(--fill));
  }
  .range::-moz-range-track {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
  }
  .range::-moz-range-progress {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
  }
  .range::-webkit-slider-thumb {
    width: 20px;
    height: 20px;
    margin-top: -7px;
    border: 2px solid var(--accent);
    border-radius: 50%;
    background: var(--surface);
    -webkit-appearance: none;
  }
  .range::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: 2px solid var(--accent);
    border-radius: 50%;
    background: var(--surface);
  }
  .range:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-sm);
  }
</style>
