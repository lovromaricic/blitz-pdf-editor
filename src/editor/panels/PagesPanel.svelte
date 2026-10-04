<script lang="ts">
  import type { CommandRegistry } from '../../lib/commands';
  import { formatPageRange } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let { commands }: { commands: CommandRegistry } = $props();
  const viewer = useViewer();

  const selected = $derived(viewer.targetPages());
  const indexes = $derived(selected.map((p) => viewer.doc.pages.indexOf(p)));
</script>

<PanelHeader title={selected.length === 1 ? 'Page' : `${selected.length} pages`} onClose={() => viewer.clearSelection()} />

<div class="panel-form">
  <p>
    {selected.length === 1 ? 'Page' : 'Pages'} <strong>{formatPageRange(indexes)}</strong> of {viewer.pageCount}
  </p>
  <div class="row-buttons">
    <button type="button" class="btn" onclick={() => commands.run('page.rotateLeft')}>Rotate left</button>
    <button type="button" class="btn" onclick={() => commands.run('page.rotateRight')}>Rotate right</button>
  </div>
  <div class="actions">
    <button type="button" class="btn" disabled={!commands.isEnabled('page.delete')} onclick={() => commands.run('page.delete')}>
      Delete {selected.length === 1 ? 'page' : `${selected.length} pages`}
    </button>
    <button type="button" class="btn" onclick={() => commands.run('page.extract')}>Extract…</button>
    <button type="button" class="btn" onclick={() => commands.run('page.insertBlank')}>Insert blank page after</button>
  </div>
  <p class="hint">
    Shift-click or Ctrl/⌘-click thumbnails to select several pages. Drag thumbnails, or press Alt+↑/↓, to reorder.
  </p>
</div>
