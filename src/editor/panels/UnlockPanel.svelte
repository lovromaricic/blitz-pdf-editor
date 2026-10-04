<script lang="ts">
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  function remove() {
    const { protection: _, ...rest } = doc.settings;
    doc.editSettings('Remove password', rest);
    viewer.notify('Password removed. Save to download the PDF without a password.');
  }
</script>

<PanelHeader title="Remove password" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  {#if doc.settings.protection}
    <p>This document is set to be saved with a password.</p>
    <p class="hint">After removing it, saved copies open without a password. Undo with Ctrl+Z.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" onclick={remove}>Remove password</button>
    </div>
  {:else}
    <p>This document will be saved without a password.</p>
    {#if doc.hasPasswordSources}
      <p class="hint">It was opened with a password; the saved copy won't need one.</p>
    {/if}
  {/if}
</div>
