<script lang="ts">
  import { capturePointer } from '../lib/dom';
  import { tick } from 'svelte';
  import { rgbToCss, type Rgb } from '../lib/annotations';
  import { HANDWRITING } from '../lib/font-catalog';
  import { cssFamily, cssFontFor, ensureFont, loadFontPreviews, type FontPreviews } from '../lib/fonts';
  import FontName from '../components/FontName.svelte';
  import { fileToCanvas, removeWhiteBackground, SIGNATURE_INKS, trimCanvas } from '../lib/signature';
  import Swatches from '../components/Swatches.svelte';
  import { useViewer } from '../lib/viewer.svelte';

  const viewer = useViewer();

  let dialog: HTMLDialogElement;
  let tab = $state<'draw' | 'type' | 'upload'>('draw');
  let pad = $state<HTMLCanvasElement | null>(null);
  let hasInk = $state(false);
  let typed = $state('');
  let uploaded = $state<HTMLCanvasElement | null>(null);
  let uploadPreview = $state<string | null>(null);
  let removeBg = $state(true);
  let ink = $state<Rgb>(SIGNATURE_INKS[0].rgb);
  const inkColor = $derived(rgbToCss(ink));
  /** Handwriting font for typed signatures; fetched when chosen. */
  let typedFont = $state('dancing-script');
  let typedFontReady = $state(false);
  let previews = $state.raw<FontPreviews | null>(null);

  $effect(() => {
    if (tab !== 'type') return;
    void loadFontPreviews().then((p) => (previews = p));
    const font = typedFont;
    typedFontReady = false;
    void ensureFont(font).then((ok) => {
      if (font !== typedFont) return;
      typedFontReady = ok;
      if (!ok) error = "Couldn't load this font. Try another one.";
    });
  });
  let error = $state('');

  const PAD_W = 520;
  const PAD_H = 180;

  $effect(() => {
    if (viewer.signatureDialog && !dialog.open) {
      error = '';
      dialog.showModal();
      void tick().then(setupPad);
    } else if (!viewer.signatureDialog && dialog.open) {
      dialog.close();
    }
  });

  function close() {
    viewer.signatureDialog = false;
    // Choosing Sign without making a signature leaves the tool.
    if (!viewer.signature && viewer.tool === 'sign') viewer.setTool('select');
  }

  // --- Draw ---------------------------------------------------------------------

  let drawing = false;
  let last: [number, number] | null = null;

  function setupPad() {
    if (!pad) return;
    const dpr = window.devicePixelRatio || 1;
    pad.width = PAD_W * dpr;
    pad.height = PAD_H * dpr;
    const ctx = pad.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    hasInk = false;
  }

  function point(e: PointerEvent): [number, number] {
    const r = pad!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAD_W, ((e.clientY - r.top) / r.height) * PAD_H];
  }

  function onDown(e: PointerEvent) {
    if (!pad) return;
    e.preventDefault();
    capturePointer(pad, e.pointerId);
    drawing = true;
    last = point(e);
    stroke(last, last, e.pressure);
  }

  function onMove(e: PointerEvent) {
    if (!drawing || !last) return;
    for (const ev of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
      const p = point(ev);
      stroke(last, p, ev.pressure);
      last = p;
    }
  }

  function stroke(a: [number, number], b: [number, number], pressure: number) {
    const ctx = pad!.getContext('2d')!;
    ctx.strokeStyle = inkColor;
    // Pens report pressure; mice report 0.5.
    ctx.lineWidth = 1.5 + 2.5 * (pressure || 0.5);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    hasInk = true;
  }

  function clearPad() {
    pad?.getContext('2d')!.clearRect(0, 0, PAD_W, PAD_H);
    hasInk = false;
  }

  // --- Upload -------------------------------------------------------------------

  async function onFile(file: File | undefined) {
    error = '';
    if (!file) return;
    try {
      uploaded = await fileToCanvas(file);
      refreshUpload();
    } catch {
      error = 'That image could not be read. Try a PNG or JPG file.';
    }
  }

  function refreshUpload() {
    if (!uploaded) return;
    const copy = document.createElement('canvas');
    copy.width = uploaded.width;
    copy.height = uploaded.height;
    copy.getContext('2d')!.drawImage(uploaded, 0, 0);
    if (removeBg) removeWhiteBackground(copy);
    uploadPreview = copy.toDataURL('image/png');
    uploadCanvas = copy;
  }
  let uploadCanvas: HTMLCanvasElement | null = null;

  // --- Use ----------------------------------------------------------------------

  async function use() {
    error = '';
    let source: HTMLCanvasElement | null = null;
    if (tab === 'draw') {
      source = pad;
    } else if (tab === 'type') {
      if (!(await ensureFont(typedFont))) {
        error = "Couldn't load this font. Try another one.";
        return;
      }
      // Drawn large so the signature stays sharp when printed.
      const SIZE = 160;
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = cssFontFor({ font: typedFont }, SIZE);
      c.width = Math.ceil(ctx.measureText(typed).width) + SIZE;
      c.height = Math.ceil(SIZE * 2);
      ctx.font = cssFontFor({ font: typedFont }, SIZE);
      ctx.fillStyle = inkColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(typed, SIZE / 2, SIZE);
      source = c;
    } else {
      source = uploadCanvas;
    }
    const sig = source && trimCanvas(source);
    if (!sig) {
      error = 'The signature is empty.';
      return;
    }
    viewer.signature = sig;
    viewer.signatureDialog = false;
    if (viewer.tool !== 'sign') viewer.setTool('sign');
  }

  const ready = $derived(tab === 'draw' ? hasInk : tab === 'type' ? typed.trim().length > 0 : !!uploadPreview);
