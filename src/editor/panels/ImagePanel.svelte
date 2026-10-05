<script lang="ts">
  // Properties of an inserted image: position and size, rotation, flip, opacity,
  // stacking order. Every change is one undo step; values follow live while the
  // image is dragged on the page.
  // Mirror left-right: triangles either side of a vertical line (and the other way round).
  import FlipHorizontal from '@lucide/svelte/icons/triangles-centerline-dashed-vertical';
  import FlipVertical from '@lucide/svelte/icons/triangles-centerline-dashed-horizontal';
  import BringToFront from '@lucide/svelte/icons/bring-to-front';
  import SendToBack from '@lucide/svelte/icons/send-to-back';
  import type { ImageAnnotation } from '../../lib/annotations';
  import { useActions, type Actions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import { defaultImageSize, frameToImage, imageFrame, normalizeAngle, type Frame } from '../../lib/image-geometry';
  import { storedImage } from '../../lib/image-store';
  import { IMAGE_STRINGS as T } from '../../lib/strings';
  import { ICON } from '../tools';
  import Range from '../../components/Range.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();
  const MM = 72 / 25.4;

  const sel = $derived.by(() => {
    const s = actions.selectedAnnot;
    return s && s.annot.type === 'image' ? { page: s.page, annot: s.annot as ImageAnnotation } : null;
  });
  /** The image as shown right now (while it's dragged, the live position). */
  const image = $derived(sel && viewer.livePreview?.id === sel.annot.id ? (viewer.livePreview as ImageAnnotation) : sel?.annot ?? null);

  type PageView = Awaited<ReturnType<Actions['pagePoints']>>;
  let view = $state.raw<PageView | null>(null);
  $effect(() => {
    const page = sel?.page;
    if (!page) return;
    let alive = true;
    void actions.pagePoints(page).then((v) => alive && (view = v));
    return () => {
      alive = false;
    };
  });

  /** In points, from the page's top-left as shown. */
  const frame = $derived(image && view ? imageFrame(image, view.toShown, 1, view.rotation) : null);
  const stored = $derived(image?.imageKey ? storedImage(image.imageKey) : undefined);

  type Field = 'x' | 'y' | 'w' | 'h' | 'angle';
  let errors = $state<Partial<Record<Field, string>>>({});

  const mm = (pt: number) => (Math.round((pt / MM) * 10) / 10).toString();

  function apply(f: Frame, label: string) {
    if (!sel || !view) return;
    actions.updateAnnotation(sel.page.id, frameToImage(sel.annot, f, view.toPdf, 1, view.rotation), label);
  }

  function update(changes: Partial<ImageAnnotation>, label: string, coalesceKey?: string) {
    if (sel) actions.updateAnnotation(sel.page.id, { ...sel.annot, ...changes }, label, coalesceKey);
  }

  /** Parse a typed number (a comma works as the decimal point too). */
  function parse(text: string): number | null {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) ? v : null;
  }

  function setField(field: Field, text: string) {
    if (!frame || !view) return;
    const v = parse(text);
    if (v === null) return (errors[field] = T.invalidNumber);
    const f = frame;
    const { width, height } = view.size;
    let next: Frame;
    if (field === 'angle') {
      next = { ...f, turn: f.turn - (image?.angle ?? 0) + normalizeAngle(v) };
    } else if (field === 'x' || field === 'y') {
      const left = field === 'x' ? v * MM : f.cx - f.w / 2;
      const top = field === 'y' ? v * MM : f.cy - f.h / 2;
      next = { ...f, cx: left + f.w / 2, cy: top + f.h / 2 };
      // Like dragging: the image's center stays on the page.
      if (next.cx < 0 || next.cx > width || next.cy < 0 || next.cy > height) return (errors[field] = T.offPage);
    } else {
      const size = v * MM;
      if (v < 1) return (errors[field] = T.tooSmall);
      if (size > 10 * Math.max(width, height)) return (errors[field] = T.tooLarge);
      let w = field === 'w' ? size : f.w;
      let h = field === 'h' ? size : f.h;
      if (viewer.imageAspectLock) [w, h] = field === 'w' ? [w, (w * f.h) / f.w] : [(h * f.w) / f.h, h];
      // The top-left corner stays where it is.
      next = { ...f, w, h, cx: f.cx - f.w / 2 + w / 2, cy: f.cy - f.h / 2 + h / 2 };
    }
    errors[field] = undefined;
    apply(next, field === 'angle' ? 'Rotate image' : field === 'x' || field === 'y' ? 'Move image' : 'Resize image');
  }

  function resetSize() {
    if (!frame || !view || !stored) return;
    const [w, h] = defaultImageSize([stored.width, stored.height], [view.size.width, view.size.height]);
    apply({ ...frame, w, h }, 'Reset image size');
  }

  const canFront = $derived(sel ? actions.canReorder(sel.page.id, sel.annot.id, 'front') : false);
  const canBack = $derived(sel ? actions.canReorder(sel.page.id, sel.annot.id, 'back') : false);
