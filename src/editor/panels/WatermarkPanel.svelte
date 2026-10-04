<script lang="ts">
  import type { Rgb } from '../../lib/annotations';
  import { WATERMARK_SIZES, type WatermarkSettings } from '../../lib/settings';
  import { useViewer } from '../../lib/viewer.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  const COLORS: { name: string; rgb: Rgb }[] = [
    { name: 'Gray', rgb: [0.45, 0.45, 0.45] },
    { name: 'Red', rgb: [0.8, 0.1, 0.1] },
    { name: 'Blue', rgb: [0.1, 0.35, 0.8] },
    { name: 'Black', rgb: [0, 0, 0] },
  ];

  const current = $derived(doc.settings.watermark);
  // Draft used before a watermark exists; once added, edits go straight to the document.
  let draft = $state<WatermarkSettings>({ text: 'CONFIDENTIAL', size: 'medium', color: COLORS[0].rgb, opacity: 0.25, angle: 45, pages: 'all' });
  const w = $derived(current ?? draft);
  const selected = $derived(viewer.selection.size > 0 ? [...viewer.selection] : null);

  function set<K extends keyof WatermarkSettings>(key: K, value: WatermarkSettings[K]) {
    value = $state.snapshot(value) as WatermarkSettings[K];
    if (current) doc.editSettings('Change watermark', { ...doc.settings, watermark: { ...current, [key]: value } }, `watermark:${key}`);
    else draft = { ...draft, [key]: value };
  }

  function add() {
    if (!draft.text.trim()) return;
    doc.editSettings('Add watermark', { ...doc.settings, watermark: $state.snapshot(draft) as WatermarkSettings });
  }

  function remove() {
    const { watermark: _, ...rest } = doc.settings;
    doc.editSettings('Remove watermark', rest);
  }
</script>

<PanelHeader title="Watermark" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  <p class="hint">{current ? 'Changes show on the pages straight away.' : 'Text printed across your pages, for example DRAFT or CONFIDENTIAL.'}</p>
  <div class="field">
    <label for="wm-text">Text</label>
    <input id="wm-text" type="text" maxlength="60" value={w.text} oninput={(e) => set('text', e.currentTarget.value)} />
  </div>
  <fieldset>
    <legend>Size</legend>
    {#each Object.keys(WATERMARK_SIZES) as s (s)}
      <label class="option"><input type="radio" name="wm-size" checked={w.size === s} onchange={() => set('size', s as WatermarkSettings['size'])} /> {s[0].toUpperCase() + s.slice(1)}</label>
    {/each}
  </fieldset>
  <fieldset>
    <legend>Direction</legend>
    <label class="option"><input type="radio" name="wm-angle" checked={w.angle === 45} onchange={() => set('angle', 45)} /> Diagonal</label>
    <label class="option"><input type="radio" name="wm-angle" checked={w.angle === 0} onchange={() => set('angle', 0)} /> Horizontal</label>
  </fieldset>
  <div class="field">
    <span class="label">Color</span>
    <Swatches label="Watermark color" colors={COLORS} value={w.color} onChange={(c) => c && set('color', c)} />
  </div>
  <div class="field">
    <label for="wm-opacity">Opacity <span class="value">{Math.round(w.opacity * 100)}%</span></label>
    <input id="wm-opacity" type="range" min="0.05" max="0.8" step="0.05" value={w.opacity} oninput={(e) => set('opacity', +e.currentTarget.value)} />
  </div>
  <fieldset>
    <legend>Pages</legend>
    <label class="option"><input type="radio" name="wm-pages" checked={w.pages === 'all'} onchange={() => set('pages', 'all')} /> All pages</label>
    <label class="option">
      <input type="radio" name="wm-pages" checked={w.pages !== 'all'} disabled={!selected && w.pages === 'all'} onchange={() => selected && set('pages', selected)} />
      {w.pages !== 'all' ? `${w.pages.length} selected ${w.pages.length === 1 ? 'page' : 'pages'}` : selected ? `Selected pages (${selected.length})` : 'Selected pages (select thumbnails first)'}
    </label>
  </fieldset>
  <div class="actions">
    {#if current}
      <button type="button" class="btn" onclick={remove}>Remove watermark</button>
    {:else}
      <button type="button" class="btn btn-primary" disabled={!draft.text.trim()} onclick={add}>Add watermark</button>
    {/if}
  </div>
  <p class="hint">The watermark becomes part of the page content when you save.</p>
</div>

<style>
  .label {
    font-weight: 600;
  }
  .value {
    float: right;
    font-weight: 400;
    color: var(--color-text-muted);
  }
  input[type='range'] {
    width: 100%;
  }
</style>
