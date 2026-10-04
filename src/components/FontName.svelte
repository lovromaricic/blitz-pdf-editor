<script lang="ts">
  // A font's name shown in that font: the real font once it's loaded, else a
  // drawn preview (no download), else plain text. Screen readers get the text.
  import { cssFamily, type FontPreviews } from '../lib/fonts';

  let { font, label, previews, loaded = false }: { font: string; label: string; previews: FontPreviews | null; loaded?: boolean } = $props();

  const p = $derived(previews?.[font]);
</script>

{#if loaded}
  <span class="name" style:font-family={`"${cssFamily(font)}", var(--font-sans)`}>{label}</span>
{:else if p}
  <span class="name">
    <svg class="drawn" viewBox={p.box.join(' ')} style:height="{p.box[3] / p.em}em" aria-hidden="true"><path d={p.d} /></svg>
    <span class="visually-hidden">{label}</span>
  </span>
{:else}
  <span class="name">{label}</span>
{/if}

<style>
  .name {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-base);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawn {
    width: auto;
    max-width: 100%;
    overflow: visible;
    fill: currentColor;
  }
</style>
