<script lang="ts">
  // View › Margin size › Custom…: one margin for all four sides of every page.
  // A popover under the menu on desktop and tablet, a bottom sheet on phones.
  // The guides follow a valid value as it's typed; Apply sets it, Cancel (or
  // Escape, or a click outside) puts the guides back. Enter applies.
  import { onMount } from 'svelte';
  import { cycleTab, portal } from '../lib/dom';
  import { checkMargin, convertTyped, formatMargin, maxMarginMm, rangeText, type MarginUnit } from '../lib/margins';
  import { NEW_PDF_STRINGS } from '../lib/strings';
  import { useViewer } from '../lib/viewer.svelte';

  let { anchor, phone, onClose }: { anchor: DOMRect | null; phone: boolean; onClose: () => void } = $props();

  const viewer = useViewer();

  let unit = $state<MarginUnit>(viewer.marginUnit);
  let text = $state(formatMargin(viewer.marginMm, viewer.marginUnit));
  /** After a refused Apply, an empty field is an error too (before that only a typed wrong value is). */
  let tried = $state(false);

  const sizes = viewer.pageSizes();
  const maxMm = maxMarginMm(sizes);
  /** Pages of different sizes (either way up): the smallest one sets the maximum. */
  const mixed = sizes.some((s) => Math.abs(Math.min(s.width, s.height) - Math.min(sizes[0].width, sizes[0].height)) > 0.5 || Math.abs(Math.max(s.width, s.height) - Math.max(sizes[0].width, sizes[0].height)) > 0.5);

  const check = $derived(checkMargin(text, unit, maxMm));
  const error = $derived(!check.ok && (tried || text.trim() !== '') ? check.error : '');

  // The live preview: the guides show a valid value as it's typed (nothing else changes).
  $effect(() => {
    viewer.marginPreviewMm = check.ok ? check.mm : null;
  });

  let root: HTMLDivElement;
  let field: HTMLInputElement;
  let height = $state(0);
  let width = $state(0);
  let keyboard = $state(0);
  let returnTo: HTMLElement | null = null;

  onMount(() => {
    returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    field.focus();
    field.select();
    // A click outside cancels (it does whatever it does there too).
    const onDown = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    // Phones: keep the sheet above the on-screen keyboard.
    const vv = window.visualViewport;
    const fit = () => vv && (keyboard = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)));
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      viewer.marginPreviewMm = null;
    };
  });

  /** Under the menu, inside the window. */
  const place = $derived.by(() => {
    if (phone) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor?.left ?? (vw - width) / 2, vw - width - 8));
    const top = Math.max(8, Math.min((anchor?.bottom ?? 48) + 6, vh - height - 8));
    return { left, top };
  });

  function close(focusBack = true) {
    viewer.marginPreviewMm = null;
    onClose();
    if (!focusBack) return;
    (returnTo?.isConnected ? returnTo : document.getElementById('editor-main'))?.focus({ preventScroll: true });
  }

  function changeUnit(next: MarginUnit) {
    text = convertTyped(text, unit, next);
    unit = next;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    tried = true;
    if (!check.ok) {
      viewer.announce(check.error);
      field.focus();
      return;
    }
    viewer.marginUnit = unit;
    viewer.setMargin(check.mm);
    close();
  }

  function onKey(e: KeyboardEvent) {
    // The editor's and the app's shortcuts stay out of the form.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else cycleTab(e, root);
  }
</script>

<div
  bind:this={root}
  class="margin-form"
  class:sheet={phone}
  style:left={place ? `${place.left}px` : undefined}
  style:top={place ? `${place.top}px` : undefined}
  style:bottom={phone ? `${keyboard}px` : undefined}
  bind:clientHeight={height}
  bind:clientWidth={width}
  role="dialog"
  aria-labelledby="margin-form-title"
  tabindex="-1"
  onkeydown={onKey}
  {@attach portal}
>
  <form class="panel-form" onsubmit={submit} novalidate>
    <h2 id="margin-form-title" class="title">Margin size</h2>
    <div class="field">
      <label for="margin-value">Margin</label>
      <div class="value-row">
        <input
          bind:this={field}
          id="margin-value"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
          bind:value={text}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'margin-error margin-help' : 'margin-help'}
        />
        <select aria-label={NEW_PDF_STRINGS.unit} value={unit} onchange={(e) => changeUnit(e.currentTarget.value as MarginUnit)}>
          <option value="mm">{NEW_PDF_STRINGS.units.mm}</option>
          <option value="in">{NEW_PDF_STRINGS.units.in}</option>
        </select>
      </div>
      {#if error}<span class="error" id="margin-error">{error}</span>{/if}
      <span class="hint" id="margin-help">
        All four sides, every page: {rangeText(maxMm, unit)}.{#if mixed}
          The pages differ in size: the smallest one sets the maximum.{/if}
      </span>
    </div>
    <div class="buttons">
      <button type="button" class="btn" onclick={() => close()}>Cancel</button>
      <button type="submit" class="btn btn-primary">Apply</button>
    </div>
  </form>
</div>

<style>
  .margin-form {
    position: fixed;
    z-index: 300;
    box-sizing: border-box;
    width: min(300px, calc(100vw - 16px));
    padding: var(--space-4);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-overlay);
  }
  /* Phones: a bottom sheet across the screen. */
  .margin-form.sheet {
    right: 0;
    left: 0;
    width: auto;
    max-height: 80dvh;
    overflow-y: auto;
    padding: var(--space-4) 16px;
    border-width: var(--border-width) 0 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .panel-form {
    gap: var(--space-3);
  }
  .title {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 700;
  }
  .value-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .buttons .btn {
    width: auto;
  }
  @media (max-width: 720px) {
    .buttons .btn {
      flex: 1;
    }
  }
</style>
