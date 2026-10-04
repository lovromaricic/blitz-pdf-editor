<script lang="ts">
  import type { CommandRegistry } from '../../lib/commands';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let { commands }: { commands: CommandRegistry } = $props();
  const viewer = useViewer();
  const doc = viewer.doc;
  const flattened = $derived(doc.pages.some((p) => p.flattenForm));
</script>

<PanelHeader title="Fill form" onClose={() => viewer.setTool('select')} />

<div class="panel-form">
  {#if doc.hasForms}
    <p>Click a field to fill it in. Press Tab to go to the next field.</p>
    <p class="hint">Your answers are saved into the PDF when you save. Fields can also be filled with the Select tool.</p>
    {#if flattened}
      <p><strong>The form will be flattened when you save:</strong> the answers become part of the page and can't be changed afterwards. Undo with Ctrl+Z.</p>
    {:else}
      <div class="actions">
        <button type="button" class="btn" disabled={!commands.isEnabled('tools.flatten')} onclick={() => commands.run('tools.flatten')}>Flatten form</button>
      </div>
      <p class="hint">Flattening turns the fields into normal page content, so nobody can change the answers later.</p>
    {/if}
  {:else}
    <p>This document has no fillable form fields.</p>
    <p class="hint">To add your own text anywhere on the page, use the Text tool.</p>
  {/if}
</div>
