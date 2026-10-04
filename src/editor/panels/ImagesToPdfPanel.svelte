<script lang="ts">
  import { DEFAULT_IMAGE_OPTIONS, useActions } from '../../lib/actions.svelte';
  import { IMAGE_ACCEPT } from '../../lib/image-input';
  import type { PageSizeChoice } from '../../lib/pdf/images-to-pdf';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();

  let items = $state<{ key: number; file: File; url: string }[]>([]);
  let pageSize = $state<PageSizeChoice>(DEFAULT_IMAGE_OPTIONS.pageSize);
  let margin = $state(DEFAULT_IMAGE_OPTIONS.margin);
  let input: HTMLInputElement;
  let key = 0;

  function add(files: FileList | null) {
    if (!files) return;
    items = [...items, ...Array.from(files).map((file) => ({ key: ++key, file, url: URL.createObjectURL(file) }))];
    input.value = '';
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
  }

  function remove(i: number) {
    URL.revokeObjectURL(items[i].url);
    items = items.filter((_, k) => k !== i);
  }

  $effect(() => () => items.forEach((it) => URL.revokeObjectURL(it.url)));

  const options = $derived({ pageSize, margin });
</script>

<PanelHeader title="Create PDF from images" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  <p class="hint">One image per page, in this order. Photos keep their quality.</p>
  <ol class="images" aria-label="Images">
    {#each items as it, i (it.key)}
      <li>
        <img src={it.url} alt="" />
        <span class="name">{it.file.name}</span>
        <span class="controls">
          <button type="button" class="mini" aria-label="Move {it.file.name} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
          <button type="button" class="mini" aria-label="Move {it.file.name} down" disabled={i === items.length - 1} onclick={() => move(i, 1)}>↓</button>
          <button type="button" class="mini" aria-label="Remove {it.file.name}" onclick={() => remove(i)}>×</button>
        </span>
      </li>
    {:else}
      <li class="empty">No images yet.</li>
    {/each}
  </ol>
  <button type="button" class="btn" onclick={() => input.click()}>+ Add images</button>
  <input bind:this={input} class="visually-hidden" type="file" accept={IMAGE_ACCEPT} multiple tabindex="-1" aria-hidden="true" onchange={(e) => add(e.currentTarget.files)} />

  <div class="field">
    <label for="img-size">Page size</label>
    <select id="img-size" bind:value={pageSize}>
      <option value="a4">A4</option>
      <option value="letter">Letter</option>
      <option value="image">Same as each image</option>
    </select>
  </div>
  <div class="field">
    <label for="img-margin">Margin</label>
    <select id="img-margin" bind:value={margin}>
      <option value={0}>None</option>
      <option value={28}>Small (1 cm)</option>
      <option value={57}>Large (2 cm)</option>
    </select>
  </div>
  <div class="actions">
    <button type="button" class="btn btn-primary" disabled={!items.length || !!viewer.task} onclick={() => actions.createFromImages(items.map((i) => i.file), options)}>Create new PDF</button>
    <button type="button" class="btn" disabled={!items.length || !!viewer.task} onclick={() => actions.insertImages(items.map((i) => i.file), options)}>Add to this document</button>
  </div>
</div>

<style>
  .images {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  li.empty {
    justify-content: center;
    padding: var(--space-3);
    color: var(--color-text-muted);
  }
  img {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 2px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .controls {
    display: flex;
    gap: 2px;
  }
  .mini {
    width: 28px;
    height: 28px;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }
  @media (max-width: 640px), (pointer: coarse) {
    .mini {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
  .mini:disabled {
    opacity: 0.35;
  }
  select {
    min-height: 36px;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }
</style>