</script>

<PanelHeader title={T.panelTitle} onClose={() => viewer.selectAnnot(null)} />

{#if sel && image}
  <div class="panel-form">
    <fieldset>
      <legend>{T.position}</legend>
      <div class="grid">
        {#each [['x', T.x, frame && frame.cx - frame.w / 2], ['y', T.y, frame && frame.cy - frame.h / 2], ['w', T.width, frame?.w], ['h', T.height, frame?.h]] as const as [field, label, value] (field)}
          <div class="field">
            <label for="img-{field}">{label}</label>
            <input
              id="img-{field}"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              value={value == null ? '' : mm(value)}
              aria-invalid={errors[field] ? 'true' : undefined}
              aria-describedby={errors[field] ? `img-${field}-error` : undefined}
              onchange={(e) => setField(field, e.currentTarget.value)}
            />
            {#if errors[field]}<span class="error" id="img-{field}-error">{errors[field]}</span>{/if}
          </div>
        {/each}
      </div>
      <label class="option">
        <input type="checkbox" bind:checked={viewer.imageAspectLock} />
        {T.lockAspect}
      </label>
    </fieldset>

    <div class="field">
      <label for="img-angle">{T.rotation}</label>
      <div class="row">
        <input
          id="img-angle"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          value={String(Math.round((image.angle ?? 0) * 10) / 10)}
          aria-invalid={errors.angle ? 'true' : undefined}
          aria-describedby={errors.angle ? 'img-angle-error' : undefined}
          onchange={(e) => setField('angle', e.currentTarget.value)}
        />
        <button type="button" class="link" disabled={!image.angle} onclick={() => update({ angle: 0 }, 'Reset rotation')}>{T.resetRotation}</button>
      </div>
      {#if errors.angle}<span class="error" id="img-angle-error">{errors.angle}</span>{/if}
    </div>

    <div class="field">
      <span class="label" id="img-flip-label">{T.flip}</span>
      <div class="toggles" role="group" aria-labelledby="img-flip-label">
        <button
          type="button"
          class="toggle"
          aria-label={T.flipHorizontal}
          title={T.flipHorizontal}
          aria-pressed={!!image.flipX}
          onclick={() => update({ flipX: !image.flipX }, 'Flip image')}><FlipHorizontal {...ICON} aria-hidden="true" /></button
        >
        <button
          type="button"
          class="toggle"
          aria-label={T.flipVertical}
          title={T.flipVertical}
          aria-pressed={!!image.flipY}
          onclick={() => update({ flipY: !image.flipY }, 'Flip image')}><FlipVertical {...ICON} aria-hidden="true" /></button
        >
      </div>
    </div>

    <div class="field">
      <label for="img-opacity">{T.opacity} <span class="value">{Math.round(image.opacity * 100)}%</span></label>
      <Range
        id="img-opacity"
        min={0.1}
        max={1}
        step={0.05}
        value={image.opacity}
        valueText="{Math.round(image.opacity * 100)}%"
        onInput={(v) => update({ opacity: v }, 'Change opacity', `opacity:${image.id}`)}
      />
    </div>

    <div class="field">
      <span class="label" id="img-order-label">{T.order}</span>
      <div class="row-buttons" role="group" aria-labelledby="img-order-label">
        <button type="button" class="btn" disabled={!canFront} onclick={() => actions.reorderAnnotation(sel.page.id, sel.annot.id, 'front')}>
          <BringToFront size={18} strokeWidth={ICON.strokeWidth} aria-hidden="true" />{T.bringToFront}
        </button>
        <button type="button" class="btn" disabled={!canBack} onclick={() => actions.reorderAnnotation(sel.page.id, sel.annot.id, 'back')}>
          <SendToBack size={18} strokeWidth={ICON.strokeWidth} aria-hidden="true" />{T.sendToBack}
        </button>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn" disabled={!stored} onclick={resetSize}>{T.resetSize}</button>
      <button type="button" class="btn btn-danger" onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}>{T.delete}</button>
    </div>
    <p class="hint">{T.hint}</p>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .grid input {
    width: 100%;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .row input {
    width: 6rem;
  }
  .link {
    min-height: 32px;
    padding: 0 var(--space-1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent-strong);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:disabled {
    color: var(--muted);
    text-decoration: none;
    cursor: default;
  }
  .toggles {
    display: flex;
    gap: var(--space-1);
  }
  .toggle {
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
  .toggle:hover {
    background: var(--surface-2);
  }
  .toggle[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-strong);
  }
  .row-buttons .btn {
    font-size: var(--font-size-sm);
  }
  @media (max-width: 720px), (pointer: coarse) {
    .toggle {
      width: var(--touch-target);
      height: var(--touch-target);
    }
    .link {
      min-height: var(--touch-target);
    }
  }
</style>
