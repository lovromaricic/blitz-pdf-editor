<script lang="ts">
  import { formatPageNumber, type NumberFormat, type NumberPosition, type PageNumberSettings } from '../../lib/settings';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  const current = $derived(doc.settings.pageNumbers);
  let draft = $state<PageNumberSettings>({ position: 'bottom-center', format: 'n', firstNumber: 1, fromPage: 1, size: 10 });
  const s = $derived(current ?? draft);

  const positions: [NumberPosition, string][] = [
    ['bottom-center', 'Bottom center'],
    ['bottom-right', 'Bottom right'],
    ['bottom-left', 'Bottom left'],
    ['top-center', 'Top center'],
    ['top-right', 'Top right'],
    ['top-left', 'Top left'],
  ];
  const formats: NumberFormat[] = ['n', 'page-n', 'n-of-total', 'page-n-of-total'];

  function set<K extends keyof PageNumberSettings>(key: K, value: PageNumberSettings[K]) {
    if (current) doc.editSettings('Change page numbers', { ...doc.settings, pageNumbers: { ...current, [key]: value } }, `numbers:${key}`);
    else draft = { ...draft, [key]: value };
  }

  function add() {
    doc.editSettings('Add page numbers', { ...doc.settings, pageNumbers: { ...draft } });
  }

  function remove() {
    const { pageNumbers: _, ...rest } = doc.settings;
    doc.editSettings('Remove page numbers', rest);
  }

  const total = $derived(doc.pages.length);
</script>

<PanelHeader title="Page numbers" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  <div class="field">
    <label for="pn-pos">Position</label>
    <select id="pn-pos" value={s.position} onchange={(e) => set('position', e.currentTarget.value as NumberPosition)}>
      {#each positions as [id, label] (id)}<option value={id}>{label}</option>{/each}
    </select>
  </div>
  <div class="field">
    <label for="pn-format">Format</label>
    <select id="pn-format" value={s.format} onchange={(e) => set('format', e.currentTarget.value as NumberFormat)}>
      {#each formats as f (f)}<option value={f}>{formatPageNumber(f, s.firstNumber, s.firstNumber + total - s.fromPage)}</option>{/each}
    </select>
  </div>
  <div class="field">
    <label for="pn-from">Start on page</label>
    <input id="pn-from" type="number" min="1" max={total} value={s.fromPage} onchange={(e) => set('fromPage', Math.min(total, Math.max(1, Math.round(+e.currentTarget.value) || 1)))} />
    <span class="hint">Pages before this one get no number (e.g. a cover page).</span>
  </div>
  <div class="field">
    <label for="pn-first">First number</label>
    <input id="pn-first" type="number" min="0" value={s.firstNumber} onchange={(e) => set('firstNumber', Math.max(0, Math.round(+e.currentTarget.value) || 0))} />
  </div>
  <div class="field">
    <label for="pn-size">Size (pt)</label>
    <input id="pn-size" type="number" min="6" max="36" value={s.size} onchange={(e) => set('size', Math.min(36, Math.max(6, +e.currentTarget.value || 10)))} />
  </div>
  <div class="actions">
    {#if current}
      <button type="button" class="btn" onclick={remove}>Remove page numbers</button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={add}>Add page numbers</button>
    {/if}
  </div>
  <p class="hint">Numbers follow the page order, also after you reorder or delete pages.</p>
</div>

<style>
  select {
    min-height: 36px;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }
</style>
