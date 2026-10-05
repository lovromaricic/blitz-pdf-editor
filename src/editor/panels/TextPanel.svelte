<script lang="ts">
  // Text formatting for the selected text box (or, with none, for new ones):
  // font and B / I / U / S, size, alignment, line spacing, color, background,
  // opacity. Formatting applies to whole boxes. Written for a list of boxes so
  // a mixed selection shows "Mixed"; the editor selects one at a time for now.
  import OrderControls from './OrderControls.svelte';
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import Underline from '@lucide/svelte/icons/underline';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import LinkIcon from '@lucide/svelte/icons/link';
  import ListIcon from '@lucide/svelte/icons/list';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import IndentDecrease from '@lucide/svelte/icons/list-indent-decrease';
  import IndentIncrease from '@lucide/svelte/icons/list-indent-increase';
  import { LIST_LABELS, type ListAction } from '../../lib/list-commands';
  import AlignLeft from '@lucide/svelte/icons/text-align-start';
  import AlignCenter from '@lucide/svelte/icons/text-align-center';
  import AlignRight from '@lucide/svelte/icons/text-align-end';
  import AlignJustify from '@lucide/svelte/icons/text-align-justify';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import { tick, type Component } from 'svelte';
  import { BACKGROUND_COLORS, INK_COLORS, type TextAlign, type TextAnnotation } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { FALLBACK_FONT } from '../../lib/font-catalog';
  import { ensureFont, lastTextStyle, loadFonts } from '../../lib/fonts';
  import { formatTextBox } from '../../lib/text-layout';
  import { runsOf, RUN_KEYS } from '../../lib/text-rich';
  import { editorFormatState } from '../../lib/rich-text/panel-state';
  import { ensureTextFont } from '../../lib/font-metrics-store.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import { isGroupId } from '../../lib/object-selection';
  import {
    ALIGNS,
    LINE_SPACINGS,
    MAX_TEXT_SIZE,
    MIN_TEXT_SIZE,
    isMixed,
    nextToggle,
    parseTextSize,
    pressed,
    stepTextSize,
    textFormatState,
  } from '../../lib/text-format';
  import { TEXT_SHORTCUTS } from '../../lib/text-shortcuts';
  import { COMMANDS, formatKeys } from '../../lib/commands';
  import { MIXED } from '../../lib/rich-text/mixed';
  import FontPicker from '../../components/FontPicker.svelte';
  import LocalFontsDialog from '../../components/LocalFontsDialog.svelte';
  import { localFontsSupported } from '../../lib/local-fonts.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';
  import Range from '../../components/Range.svelte';

  const viewer = useViewer();
  const actions = useActions();

  /** The text boxes being formatted (with their pages). */
  const targets = $derived.by(() => {
    // One text box, or several (all text, none in a group): the panel formats them all, Mixed where they differ.
    const s = actions.selectedObjects;
    if (!s || s.ids.some(isGroupId) || !s.members.every((a) => a.type === 'text')) return [];
    return s.members.map((annot) => ({ page: s.page, annot: annot as TextAnnotation }));
  });
  /** With nothing selected, the panel sets the style for new text boxes. */
  const items = $derived<TextAnnotation[]>(targets.length ? targets.map((t) => t.annot) : [viewer.toolProps.text as unknown as TextAnnotation]);
  /** While typing in a box: the selection's formats (or the typing style); otherwise the whole box. */
  const editor = $derived(viewer.textEditor);
  const fmt = $derived(editor ? editorFormatState(editor) : textFormatState(items));

  /** These change the line wrapping (and so the box height). */
  const RELAYOUT = new Set<keyof TextAnnotation>(['font', 'size', 'bold', 'italic', 'lineSpacing']);

  /** Apply a change to every target as one undo step (and remember it for new boxes). */
  async function apply(changes: Partial<TextAnnotation>, label: string, coalesceKey?: string) {
    changes = $state.snapshot(changes) as Partial<TextAnnotation>;
    Object.assign(viewer.toolProps.text, changes);
    for (const k of ['font', 'bold', 'italic'] as const) if (k in changes) (lastTextStyle as Record<string, unknown>)[k] = changes[k];
    const ed = viewer.textEditor;
    if (ed) {
      // Run formats go to the selected text (or the typing style); box settings to the box.
      const run = Object.fromEntries(Object.entries(changes).filter(([k]) => (RUN_KEYS as readonly string[]).includes(k)));
      const box = Object.fromEntries(Object.entries(changes).filter(([k]) => !(RUN_KEYS as readonly string[]).includes(k)));
      if (Object.keys(run).length) {
        if (run.font) await ensureTextFont(run.font as string);
        ed.format(run);
      }
      if (Object.keys(box).length) ed.setBox(box);
      return;
    }
    const list = targets;
    if (list.length === 0) return;
    const relayout = Object.keys(changes).some((k) => RELAYOUT.has(k as keyof TextAnnotation));
    if (relayout) await Promise.all([loadFonts(), ...list.flatMap((t) => [...new Set([changes.font ?? t.annot.font, ...runsOf(t.annot).map((r) => r.font)])].map(ensureTextFont))]);
    actions.updateAnnotations(
      // The whole box: box settings, and run formats on all its text. The width
      // stays as the user set it; the height follows the text.
      list.map((t) => ({ pageId: t.page.id, annot: formatTextBox(t.annot, changes) })),
      label,
      coalesceKey,
    );
  }

  /** Load the font first; if it can't be loaded, say so calmly and use Sans serif. */
  async function chooseFont(font: string) {
    if (await ensureTextFont(font)) return apply({ font }, 'Font');
    viewer.notify("Couldn't load this font. Using Sans serif instead.");
    return apply({ font: FALLBACK_FONT }, 'Font');
  }

  /** Shown only where the browser can list installed fonts (Chrome and Edge on desktop). */
  const canUseLocalFonts = localFontsSupported();
  let localOpen = $state(false);

  // --- B / I / U / S ----------------------------------------------------------------

  const toggles = $derived<{ key: 'bold' | 'italic' | 'underline' | 'strike'; label: string; icon: Component; available: boolean; missing?: string }[]>([
    { key: 'bold', label: 'Bold', icon: Bold, available: fmt.canBold, missing: 'This font has no bold' },
    { key: 'italic', label: 'Italic', icon: Italic, available: fmt.canItalic, missing: 'This font has no italic' },
    { key: 'underline', label: 'Underline', icon: Underline, available: true },
    { key: 'strike', label: 'Strikethrough', icon: Strikethrough, available: true },
  ]);

  function tooltip(t: (typeof toggles)[number]) {
    if (!t.available) return t.missing!;
    const keys = TEXT_SHORTCUTS[t.key];
    return keys ? `${t.label} (${keys})` : t.label;
  }

  // --- Link: while typing in a box -------------------------------------------------------

  const inLink = $derived(!!editor && editor.selection.link !== null && editor.selection.link !== MIXED);
  const linkLabel = $derived(inLink ? 'Edit link' : 'Add link');
  const linkTitle = $derived(editor ? `${linkLabel} (${formatKeys(COMMANDS['text.link'].keys[0])})` : 'Double-click a text box and select text to add a link');

  // --- Lists: while typing, on the paragraphs the selection touches; else on all paragraphs of the boxes ---

  const LIST_TOGGLES = [
    { kind: 'bullet' as const, label: LIST_LABELS.bullet, icon: ListIcon, keys: 'mod+shift+8' },
    { kind: 'number' as const, label: LIST_LABELS.number, icon: ListOrdered, keys: 'mod+shift+7' },
  ];
  const listState = $derived(editor ? editor.listState : actions.textBoxListState());
  /** Lists act on text boxes (being typed in, or selected), not on the defaults for new boxes. */
  const canList = $derived(!!editor || targets.length > 0);

  function runList(action: ListAction) {
    if (viewer.textEditor) viewer.textEditor.list(action);
    else actions.listOnTextBoxes(action);
  }

  // --- Size: − [field] + --------------------------------------------------------------

  let sizeText = $state('');
  let sizeFocused = $state(false);
  let sizeError = $state('');
  const currentSize = $derived(isMixed(fmt.size) ? null : fmt.size);
  $effect(() => {
    if (!sizeFocused) sizeText = currentSize === null ? '' : String(currentSize);
  });

  /** One stepper press (or a whole held press, sharing `key`) is one undo step. */
  let heldSize: number | null = null;
  function step(delta: number, key: string) {
    const from = heldSize ?? currentSize ?? (items[0]?.size ?? 12);
    heldSize = stepTextSize(from, delta);
    sizeText = String(heldSize);
    sizeError = '';
    void apply({ size: heldSize }, 'Font size', key);
  }

  let repeat: ReturnType<typeof setTimeout> | undefined;
  function stopHold() {
    clearTimeout(repeat);
    clearInterval(repeat);
    repeat = undefined;
    heldSize = null;
    window.removeEventListener('pointerup', stopHold);
    window.removeEventListener('pointercancel', stopHold);
  }
  /** Press and hold: one step now, then repeating after a short delay. */
  function startHold(e: PointerEvent, delta: number) {
    if (e.button !== 0) return;
    stopHold();
    const key = `size-hold:${Date.now()}`;
    step(delta, key);
    repeat = setTimeout(() => (repeat = setInterval(() => step(delta, key), 80)), 400);
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
  }
  /** Keyboard (Enter / Space) presses the stepper buttons with a click of detail 0. */
  function keyStep(e: MouseEvent, delta: number) {
    if (e.detail !== 0) return; // pointer presses are handled on pointerdown
    step(delta, `size-key:${Date.now()}`);
    heldSize = null;
  }

  let arrowKey = '';
  function onSizeKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      // A run of arrow presses in the field is one undo step.
      arrowKey ||= `size-arrows:${Date.now()}`;
      step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), arrowKey);
      heldSize = null;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitSize();
      // Done with the size: back to typing.
      viewer.textEditor?.focus();
    }
  }

  function commitSize() {
    const n = parseTextSize(sizeText);
    if (n === null) {
      // Rejected: say why and put the previous value back.
      sizeError = `Use a whole number from ${MIN_TEXT_SIZE} to ${MAX_TEXT_SIZE}.`;
      sizeText = currentSize === null ? '' : String(currentSize);
      return;
    }
    sizeError = '';
    if (n !== currentSize) void apply({ size: n }, 'Font size');
  }

  // --- Alignment: a radiogroup ----------------------------------------------------------

  const ALIGN_UI: Record<TextAlign, { label: string; icon: Component }> = {
    left: { label: 'Align left', icon: AlignLeft },
    center: { label: 'Align center', icon: AlignCenter },
    right: { label: 'Align right', icon: AlignRight },
    justify: { label: 'Justify', icon: AlignJustify },
  };

  function onAlignKey(e: KeyboardEvent, i: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + ALIGNS.length) % ALIGNS.length;
    void setAlign(ALIGNS[next]);
    ((e.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  function setAlign(align: TextAlign) {
    return apply({ align }, ALIGN_UI[align].label);
  }

  /**
   * While typing in a box, pressing a panel button doesn't take focus from the
   * text: you see what's selected, format it, and keep typing. (Fields and
   * selects still take focus, so they can be typed in.)
   */
  function keepTextFocus(node: HTMLElement) {
    const onDown = (e: MouseEvent) => {
      if (viewer.textEditor && (e.target as Element).closest('button, [role="option"], [role="radio"]')) e.preventDefault();
    };
    // Fields, selects and sliders need focus themselves: used with the mouse, they
    // give it back to the text (and its selection) once the change is made.
    const onPointer = () => (pointerUsed = true);
    const onKey = (e: KeyboardEvent) => {
      pointerUsed = false;
      // Shift+Tab from the first control goes back to the text.
      const first = node.querySelector<HTMLElement>(':is(button, input, select):not(:disabled)');
      if (e.key === 'Tab' && e.shiftKey && viewer.textEditor && document.activeElement === first) {
        e.preventDefault();
        viewer.textEditor.focus();
      }
    };
    const onChange = (e: Event) => {
      if ((e.target as Element).matches('select, input[type="range"]')) void tick().then(refocusText);
    };
    node.addEventListener('mousedown', onDown);
    node.addEventListener('pointerdown', onPointer, true);
    node.addEventListener('keydown', onKey, true);
    node.addEventListener('change', onChange);
    return () => {
      node.removeEventListener('mousedown', onDown);
      node.removeEventListener('pointerdown', onPointer, true);
      node.removeEventListener('keydown', onKey, true);
      node.removeEventListener('change', onChange);
    };
  }

  /** The last panel input was the mouse (or touch), not the keyboard. */
  let pointerUsed = false;
  /** Back to the text being edited, after a control used with the mouse. Keyboard users stay where they are. */
  function refocusText() {
    const ed = viewer.textEditor;
    if (!ed || !pointerUsed) return false;
    ed.focus();
    return true;
  }

  const formatSpacing = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
</script>

<PanelHeader title={targets.length > 1 ? `${targets.length} objects` : 'Text'} onClose={targets.length ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')} />

<div class="panel-form text-panel" class:selected={targets.length > 0} {@attach keepTextFocus}>
  {#if !targets.length}
    <p class="hint">Click on the page to type. Click an existing text box to change it.</p>
  {/if}

  <div class="field font">
    <label for="tx-font">Font</label>
    <FontPicker restoreFocus={refocusText} id="tx-font" value={isMixed(fmt.font) ? items[0].font : fmt.font} onChange={chooseFont}>
      {#snippet extra(close)}
        {#if canUseLocalFonts}
          <button
            type="button"
            class="local-btn"
            onclick={() => {
              close();
              localOpen = true;
            }}>My computer's fonts…</button
          >
        {/if}
      {/snippet}
    </FontPicker>
  </div>

  <div class="styles" role="group" aria-label="Text style">
    {#each toggles as t (t.key)}
      {@const value = fmt[t.key]}
      <button
        type="button"
        class="toggle"
        aria-label={t.label}
        title={tooltip(t)}
        aria-pressed={pressed(value, t.available)}
        disabled={!t.available}
        onclick={() => apply({ [t.key]: nextToggle(value) }, t.label)}
      >
        <t.icon size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    {/each}
    <button type="button" class="toggle" aria-label={linkLabel} title={linkTitle} aria-haspopup="dialog" disabled={!editor} onclick={() => editor?.openLink()}>
      <LinkIcon size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>

  <div class="field size">
    <label for="tx-size">Size (pt)</label>
    <div class="stepper">
      <button
        type="button"
        class="step"
        aria-label="Smaller"
        title="Smaller"
        disabled={currentSize !== null && currentSize <= MIN_TEXT_SIZE}
        onpointerdown={(e) => startHold(e, -1)}
        onclick={(e) => keyStep(e, -1)}><Minus size={18} strokeWidth={2} aria-hidden="true" /></button
      >
      <input
        id="tx-size"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        placeholder={currentSize === null ? 'Mixed' : undefined}
        bind:value={sizeText}
        aria-invalid={sizeError ? 'true' : undefined}
        aria-describedby={sizeError ? 'tx-size-error' : undefined}
        onfocus={() => ((sizeFocused = true), (arrowKey = ''))}
        onblur={() => {
          sizeFocused = false;
          commitSize();
        }}
        onkeydown={onSizeKey}
      />
      <button
        type="button"
        class="step"
        aria-label="Larger"
        title="Larger"
        disabled={currentSize !== null && currentSize >= MAX_TEXT_SIZE}
        onpointerdown={(e) => startHold(e, 1)}
        onclick={(e) => keyStep(e, 1)}><Plus size={18} strokeWidth={2} aria-hidden="true" /></button
      >
    </div>
    {#if sizeError}<span class="error" id="tx-size-error" role="alert">{sizeError}</span>{/if}
  </div>

  <div class="field align">
    <span class="label" id="tx-align-label">Alignment</span>
    <div class="aligns" role="radiogroup" aria-labelledby="tx-align-label">
      {#each ALIGNS as a, i (a)}
        {@const checked = fmt.align === a}
        {@const Icon = ALIGN_UI[a].icon}
        <button
          type="button"
          role="radio"
          class="align-btn"
          aria-checked={checked}
          aria-label={ALIGN_UI[a].label}
          title={ALIGN_UI[a].label}
          tabindex={checked || (isMixed(fmt.align) && i === 0) ? 0 : -1}
          onclick={() => setAlign(a)}
          onkeydown={(e) => onAlignKey(e, i)}><Icon size={18} strokeWidth={2} aria-hidden="true" /></button
        >
      {/each}
    </div>
  </div>

  <div class="field list">
    <span class="label" id="tx-list-label">List</span>
    <div class="styles" role="group" aria-labelledby="tx-list-label">
      {#each LIST_TOGGLES as t (t.kind)}
        <button
          type="button"
          class="toggle"
          aria-label={t.label}
          title={`${t.label} (${formatKeys(t.keys)})`}
          aria-pressed={listState.list === 'mixed' ? 'mixed' : listState.list === t.kind}
          disabled={!canList}
          onclick={() => runList({ type: 'toggle', kind: t.kind })}><t.icon size={18} strokeWidth={2} aria-hidden="true" /></button
        >
      {/each}
      <button type="button" class="toggle" aria-label={LIST_LABELS.decrease} title={LIST_LABELS.decrease} disabled={!canList || !listState.canDecrease} onclick={() => runList({ type: 'indent', delta: -1 })}
        ><IndentDecrease size={18} strokeWidth={2} aria-hidden="true" /></button
      >
      <button type="button" class="toggle" aria-label={LIST_LABELS.increase} title={LIST_LABELS.increase} disabled={!canList || !listState.canIncrease} onclick={() => runList({ type: 'indent', delta: 1 })}
        ><IndentIncrease size={18} strokeWidth={2} aria-hidden="true" /></button
      >
    </div>
    {#if listState.anyList && (fmt.align === 'center' || fmt.align === 'right')}
      <span class="hint">Lists stay left-aligned.</span>
    {/if}
  </div>

  <div class="field">
    <label for="tx-spacing">Line spacing</label>
    <select id="tx-spacing" value={isMixed(fmt.lineSpacing) ? '' : String(fmt.lineSpacing)} onchange={(e) => apply({ lineSpacing: +e.currentTarget.value }, 'Line spacing')}>
      {#if isMixed(fmt.lineSpacing)}<option value="" disabled>Mixed</option>{/if}
      {#each LINE_SPACINGS as v (v)}
        <option value={String(v)}>{formatSpacing(v)}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <span class="label">Color</span>
    <Swatches
      restoreFocus={refocusText}
      label="Text color"
      colors={INK_COLORS}
      value={isMixed(fmt.color) ? null : fmt.color}
      mixed={isMixed(fmt.color)}
      onChange={(c) => c && apply({ color: c }, 'Text color')}
    />
  </div>

  <div class="field">
    <span class="label">Background</span>
    <Swatches
      restoreFocus={refocusText}
      label="Background"
      colors={BACKGROUND_COLORS}
      allowNone
      value={isMixed(fmt.background) ? null : fmt.background}
      mixed={isMixed(fmt.background)}
      onChange={(c) => apply({ background: c }, 'Background')}
    />
  </div>

  <div class="field">
    <label for="tx-opacity">Opacity <span class="value">{isMixed(fmt.opacity) ? 'Mixed' : `${Math.round(fmt.opacity * 100)}%`}</span></label>
    <Range
      id="tx-opacity"
      min={0.1}
      max={1}
      step={0.05}
      value={isMixed(fmt.opacity) ? 1 : fmt.opacity}
      valueText={isMixed(fmt.opacity) ? 'Mixed' : `${Math.round(fmt.opacity * 100)}%`}
      onInput={(v) => apply({ opacity: v }, 'Opacity', `opacity:${targets.map((t) => t.annot.id).join(',')}`)}
    />
  </div>

  {#if canUseLocalFonts}
    <LocalFontsDialog open={localOpen} onClose={() => (localOpen = false)} onChoose={(font) => apply({ font }, 'Font')} />
  {/if}
  {#if targets.length}
    <OrderControls />
    <div class="actions delete">
      <button type="button" class="btn btn-danger" onclick={() => actions.deleteSelection()}>Delete</button>
    </div>
    <p class="hint">Double-click (or press Enter) to edit the text. Drag a corner to change the width.</p>
  {/if}
</div>

<style>
  .label {
    font-weight: 600;
  }
  .value {
    float: right;
    font-weight: 400;
    color: var(--muted);
  }
  .styles,
  .aligns {
    display: flex;
    gap: var(--space-2);
  }
  /* Font, then the style toggles right under it. */
  .font {
    margin-bottom: calc(-1 * var(--space-3));
  }
  .toggle,
  .step,
  .align-btn {
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
  .toggle:hover:not(:disabled),
  .step:hover:not(:disabled),
  .align-btn:hover {
    background: var(--surface-2);
  }
  .toggle[aria-pressed='true'],
  .align-btn[aria-checked='true'] {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent);
  }
  /* Mixed: a dashed outline, neither on nor off. */
  .toggle[aria-pressed='mixed'] {
    border-style: dashed;
    color: var(--accent);
  }
  .toggle:disabled,
  .step:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* Alignment: four joined buttons. */
  .aligns {
    gap: 0;
  }
  .align-btn {
    flex: 1;
    width: auto;
    border-radius: 0;
    margin-left: calc(-1 * var(--border-width));
  }
  .align-btn:first-child {
    margin-left: 0;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }
  .align-btn:last-child {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }
  .align-btn:focus-visible {
    position: relative;
    z-index: 1;
  }
  .stepper {
    display: flex;
    gap: var(--space-2);
  }
  .stepper input {
    width: 4.5rem;
    text-align: center;
  }
  .local-btn {
    min-height: 36px;
    padding: 0 var(--space-2);
    border: 0;
    border-top: var(--border-width) solid var(--border);
    background: none;
    color: var(--accent-strong);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-align: left;
  }
  .local-btn:hover {
    background: var(--surface-2);
  }
  select {
    min-height: 36px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  @media (max-width: 720px), (pointer: coarse) {
    .toggle,
    .step,
    .align-btn {
      width: var(--touch-target);
      height: var(--touch-target);
    }
    .align-btn {
      width: auto;
    }
    .local-btn {
      min-height: var(--touch-target);
    }
  }

  /* Phones (bottom sheet): Font on its own row, then the toggles, then Size and
     Alignment side by side; Delete stays in reach at the bottom of the sheet. */
  @media (max-width: 720px) {
    .text-panel {
      grid-template-columns: auto 1fr;
      column-gap: var(--space-3);
    }
    .text-panel > :global(*) {
      grid-column: 1 / -1;
    }
    .text-panel > .size {
      grid-column: 1;
    }
    .text-panel > .align {
      grid-column: 2;
    }
    .stepper input {
      width: 3.25rem;
    }
    .font {
      margin-bottom: 0;
    }
    .delete {
      position: sticky;
      bottom: 0;
      padding: var(--space-2) 0;
      background: var(--surface);
    }
  }
</style>
