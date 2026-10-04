<script lang="ts">
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import { INK_COLORS, type TextAnnotation } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { FALLBACK_FONT, hasBold, hasItalic } from '../../lib/font-catalog';
  import { ensureFont, lastTextStyle, loadFonts } from '../../lib/fonts';
  import { layoutText } from '../../lib/text-layout';
  import { useViewer } from '../../lib/viewer.svelte';
  import FontPicker from '../../components/FontPicker.svelte';
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
  /** These change the line wrapping. */
  const RELAYOUT = new Set(['font', 'size', 'bold', 'italic']);

  type Key = 'font' | 'bold' | 'italic' | 'size' | 'color' | 'opacity';

  async function set<K extends Key>(key: K, value: TextAnnotation[K], label: string) {
    value = $state.snapshot(value) as TextAnnotation[K];
    (viewer.toolProps.text as Record<string, unknown>)[key] = value;
    if (key === 'font' || key === 'bold' || key === 'italic') (lastTextStyle as Record<string, unknown>)[key] = value;
    if (!sel) return;
    let next: TextAnnotation = { ...sel.annot, [key]: value };
    if (RELAYOUT.has(key)) {
      await Promise.all([loadFonts(), ensureFont(next.font)]);
      next = layoutText(next);
    }
    actions.updateAnnotation(sel.page.id, next, `Change ${label}`, `${key}:${sel.annot.id}`);
  }

  /** Load the font first; if it can't be loaded, say so calmly and use Sans serif. */
  async function chooseFont(font: string) {
    if (await ensureFont(font)) return set('font', font, 'font');
    viewer.notify("Couldn't load this font. Using Sans serif instead.");
    return set('font', FALLBACK_FONT, 'font');
  }

  const canBold = $derived(hasBold(props.font));
  const canItalic = $derived(hasItalic(props.font));
</script>

<PanelHeader title="Text" onClose={sel ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')} />

<div class="panel-form">
  {#if !sel}
    <p class="hint">Click on the page to type. Click an existing text box to change it.</p>
  {/if}
  <div class="field">
    <label for="tx-font">Font</label>
    <div class="font-row">
      <div class="picker"><FontPicker id="tx-font" value={props.font} onChange={chooseFont} /></div>
      <div class="styles" role="group" aria-label="Text style">
        <button
          type="button"
          class="style-btn"
          aria-label="Bold"
          title={canBold ? 'Bold' : 'This font has no bold'}
          aria-pressed={!!props.bold && canBold}
          disabled={!canBold}
          onclick={() => set('bold', !props.bold, 'bold')}><Bold size={18} strokeWidth={2} aria-hidden="true" /></button
        >
        <button
          type="button"
          class="style-btn"
          aria-label="Italic"
          title={canItalic ? 'Italic' : 'This font has no italic'}
          aria-pressed={!!props.italic && canItalic}
          disabled={!canItalic}
          onclick={() => set('italic', !props.italic, 'italic')}><Italic size={18} strokeWidth={2} aria-hidden="true" /></button
        >
      </div>
    </div>
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
  .font-row {
    display: flex;
    gap: var(--space-2);
  }
  .picker {
    flex: 1;
    min-width: 0;
  }
  .styles {
    display: flex;
    gap: var(--space-1);
  }
  .style-btn {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
  }
  .style-btn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .style-btn[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-strong);
  }
  .style-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  @media (max-width: 720px), (pointer: coarse) {
    .style-btn {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
  select {
    min-height: 36px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
</style>
