<script lang="ts">
  import OrderControls from './OrderControls.svelte';
  import { rgbToCss, STAMPS, type Rgb } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();

  const sel = $derived(actions.selectedAnnot?.annot.type === 'stamp' ? actions.selectedAnnot : null);
  const STAMP_COLORS: { name: string; rgb: Rgb }[] = [
    { name: 'Green', rgb: [0.08, 0.45, 0.16] },
    { name: 'Blue', rgb: [0.1, 0.35, 0.8] },
    { name: 'Red', rgb: [0.8, 0.1, 0.1] },
    { name: 'Gray', rgb: [0.35, 0.35, 0.35] },
  ];
  let custom = $state('');

  function choose(label: string, color: Rgb) {
    viewer.toolProps.stamp = { label, color };
  }

  function setColor(c: Rgb) {
    viewer.toolProps.stamp.color = c;
    if (sel) actions.updateAnnotation(sel.page.id, { ...sel.annot, color: $state.snapshot(c) as Rgb }, 'Change color', `color:${sel.annot.id}`);
  }
</script>

<PanelHeader title="Stamp" onClose={sel ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')} />

<div class="panel-form">
  {#if !sel}
    <p class="hint">Choose a stamp, then click on the page to place it.</p>
    <div class="stamps" role="radiogroup" aria-label="Stamp">
      {#each STAMPS as s (s.label)}
        {@const checked = viewer.toolProps.stamp.label === s.label}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          class="stamp"
          style:color={rgbToCss(s.color)}
          style:border-color={rgbToCss(s.color)}
          onclick={() => choose(s.label, s.color)}>{s.label}</button
        >
      {/each}
    </div>
    <form
      class="field"
      onsubmit={(e) => {
        e.preventDefault();
        if (custom.trim()) choose(custom.trim().toUpperCase(), viewer.toolProps.stamp.color);
      }}
    >
      <label for="stamp-custom">Custom stamp</label>
      <div class="row">
        <input id="stamp-custom" type="text" bind:value={custom} maxlength="40" placeholder="e.g. PAID" />
        <button type="submit" class="btn" disabled={!custom.trim()}>Use</button>
      </div>
    </form>
    <p class="hint">Selected: <strong>{viewer.toolProps.stamp.label}</strong></p>
  {/if}
  <div class="field">
    <span class="label">Color</span>
    <Swatches label="Stamp color" colors={STAMP_COLORS} value={sel?.annot.color ?? viewer.toolProps.stamp.color} onChange={(c) => c && setColor(c)} />
  </div>
  {#if sel}
    <OrderControls pageId={sel.page.id} id={sel.annot.id} />
    <div class="actions">
      <button type="button" class="btn btn-danger" onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}>Delete</button>
    </div>
    <p class="hint">Drag to move, drag a corner to resize.</p>
  {/if}
</div>

<style>
  .label {
    font-weight: 600;
  }
  .stamps {
    display: grid;
    gap: var(--space-1);
  }
  .stamp {
    min-height: 34px;
    border: 2px solid;
    border-radius: var(--radius-md);
    background: var(--surface);
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .stamp[aria-checked='true'] {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .row .btn {
    width: auto;
  }
</style>
