<script lang="ts">
  // Properties of the active markup tool, or of the selected annotation.
  // Changing a selected annotation also becomes the tool's default for the next one.
  import { describe, HIGHLIGHT_COLORS, INK_COLORS, type Annotation, type Rgb, type ShapeKind } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';
  import Range from '../../components/Range.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Component } from 'svelte';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Circle from '@lucide/svelte/icons/circle';
  import Slash from '@lucide/svelte/icons/slash';
  import Square from '@lucide/svelte/icons/square';
  import { ICON } from '../tools';

  const viewer = useViewer();
  const actions = useActions();
  const coarse = new MediaQuery('(pointer: coarse)');

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

  const shapeKinds: { id: ShapeKind; label: string; icon: Component }[] = [
    { id: 'rect', label: 'Rectangle', icon: Square },
    { id: 'ellipse', label: 'Ellipse', icon: Circle },
    { id: 'line', label: 'Line', icon: Slash },
    { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  ];

  /** Radio group keys: arrows move and choose (wrapping), like native radios. */
  function onShapeKey(e: KeyboardEvent, i: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + shapeKinds.length) % shapeKinds.length;
    viewer.toolProps.shapes.shape = shapeKinds[next].id;
    ((e.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }
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
          {coarse.current ? 'Drag your finger across text to highlight it.' : 'Select text to highlight it. On scanned pages, drag a box instead.'}
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
        <div class="shape-kinds" role="radiogroup" aria-labelledby="shape-kind">
          {#each shapeKinds as k, i (k.id)}
            {@const checked = viewer.toolProps.shapes.shape === k.id}
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={k.label}
              tabindex={checked ? 0 : -1}
              onclick={() => (viewer.toolProps.shapes.shape = k.id)}
              onkeydown={(e) => onShapeKey(e, i)}
            >
              <k.icon size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
              <span class="kind-label" aria-hidden="true">{k.label}</span>
            </button>
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
        <Range id="mk-width" min={0.5} max={20} step={0.5} value={props.width ?? 2} onInput={(v) => set('width', v, 'thickness')} />
      </div>
    {/if}

    <div class="field">
      <label for="mk-opacity">Opacity <span class="value">{Math.round(props.opacity * 100)}%</span></label>
      <Range id="mk-opacity" min={0.1} max={1} step={0.05} value={props.opacity} onInput={(v) => set('opacity', v, 'opacity')} />
    </div>

    {#if kind === 'highlight' && !sel}
      <label class="option">
        <input type="checkbox" bind:checked={viewer.toolProps.highlight.wholeLine} />
        Highlight whole line
      </label>
    {/if}

    {#if sel}
      <div class="actions">
        <button
          type="button"
          class="btn"
          class:btn-danger={sel.annot.type !== 'highlight'}
          onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}
        >
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
    color: var(--muted);
  }
  .shape-kinds {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }
  .shape-kinds button {
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-1);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-size-xs);
    transition: background var(--transition-fast);
  }
  .shape-kinds button:hover:not([aria-checked='true']) {
    background: var(--surface-2);
  }
  /* Selected: accent icon; the small label uses the strong accent for contrast on the soft fill. */
  .shape-kinds button[aria-checked='true'] {
    border-color: var(--accent-soft);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .shape-kinds button[aria-checked='true'] .kind-label {
    color: var(--accent-strong);
    font-weight: 600;
  }
  @media (max-width: 720px), (pointer: coarse) {
    .shape-kinds button {
      min-height: var(--touch-target);
    }
  }
</style>
