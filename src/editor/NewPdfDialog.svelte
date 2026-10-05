<script lang="ts">
  // File › New blank PDF…: page size (or a custom one), orientation and page
  // count, with a live preview of the page shape. A bottom sheet on phones.
  import { tick } from 'svelte';
  import RectangleVertical from '@lucide/svelte/icons/rectangle-vertical';
  import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
  import { formatIn, lastNewPdf, MAX_PAGES, orient, PAGE_SIZES, parseNumber, rememberNewPdf, UNIT_PT, validateNewPdf, type NewPdfChoice, type NewPdfErrors, type SizeId, type Unit } from '../lib/new-pdf';
  import { NEW_PDF_STRINGS as T } from '../lib/strings';
  import { ICON } from './tools';

  let { open, onCreate, onCancel }: { open: boolean; onCreate: (size: { width: number; height: number; pages: number }) => void; onCancel: () => void } = $props();

  let dialog: HTMLDialogElement;
  let sizeSelect = $state<HTMLSelectElement | null>(null);
  let choice = $state<NewPdfChoice>({ ...lastNewPdf });
  let errors = $state<NewPdfErrors>({});

  $effect(() => {
    if (open && !dialog.open) {
      // Start from this session's last choices.
      choice = { ...lastNewPdf };
      errors = {};
      dialog.showModal();
      void tick().then(() => sizeSelect?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  /** The page as it would be created (for the preview), or null while the custom size is invalid. */
  const shape = $derived.by(() => {
    const r = validateNewPdf({ ...choice, pages: '1' });
    return r.ok ? r : null;
  });

  const previewLabel = $derived(shape ? `${formatIn(shape.width, choice.unit)} × ${formatIn(shape.height, choice.unit)} ${choice.unit}` : '');

  /** Switching to Custom fills the fields with the last chosen size. */
  function setSize(size: SizeId) {
    if (size === 'custom' && choice.size !== 'custom') {
      const p = PAGE_SIZES[choice.size];
      const [w, h] = orient(p.width, p.height, choice.orientation);
      choice.width = formatIn(w, choice.unit);
      choice.height = formatIn(h, choice.unit);
    }
    choice.size = size;
    errors = {};
  }

  /** Changing the unit converts what's typed, so the size stays the same. */
  function setUnit(unit: Unit) {
    const convert = (text: string) => {
      const v = parseNumber(text);
      return v === null ? text : formatIn(v * UNIT_PT[choice.unit], unit);
    };
    choice.width = convert(choice.width);
    choice.height = convert(choice.height);
    choice.unit = unit;
  }

  function setOrientation(o: 'portrait' | 'landscape') {
    if (o === choice.orientation) return;
    choice.orientation = o;
    // Custom fields follow, so what's shown matches what's created.
    const w = parseNumber(choice.width);
    const h = parseNumber(choice.height);
    if (choice.size === 'custom' && w !== null && h !== null && (o === 'portrait' ? w > h : w < h)) [choice.width, choice.height] = [choice.height, choice.width];
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const r = validateNewPdf(choice);
    if (!r.ok) {
      errors = r.errors;
      // Take keyboard users to the first problem.
      const first = (['width', 'height', 'pages'] as const).find((k) => r.errors[k]);
      void tick().then(() => dialog.querySelector<HTMLInputElement>(`#np-${first}`)?.focus());
      return;
    }
    rememberNewPdf($state.snapshot(choice));
    onCreate({ width: r.width, height: r.height, pages: r.pages });
  }

  /** Enter creates from a select too (only text fields submit a form by themselves). */
  function onSelectKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }

  const PREVIEW_BOX = 88;
</script>

<dialog
  bind:this={dialog}
  class="new-pdf"
  aria-labelledby="np-title"
  oncancel={(e) => {
    e.preventDefault();
    onCancel();
  }}
>
  {#if open}
    <form onsubmit={submit} novalidate>
      <h2 id="np-title">{T.title}</h2>
      <div class="body">
        <div class="fields">
          <div class="field">
            <label for="np-size">{T.pageSize}</label>
            <select id="np-size" bind:this={sizeSelect} onkeydown={onSelectKey} value={choice.size} onchange={(e) => setSize(e.currentTarget.value as SizeId)}>
              {#each Object.entries(PAGE_SIZES) as [id, s] (id)}
                <option value={id}>{s.label}</option>
              {/each}
              <option value="custom">{T.custom}</option>
            </select>
          </div>

          {#if choice.size === 'custom'}
            <div class="custom">
              <div class="field">
                <label for="np-width">{T.width}</label>
                <input
                  id="np-width"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  bind:value={choice.width}
                  aria-invalid={errors.width ? 'true' : undefined}
                  aria-describedby={errors.width ? 'np-width-error' : undefined}
                />
              </div>
              <div class="field">
                <label for="np-height">{T.height}</label>
                <input
                  id="np-height"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  bind:value={choice.height}
                  aria-invalid={errors.height ? 'true' : undefined}
                  aria-describedby={errors.height ? 'np-height-error' : undefined}
                />
              </div>
              <div class="field">
                <label for="np-unit">{T.unit}</label>
                <select id="np-unit" onkeydown={onSelectKey} value={choice.unit} onchange={(e) => setUnit(e.currentTarget.value as Unit)}>
                  {#each Object.entries(T.units) as [u, label] (u)}
                    <option value={u}>{label}</option>
                  {/each}
                </select>
              </div>
            </div>
            {#if errors.width}<p class="error" id="np-width-error">{T.width}: {errors.width}</p>{/if}
            {#if errors.height}<p class="error" id="np-height-error">{T.height}: {errors.height}</p>{/if}
          {/if}

          <fieldset>
            <legend>{T.orientation}</legend>
            <div class="orientations">
              {#each [['portrait', T.portrait, RectangleVertical], ['landscape', T.landscape, RectangleHorizontal]] as const as [value, label, Icon] (value)}
                <label class="orientation">
                  <input type="radio" name="np-orientation" {value} checked={choice.orientation === value} onchange={() => setOrientation(value)} />
                  <Icon {...ICON} aria-hidden="true" />
                  <span>{label}</span>
                </label>
              {/each}
            </div>
          </fieldset>

          <div class="field">
            <label for="np-pages">{T.pages}</label>
            <input
              id="np-pages"
              class="pages"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={choice.pages}
              aria-invalid={errors.pages ? 'true' : undefined}
              aria-describedby={errors.pages ? 'np-pages-error' : 'np-pages-hint'}
            />
            {#if errors.pages}<p class="error" id="np-pages-error">{errors.pages}</p>{:else}<p class="hint" id="np-pages-hint">1 to {MAX_PAGES}</p>{/if}
          </div>
        </div>

        <div class="preview" role="img" aria-label={shape ? T.preview(previewLabel) : T.preview('—')}>
          {#if shape}
            {@const k = PREVIEW_BOX / Math.max(shape.width, shape.height)}
            <div class="paper" style:width="{Math.max(4, shape.width * k)}px" style:height="{Math.max(4, shape.height * k)}px"></div>
            <span class="size" aria-hidden="true">{previewLabel}</span>
          {/if}
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn" onclick={onCancel}>{T.cancel}</button>
        <button type="submit" class="btn btn-primary">{T.create}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-5);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-overlay);
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  form {
    display: grid;
    gap: var(--space-4);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  .body {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-5);
    align-items: start;
  }
  .fields {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  label,
  legend {
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  select,
  input[type='text'] {
    min-height: 38px;
    padding: 0 var(--space-3);
    font-size: var(--font-size-md);
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr 1fr 5.5rem;
    gap: var(--space-2);
  }
  .custom input {
    width: 100%;
    min-width: 0;
  }
  .pages {
    width: 6rem;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .error {
    color: var(--danger);
    font-size: var(--font-size-xs);
    font-weight: 600;
  }
  .hint {
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: var(--space-1);
    padding: 0;
  }
  .orientations {
    display: flex;
    gap: var(--space-2);
  }
  /* Each option is a tile; the radio inside is hidden, its tile shows state and the one focus ring. */
  .orientation {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 38px;
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    font-weight: 400;
    cursor: pointer;
  }
  .orientation input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
  }
  .orientation:has(input:checked) {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
    color: var(--accent-strong);
  }
  .orientation:has(input:focus-visible) {
    outline: var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .preview {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: var(--space-2);
    width: 112px;
    padding-top: var(--space-5);
  }
  .paper {
    background: var(--page);
    border: var(--border-width) solid var(--border);
    border-radius: 2px;
  }
  .size {
    color: var(--muted);
    font-size: var(--font-size-xs);
    text-align: center;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* Phones: a bottom sheet with finger-sized controls. */
  @media (max-width: 720px) {
    dialog {
      width: 100%;
      max-width: 100%;
      margin: auto 0 0;
      padding: var(--space-4) 16px;
      border-width: var(--border-width) 0 0;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    }
    .body {
      grid-template-columns: 1fr;
    }
    .preview {
      grid-auto-flow: column;
      justify-content: start;
      align-items: center;
      width: auto;
      padding-top: 0;
    }
    select,
    input[type='text'],
    .orientation,
    .btn {
      min-height: var(--touch-target);
    }
    .actions .btn {
      flex: 1;
    }
  }
</style>
