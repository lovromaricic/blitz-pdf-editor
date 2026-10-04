<script lang="ts">
  import { INK_COLORS, type FontFamily, type TextAnnotation } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { FONT_LABELS, loadFonts } from '../../lib/fonts';
  import { layoutText } from '../../lib/text-layout';
  import { useViewer } from '../../lib/viewer.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';
  import Range from '../../components/Range.svelte';

  const viewer = useViewer();
  const actions = useActions();

  const sel = $derived.by(() => {
    const s = actions.selectedAnnot;
    return s && s.annot.type === 'text' ? { page: s.page, annot: s.annot as TextAnnotation } : null;
  });
  const props = $derived(sel?.annot ?? viewer.toolProps.text);
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

  async function set<K extends 'font' | 'size' | 'color' | 'opacity'>(key: K, value: TextAnnotation[K], label: string) {
    value = $state.snapshot(value) as TextAnnotation[K];
    (viewer.toolProps.text as Record<string, unknown>)[key] = value;
    if (!sel) return;
    let next: TextAnnotation = { ...sel.annot, [key]: value };
    // Font and size change how the text wraps.
    if (key === 'font' || key === 'size') {
      await loadFonts();
      next = layoutText(next);
    }
    actions.updateAnnotation(sel.page.id, next, `Change ${label}`, `${key}:${sel.annot.id}`);
  }
</script>

<PanelHeader title="Text" onClose={sel ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')} />

<div class="panel-form">
  {#if !sel}
    <p class="hint">Click on the page to type. Click an existing text box to change it.</p>
  {/if}
  <div class="field">
    <label for="tx-font">Font</label>
    <select id="tx-font" value={props.font} onchange={(e) => set('font', e.currentTarget.value as FontFamily, 'font')}>
      {#each Object.entries(FONT_LABELS) as [id, label] (id)}
        <option value={id}>{label}</option>
      {/each}
    </select>
  </div>
  <div class="field">
    <label for="tx-size">Size (pt)</label>
    <select id="tx-size" value={props.size} onchange={(e) => set('size', +e.currentTarget.value, 'size')}>
      {#each SIZES.includes(props.size) ? SIZES : [...SIZES, props.size].sort((a, b) => a - b) as s (s)}
        <option value={s}>{s}</option>
      {/each}
    </select>
  </div>
  <div class="field">
    <span class="label">Color</span>
    <Swatches label="Text color" colors={INK_COLORS} value={props.color} onChange={(c) => c && set('color', c, 'color')} />
  </div>
  <div class="field">
    <label for="tx-opacity">Opacity <span class="value">{Math.round(props.opacity * 100)}%</span></label>
    <Range id="tx-opacity" min={0.1} max={1} step={0.05} value={props.opacity} onInput={(v) => set('opacity', v, 'opacity')} />
  </div>
  {#if sel}
    <div class="actions">
      <button type="button" class="btn btn-danger" onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}>Delete</button>
    </div>
    <p class="hint">Double-click (or press Enter) to edit the text. Drag a corner to change the width.</p>
  {/if}
</div>

<style>
  .label {
    font-weight: 600;
  }
  .value {
    float: right;
    font-weight: 400;
    color: var(--muted);
  }
  select {
    min-height: 36px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
</style>
