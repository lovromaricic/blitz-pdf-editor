<script lang="ts">
  import { rectFromUpright, uprightSize, uprightTopLeft, type ImageAnnotation } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();
  const MM = 72 / 25.4;

  const sel = $derived.by(() => {
    const s = actions.selectedAnnot;
    return s && s.annot.type === 'image' ? { page: s.page, annot: s.annot as ImageAnnotation } : null;
  });
  const size = $derived(sel ? uprightSize(sel.annot) : null);

  function setWidth(mm: number) {
    if (!sel || !size || !(mm > 2)) return;
    const w = mm * MM;
    const h = (w * size[1]) / size[0];
    const a = sel.annot;
    const rect = rectFromUpright(uprightTopLeft(a), w, h, a.rotate);
    actions.updateAnnotation(sel.page.id, { ...a, rect }, 'Resize signature', `size:${a.id}`);
  }
</script>

<PanelHeader title={sel ? (sel.annot.role === 'signature' ? 'Signature' : 'Image') : 'Sign'} onClose={sel ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')} />

<div class="panel-form">
  {#if sel && size}
    <div class="field">
      <label for="sig-width">Width (mm)</label>
      <input id="sig-width" type="number" min="5" step="1" value={Math.round(size[0] / MM)} onchange={(e) => setWidth(+e.currentTarget.value)} />
      <span class="hint">Height follows: {Math.round(size[1] / MM)} mm. Drag to move; arrow keys nudge.</span>
    </div>
    <div class="actions">
      <button type="button" class="btn" onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}>Delete</button>
    </div>
  {:else if viewer.signature}
    <div class="preview"><img src={viewer.signature.dataUrl} alt="Your signature" /></div>
    <p class="hint">Click on the page to place your signature.</p>
    <div class="actions">
      <button type="button" class="btn" onclick={() => (viewer.signatureDialog = true)}>Change signature</button>
    </div>
  {:else}
    <p>Create your signature first.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" onclick={() => (viewer.signatureDialog = true)}>Create signature…</button>
    </div>
  {/if}
  <p class="hint">
    This places a picture of your signature, like signing on paper. It is not a certificate-based digital signature.
    Your signature is kept only until you close this tab.
  </p>
</div>

<style>
  .preview {
    padding: var(--space-3);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: #fff;
  }
  .preview img {
    display: block;
    max-width: 100%;
    max-height: 90px;
    margin: 0 auto;
  }
</style>
