<script lang="ts">
  // The PDF's own content selected with Edit content: what was detected (read
  // only) and Delete. Deleting removes it from the file itself; undo brings it back.
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import { rgbToCss } from '../../lib/annotations';
  import { CONTENT_STRINGS as S } from '../../lib/strings';
  import PanelHeader from './PanelHeader.svelte';
  import { MediaQuery } from 'svelte/reactivity';

  const viewer = useViewer();
  const coarse = new MediaQuery('(pointer: coarse)');
  const actions = useActions();

  const items = $derived.by(() => {
    const sel = viewer.contentSelection;
    const page = sel && viewer.doc.pages.find((p) => p.id === sel.pageId);
    if (!sel || !page) return [];
    const a = viewer.content.get(viewer.doc.source(page), page.sourceIndex);
    if (!a || typeof a !== 'object') return [];
    return sel.ids.map((id) => a.items.find((i) => i.id === id)).filter((i) => !!i);
  });
  const one = $derived(items.length === 1 ? items[0] : null);
  const title = $derived(one ? (one.kind === 'text' ? S.originalText : S.originalImage) : S.originalItems(items.length));
  const blocked = $derived(items.find((i) => i.blocked)?.blocked);
  const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
</script>

{#if items.length}
  <PanelHeader {title} onClose={() => viewer.selectContent(null)} />
{:else}
  <PanelHeader title={S.tool} />
  <div class="panel-form">
    <p>{coarse.current ? S.panelHintTouch : S.panelHint}</p>
  </div>
{/if}

{#if items.length}
  <div class="panel-form">
    {#if one?.kind === 'text'}
      <p class="hint">{S.readOnly}</p>
      <dl>
        <dt>{S.font}</dt>
        <dd>{one.font}</dd>
        <dt>{S.size}</dt>
        <dd>{one.size} pt</dd>
        {#if one.color}
          <dt>{S.color}</dt>
          <dd><span class="swatch" style:background={rgbToCss(one.color)} aria-hidden="true"></span>{hex(one.color)}</dd>
        {/if}
      </dl>
    {:else if one?.kind === 'image'}
      <p class="hint">{S.readOnly}</p>
      <dl>
        <dt>{S.pixelSize}</dt>
        <dd>{one.width} × {one.height} px</dd>
      </dl>
    {/if}
    <div class="actions">
      {#if one?.kind === 'text'}
        <button type="button" class="btn btn-primary" disabled={!actions.canEditContent()} onclick={() => actions.editContent()}>{S.edit}</button>
      {/if}
      <button type="button" class="btn btn-danger" disabled={!actions.canDeleteContent()} onclick={() => actions.deleteContent()}>{S.delete}</button>
    </div>
    {#if blocked}
      <p class="error" role="status">{blocked}</p>
    {:else}
      {#if one?.kind === 'text'}
        <p class="hint">{one.noConvert ?? S.editHint}</p>
      {/if}
      <p class="hint">{S.deleteHint}</p>
    {/if}
  </div>
{/if}

<style>
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
  }
</style>
