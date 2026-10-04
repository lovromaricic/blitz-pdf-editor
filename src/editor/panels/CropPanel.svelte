<script lang="ts">
  import { formatPageRange, marginsFromDisplayed, setCrop, type Margins } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  const MM = 72 / 25.4;
  const sides = ['top', 'bottom', 'left', 'right'] as const;

  // Captured when the panel opens.
  // svelte-ignore state_referenced_locally
  const targets = viewer.targetPages();
  const reference = targets[0];
  // svelte-ignore state_referenced_locally
  // Explicitly selected pages: crop those. Nothing selected: most crops (scans, margins) apply to all.
  let scope = $state<'targets' | 'all'>(viewer.selection.size > 0 ? 'targets' : 'all');

  // Start from the reference page's existing crop, in mm as seen on screen.
  const start = reference ? doc.displayedCrop(reference) : { top: 0, right: 0, bottom: 0, left: 0 };
  let mm = $state<Record<(typeof sides)[number], number>>({
    top: round(start.top / MM),
    bottom: round(start.bottom / MM),
    left: round(start.left / MM),
    right: round(start.right / MM),
  });

  function round(n: number) {
    return Math.round(n * 10) / 10;
  }

  const pages = $derived(scope === 'all' ? doc.pages : targets.filter((p) => doc.pages.includes(p)));
  const margins = $derived<Margins>({
    top: (+mm.top || 0) * MM,
    bottom: (+mm.bottom || 0) * MM,
    left: (+mm.left || 0) * MM,
    right: (+mm.right || 0) * MM,
  });

  const invalid = $derived(
    sides.some((s) => !(+mm[s] >= 0)) ||
      pages.some((p) => {
        const size = doc.fullDisplaySize(p);
        return margins.left + margins.right >= size.width - 10 || margins.top + margins.bottom >= size.height - 10;
      }),
  );

  // Live preview on the canvas while this panel is open.
  $effect(() => {
    viewer.cropPreview = { ids: new Set(pages.map((p) => p.id)), margins };
  });
  $effect(() => () => (viewer.cropPreview = null));

  function apply(clear = false) {
    const ids = new Set(pages.map((p) => p.id));
    const next = setCrop(doc.pages, ids, (p) => (clear ? undefined : marginsFromDisplayed(margins, doc.totalRotation(p))));
    const n = pages.length;
    doc.edit(`${clear ? 'Remove crop from' : 'Crop'} ${n} ${n === 1 ? 'page' : 'pages'}`, next);
    viewer.panel = null;
    viewer.notify(clear ? 'Crop removed.' : `Cropped ${n} ${n === 1 ? 'page' : 'pages'}. The cut-off area is hidden, not deleted.`);
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!invalid) apply();
  }
</script>

<PanelHeader title="Crop pages" onClose={() => (viewer.panel = null)} />

<form class="panel-form" onsubmit={onSubmit}>
  <p>Trim the edges of pages. Shaded areas will be cut off.</p>
  <fieldset>
    <legend>Margins to remove (mm)</legend>
    <div class="grid">
      {#each sides as side (side)}
        <label class="cell">
          <span>{side[0].toUpperCase() + side.slice(1)}</span>
          <input type="number" min="0" step="1" bind:value={mm[side]} />
        </label>
      {/each}
    </div>
  </fieldset>
  <fieldset>
    <legend>Apply to</legend>
    {#if targets.length > 0}
      <label class="option">
        <input type="radio" name="crop-scope" value="targets" bind:group={scope} />
        {targets.length === 1 ? 'Page' : 'Pages'} {formatPageRange(targets.map((p) => doc.pages.indexOf(p)))}
      </label>
    {/if}
    <label class="option">
      <input type="radio" name="crop-scope" value="all" bind:group={scope} />
      All pages
    </label>
  </fieldset>
  {#if invalid}
    <p class="error" role="alert">The margins are larger than the page.</p>
  {/if}
  <div class="actions">
    <button type="submit" class="btn btn-primary" disabled={invalid}>Crop</button>
    <button type="button" class="btn" disabled={!pages.some((p) => p.crop)} onclick={() => apply(true)}>Remove crop</button>
  </div>
  <p class="hint">Cropping hides the edges; the content is still in the file. Undo with Ctrl+Z.</p>
</form>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .cell {
    display: grid;
    gap: 2px;
    min-width: 0;
    font-weight: 400;
  }
  .cell input {
    width: 100%;
    min-width: 0;
  }
</style>
