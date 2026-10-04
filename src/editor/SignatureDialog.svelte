<script lang="ts">
  import { capturePointer } from '../lib/dom';
  import '@fontsource/dancing-script/400.css';
  import { tick } from 'svelte';
  import { fileToCanvas, removeWhiteBackground, SIGNATURE_FONT, SIGNATURE_INKS, trimCanvas } from '../lib/signature';
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
  let inkColor = $state<string>(SIGNATURE_INKS[0].css);
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
      await document.fonts.load(`64px ${SIGNATURE_FONT}`);
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = `96px ${SIGNATURE_FONT}`;
      c.width = Math.ceil(ctx.measureText(typed).width) + 40;
      c.height = 160;
      ctx.font = `96px ${SIGNATURE_FONT}`;
      ctx.fillStyle = inkColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(typed, 20, 80);
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
      <div class="typed-preview" style:color={inkColor} style:font-family={SIGNATURE_FONT}>{typed || ' '}</div>
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
      <fieldset class="ink">
        <legend>Ink</legend>
        {#each SIGNATURE_INKS as ink (ink.css)}
          <label class="option"><input type="radio" name="ink" value={ink.css} bind:group={inkColor} /> {ink.name}</label>
        {/each}
      </fieldset>
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
    display: flex;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    border: 0;
  }
  .ink legend {
    float: left;
    margin-right: var(--space-3);
    font-weight: 600;
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
