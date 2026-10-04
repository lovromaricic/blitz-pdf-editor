<script lang="ts">
  import { useActions } from '../../lib/actions.svelte';
  import { formatPageRange, parsePageRange } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';
  import Range from '../../components/Range.svelte';

  const viewer = useViewer();
  const actions = useActions();
  const doc = viewer.doc;

  let format = $state<'jpg' | 'png'>('jpg');
  let dpi = $state(150);
  let quality = $state(0.85);
  // svelte-ignore state_referenced_locally (prefilled once: the selection, or every page)
  let range = $state(viewer.selection.size > 0 ? formatPageRange(viewer.targetPages().map((p) => doc.pages.indexOf(p))) : `1-${doc.pages.length}`);
  const parsed = $derived(parsePageRange(range, doc.pages.length));

  // Rough size of one A4 page at this resolution, to help choose.
  const pixels = $derived(`${Math.round((8.27 * dpi) / 10) * 10} × ${Math.round((11.69 * dpi) / 10) * 10} px`);

  function run(e: SubmitEvent) {
    e.preventDefault();
    if (parsed) void actions.exportImages(parsed.map((i) => doc.pages[i]), format, dpi, quality);
  }
</script>

<PanelHeader title="Export as images" onClose={() => (viewer.panel = null)} />

<form class="panel-form" onsubmit={run}>
  <p class="hint">Each page becomes one image, exactly as shown here (markup, watermark and page numbers included).</p>
  <fieldset>
    <legend>Format</legend>
    <label class="option"><input type="radio" name="img-format" value="jpg" bind:group={format} /> JPG (smaller files, photos)</label>
    <label class="option"><input type="radio" name="img-format" value="png" bind:group={format} /> PNG (sharp text, larger files)</label>
  </fieldset>
  <div class="field">
    <label for="img-dpi">Resolution</label>
    <select id="img-dpi" bind:value={dpi}>
      <option value={72}>72 dpi (screen, small)</option>
      <option value={150}>150 dpi (good quality)</option>
      <option value={300}>300 dpi (print quality)</option>
    </select>
    <span class="hint">An A4 page becomes about {pixels}.</span>
  </div>
  {#if format === 'jpg'}
    <div class="field">
      <label for="img-quality">Quality <span class="value">{Math.round(quality * 100)}%</span></label>
      <Range id="img-quality" min={0.5} max={1} step={0.05} value={quality} onInput={(v) => (quality = v)} />
    </div>
  {/if}
  <div class="field">
    <label for="img-range">Pages</label>
    <input id="img-range" type="text" bind:value={range} aria-invalid={parsed === null} autocomplete="off" />
    <span class="hint">{parsed ? `${parsed.length} ${parsed.length === 1 ? 'image' : 'images'}${parsed.length > 1 ? ', downloaded as one .zip' : ''}` : `Enter pages between 1 and ${doc.pages.length}, e.g. 1-3, 5`}</span>
  </div>
  <div class="actions">
    <button type="submit" class="btn btn-primary" disabled={!parsed || !!viewer.task}>Export images</button>
  </div>
</form>

<style>
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
