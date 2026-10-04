<script lang="ts">
  // Properties of the active markup tool, or of the selected annotation.
  // Changing a selected annotation also becomes the tool's default for the next one.
  import { describe, HIGHLIGHT_COLORS, INK_COLORS, type Annotation, type Rgb, type ShapeKind } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();

  const sel = $derived(actions.selectedAnnot);
  /** Which tool's settings we're showing. */
  const kind = $derived.by((): 'highlight' | 'draw' | 'shapes' | null => {
    const t = sel?.annot.type ?? viewer.tool;
    if (t === 'highlight') return 'highlight';
    if (t === 'ink' || t === 'draw') return 'draw';
    if (t === 'shape' || t === 'shapes') return 'shapes';
    return null;
  });

  const props = $derived.by(() => {
    if (sel) return sel.annot;
    if (kind === 'highlight') return viewer.toolProps.highlight;
    if (kind === 'draw') return viewer.toolProps.draw;
    return viewer.toolProps.shapes;
  }) as { color: Rgb; opacity: number; width?: number; fill?: Rgb | null; shape?: ShapeKind };

  const titles = { highlight: 'Highlight', draw: 'Draw', shapes: 'Shapes' };

  function set(key: 'color' | 'opacity' | 'width' | 'fill', value: unknown, label: string) {
    value = $state.snapshot(value);
    if (sel) {
      const next = { ...sel.annot, [key]: value } as Annotation;
      actions.updateAnnotation(sel.page.id, next, `Change ${label}`, `${key}:${sel.annot.id}`);
    }
    if (kind) (viewer.toolProps[kind] as Record<string, unknown>)[key] = value;
  }

  const shapeKinds: { id: ShapeKind; label: string }[] = [
    { id: 'rect', label: 'Rectangle' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'line', label: 'Line' },
    { id: 'arrow', label: 'Arrow' },
  ];
  const hasFill = $derived(kind === 'shapes' && (props.shape === 'rect' || props.shape === 'ellipse'));
</script>

{#if kind}
  <PanelHeader
    title={sel ? describe(sel.annot) : titles[kind]}
    onClose={sel ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')}
  />

  <div class="panel-form">
    {#if !sel}
      <p class="hint">
        {#if kind === 'highlight'}
          Select text to highlight it. On scanned pages, drag a box instead.
        {:else if kind === 'draw'}
          Drag on the page to draw. Each stroke can be moved or deleted with the Select tool.
        {:else}
          Drag on the page to draw a shape. Hold Shift for squares, circles and straight angles.
        {/if}
      </p>
    {/if}

    {#if kind === 'shapes' && !sel}
      <div class="field">
        <span class="label" id="shape-kind">Shape</span>
        <div class="segmented" role="radiogroup" aria-labelledby="shape-kind">
          {#each shapeKinds as s (s.id)}
            <button
              type="button"
              role="radio"
              aria-checked={viewer.toolProps.shapes.shape === s.id}
              onclick={() => (viewer.toolProps.shapes.shape = s.id)}>{s.label}</button
            >
          {/each}
        </div>
      </div>
    {/if}

    <div class="field">
      <span class="label">{kind === 'shapes' ? 'Outline' : 'Color'}</span>
      <Swatches
        label={kind === 'shapes' ? 'Outline color' : 'Color'}
        colors={kind === 'highlight' ? HIGHLIGHT_COLORS : INK_COLORS}
        value={props.color}
        onChange={(c) => c && set('color', c, 'color')}
      />
    </div>

    {#if hasFill}
      <div class="field">
        <span class="label">Fill</span>
        <Swatches label="Fill color" colors={INK_COLORS} value={props.fill ?? null} allowNone onChange={(c) => set('fill', c, 'fill')} />
      </div>
    {/if}

    {#if kind !== 'highlight'}
      <div class="field">
        <label for="mk-width">Thickness <span class="value">{props.width} pt</span></label>
        <input
          id="mk-width"
          type="range"
          min="0.5"
          max="20"
          step="0.5"
          value={props.width}
          oninput={(e) => set('width', +e.currentTarget.value, 'thickness')}
        />
      </div>
    {/if}

    <div class="field">
      <label for="mk-opacity">Opacity <span class="value">{Math.round(props.opacity * 100)}%</span></label>
      <input
        id="mk-opacity"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        value={props.opacity}
        oninput={(e) => set('opacity', +e.currentTarget.value, 'opacity')}
      />
    </div>

    {#if kind === 'highlight' && !sel}
      <label class="option">
        <input type="checkbox" bind:checked={viewer.toolProps.highlight.wholeLine} />
        Highlight whole line
      </label>
    {/if}

    {#if sel}
      <div class="actions">
        <button type="button" class="btn" onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}>
          {sel.annot.type === 'highlight' ? 'Remove highlight' : 'Delete'}
        </button>
      </div>
      <p class="hint">Drag to move{sel.annot.type === 'highlight' ? '' : ', drag the corners to resize'}. Arrow keys nudge; Delete removes.</p>
    {/if}
  </div>
{/if}

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
  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }
  .segmented button {
    min-height: 32px;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    font-size: var(--font-size-sm);
  }
  .segmented button[aria-checked='true'] {
    background: var(--color-active-bg);
    border-color: var(--color-border-strong);
    font-weight: 600;
  }
</style>
