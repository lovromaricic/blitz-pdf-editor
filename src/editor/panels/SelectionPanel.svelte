<script lang="ts">
  // Several selected objects, or a group. Several: "3 objects", then what they
  // all share: their color when they're all one kind with a color, opacity,
  // order and Delete ("Mixed" where values differ). A group: "Group (3
  // objects)", order and Delete only (ungroup to change its objects).
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import { HIGHLIGHT_COLORS, INK_COLORS, NOTE_COLORS, sameRgb, STAMP_COLORS, type Annotation, type Rgb, type ShapeAnnotation } from '../../lib/annotations';
  import { isClosed, NEEDS_FILL_OR_OUTLINE, outlineOf, withOutline } from '../../lib/shape-style';
  import { groupSize, isGroupId } from '../../lib/object-selection';
  import Swatches from '../../components/Swatches.svelte';
  import Range from '../../components/Range.svelte';
  import PanelHeader from './PanelHeader.svelte';
  import OrderControls from './OrderControls.svelte';

  const viewer = useViewer();
  const actions = useActions();
  const sel = $derived(actions.selectedObjects);
  const group = $derived(sel && sel.ids.length === 1 && isGroupId(sel.ids[0]) ? sel.ids[0] : null);
  const title = $derived(!sel ? '' : group ? `Group (${groupSize(sel.list, group)} objects)` : `${sel.ids.length} objects`);

  /** One kind with a color palette (images have no color; mixed kinds share none). */
  const PALETTES: Record<string, { name: string; rgb: Rgb }[]> = { ink: INK_COLORS, shape: INK_COLORS, highlight: HIGHLIGHT_COLORS, note: NOTE_COLORS, stamp: STAMP_COLORS };
  const kind = $derived(sel && sel.members.every((a) => a.type === sel.members[0].type) ? sel.members[0].type : null);
  const palette = $derived(kind ? PALETTES[kind] : undefined);
  const color = $derived(sel && sel.members.every((a) => sameRgb(a.color, sel.members[0].color)) ? sel.members[0].color : null);
  const opacity = $derived(sel && sel.members.every((a) => a.opacity === sel.members[0].opacity) ? sel.members[0].opacity : null);
  /** All rectangles and ellipses: their outline can be off ("No outline"), mixed when only some have one. */
  const closed = $derived(sel && sel.members.every((a) => a.type === 'shape' && isClosed(a)) ? (sel.members as ShapeAnnotation[]) : null);
  const outline = $derived(closed ? outlineOf(closed) : null);

  /** Outline color or none for all of them, one undo step; refused when any would end up with neither fill nor outline. */
  function setOutline(c: Rgb | null) {
    if (!closed) return;
    const next = closed.map((a) => withOutline(a, c));
    if (next.includes('invisible')) {
      refused = true;
      viewer.announce(NEEDS_FILL_OR_OUTLINE);
      clearTimeout(refusedTimer);
      refusedTimer = setTimeout(() => (refused = false), 4000);
      return;
    }
    actions.updateAnnotations(
      (next as ShapeAnnotation[]).map((a) => ({ pageId: sel!.page.id, annot: a })),
      c ? 'Change outline' : 'No outline',
    );
  }
  let refused = $state(false);
  let refusedTimer: ReturnType<typeof setTimeout> | undefined;

  /** One change to every selected object: one undo step (a slider drag too). */
  function apply(change: (a: Annotation) => Annotation, label: string, coalesceKey?: string) {
    const s = sel;
    if (!s) return;
    actions.updateAnnotations(
      s.members.map((a) => ({ pageId: s.page.id, annot: change(a) })),
      label,
      coalesceKey,
    );
  }
</script>

<PanelHeader {title} onClose={() => viewer.selectObjects(null)} />

{#if sel}
  <div class="panel-form">
    {#if !group}
      {#if closed && outline}
        <div class="field">
          <span class="label">Outline</span>
          <Swatches label="Outline color" colors={INK_COLORS} value={outline.value} mixed={outline.mixed} allowNone noneLabel="No outline" onChange={setOutline} />
          {#if refused}<p class="error" role="status">{NEEDS_FILL_OR_OUTLINE}</p>{/if}
        </div>
      {:else if palette}
        <div class="field">
          <span class="label">Color</span>
          <Swatches label="Color" colors={palette} value={color} mixed={!color} onChange={(c) => c && apply((a) => ({ ...a, color: c }), 'Color')} />
        </div>
      {/if}
      <div class="field">
        <label for="sel-opacity">Opacity <span class="value">{opacity === null ? 'Mixed' : `${Math.round(opacity * 100)}%`}</span></label>
        <Range
          id="sel-opacity"
          min={0.1}
          max={1}
          step={0.05}
          value={opacity ?? sel.members[0].opacity}
          valueText={opacity === null ? 'Mixed' : `${Math.round(opacity * 100)}%`}
          onInput={(v) => apply((a) => ({ ...a, opacity: v }), 'Change opacity', `opacity:${sel.ids.join(',')}`)}
        />
      </div>
    {/if}
    <OrderControls />
    <div class="actions">
      <button type="button" class="btn btn-danger" onclick={() => actions.deleteSelection()}>Delete</button>
    </div>
    {#if group}
      <p class="hint">Drag to move the group. To change one of its objects, ungroup it first (right-click › Ungroup).</p>
    {:else}
      <p class="hint">Drag any of them to move them all. Arrow keys nudge; Delete removes them.</p>
    {/if}
  </div>
{/if}