</script>

<dialog bind:this={dialog} aria-labelledby="sig-title" oncancel={(e) => { e.preventDefault(); close(); }}>
  <header>
    <h2 id="sig-title">Your signature</h2>
    <button type="button" class="close" aria-label="Close" onclick={close}>×</button>
  </header>

  <div class="tabs" role="tablist" aria-label="How to create your signature">
    {#each [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload image']] as [id, label] (id)}
      <button
        type="button"
        role="tab"
        id="sig-tab-{id}"
        aria-selected={tab === id}
        aria-controls="sig-panel"
        onclick={async () => {
          tab = id as typeof tab;
          if (id === 'draw') {
            await tick();
            setupPad();
          }
        }}>{label}</button
      >
    {/each}
  </div>

  <div class="body" id="sig-panel" role="tabpanel" aria-labelledby="sig-tab-{tab}">
    {#if tab === 'draw'}
      <canvas
        bind:this={pad}
        class="pad"
        aria-label="Signature pad: draw your signature with the mouse, a pen or your finger"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={() => (drawing = false)}
        onpointercancel={() => (drawing = false)}
      ></canvas>
      <div class="row">
        <button type="button" class="btn" onclick={clearPad} disabled={!hasInk}>Clear</button>
      </div>
    {:else if tab === 'type'}
      <label for="sig-typed">Type your name</label>
      <input id="sig-typed" type="text" bind:value={typed} autocomplete="name" maxlength="60" />
      <fieldset class="fonts">
        <legend>Style</legend>
        <div class="font-choices">
          {#each HANDWRITING as f (f.id)}
            <label class="font-choice" class:selected={typedFont === f.id}>
              <input type="radio" name="sig-font" value={f.id} bind:group={typedFont} />
              <FontName font={f.id} label={f.label} {previews} />
            </label>
          {/each}
        </div>
      </fieldset>
      <div class="typed-preview" style:color={inkColor} style:font-family={typedFontReady ? `"${cssFamily(typedFont)}"` : undefined}>
        {typed || ' '}
      </div>
    {:else}
      <label for="sig-file">Photo or scan of your signature (PNG or JPG)</label>
      <input id="sig-file" type="file" accept="image/png,image/jpeg,image/webp" onchange={(e) => onFile(e.currentTarget.files?.[0])} />
      <label class="option">
        <input type="checkbox" bind:checked={removeBg} onchange={refreshUpload} />
        Remove white background
      </label>
      {#if uploadPreview}
        <div class="upload-preview"><img src={uploadPreview} alt="Preview of the uploaded signature" /></div>
      {/if}
    {/if}

    {#if tab !== 'upload'}
      <div class="ink">
        <span class="ink-label" id="sig-ink">Ink</span>
        <Swatches label="Ink color" colors={SIGNATURE_INKS} value={ink} onChange={(c) => c && (ink = c)} />
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="hint">A picture of your signature, kept only until you close this tab. Not a certificate-based digital signature.</p>
  </div>

  <footer>
    <button type="button" class="btn" onclick={close}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={!ready} onclick={use}>Use this signature</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(600px, calc(100vw - 2 * var(--space-4)));
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
  }
  footer {
    justify-content: flex-end;
    border-top: var(--border-width) solid var(--border);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  .close {
    width: 32px;
    height: 32px;
    border: 0;
    background: none;
    font-size: var(--font-size-lg);
  }
  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-5);
    border-bottom: var(--border-width) solid var(--border);
  }
  [role='tab'] {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
  }
  [role='tab'] {
    color: var(--muted);
    font-weight: 600;
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }
  .body {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    font-size: var(--font-size-sm);
  }
  .pad {
    width: 100%;
    aspect-ratio: 520 / 180;
    border: var(--border-width) dashed var(--border);
    border-radius: var(--radius-md);
    background: var(--page);
    touch-action: none;
    cursor: crosshair;
  }
  .row {
    display: flex;
    justify-content: flex-end;
  }
  input[type='text'] {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
  }
  .typed-preview {
    min-height: 90px;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) dashed var(--border);
    border-radius: var(--radius-md);
    background: var(--page);
    font-size: 56px;
    line-height: 1.4;
    overflow: hidden;
    white-space: nowrap;
  }
  .upload-preview {
    padding: var(--space-3);
    border: var(--border-width) dashed var(--border);
    border-radius: var(--radius-md);
    background: repeating-conic-gradient(var(--surface-2) 0% 25%, var(--page) 0% 50%) 50% / 16px 16px;
  }
  .upload-preview img {
    display: block;
    max-width: 100%;
    max-height: 160px;
    margin: 0 auto;
  }
  .ink {
    display: grid;
    gap: var(--space-2);
  }
  .ink-label,
  .fonts legend {
    font-weight: 600;
  }
  .fonts {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .fonts legend {
    margin-bottom: var(--space-2);
  }
  .font-choices {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .font-choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    font-size: var(--font-size-base);
    cursor: pointer;
  }
  .font-choice.selected {
    border-color: var(--accent);
  }
  @media (max-width: 720px) {
    .font-choices {
      grid-template-columns: 1fr;
    }
  }
  .option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hint {
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  .error {
    font-weight: 600;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
