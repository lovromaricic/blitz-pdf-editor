<script lang="ts">
  import { tick } from 'svelte';
  import { NOTE_COLORS, type NoteAnnotation, type Rgb } from '../../lib/annotations';
  import { useActions } from '../../lib/actions.svelte';
  import { useViewer } from '../../lib/viewer.svelte';
  import Swatches from '../../components/Swatches.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();

  const sel = $derived.by(() => {
    const s = actions.selectedAnnot;
    return s && s.annot.type === 'note' ? { page: s.page, annot: s.annot as NoteAnnotation } : null;
  });

  let textBox = $state<HTMLTextAreaElement | null>(null);

  // A comment that was just placed gets the cursor straight away.
  $effect(() => {
    if (viewer.focusNoteText && sel && textBox) {
      viewer.focusNoteText = false;
      void tick().then(() => textBox?.focus());
    }
  });

  function setText(text: string) {
    if (sel) actions.updateAnnotation(sel.page.id, { ...sel.annot, text }, 'Edit comment', `text:${sel.annot.id}`);
  }

  function setColor(c: Rgb) {
    c = $state.snapshot(c) as Rgb;
    viewer.toolProps.comment.color = c;
    if (sel) actions.updateAnnotation(sel.page.id, { ...sel.annot, color: c }, 'Change color', `color:${sel.annot.id}`);
  }
</script>

<PanelHeader title="Comment" onClose={sel ? () => viewer.selectAnnot(null) : () => viewer.setTool('select')} />

<div class="panel-form">
  {#if sel}
    <div class="field">
      <label for="note-text">Comment</label>
      <textarea id="note-text" bind:this={textBox} rows="6" value={sel.annot.text} oninput={(e) => setText(e.currentTarget.value)}></textarea>
    </div>
  {:else}
    <p class="hint">Click on the page to add a comment. Readers see it in any PDF viewer.</p>
  {/if}
  <div class="field">
    <span class="label">Color</span>
    <Swatches label="Comment color" colors={NOTE_COLORS} value={sel?.annot.color ?? viewer.toolProps.comment.color} onChange={(c) => c && setColor(c)} />
  </div>
  {#if sel}
    <div class="actions">
      <button type="button" class="btn" onclick={() => actions.deleteAnnotation(sel.page.id, sel.annot.id)}>Delete comment</button>
    </div>
  {/if}
</div>

<style>
  .label {
    font-weight: 600;
  }
  textarea {
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    resize: vertical;
  }
</style>
