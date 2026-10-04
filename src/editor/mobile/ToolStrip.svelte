<script lang="ts">
  import Files from '@lucide/svelte/icons/files';
  import { useViewer } from '../../lib/viewer.svelte';
  import { ICON, MARKUP_TOOLS } from '../tools';

  let { onPages }: { onPages: () => void } = $props();
  const viewer = useViewer();
</script>

<nav class="strip" aria-label="Tools">
  <button type="button" class="tool" onclick={onPages}>
    <Files size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
    <span>Pages</span>
  </button>
  <span class="divider" aria-hidden="true"></span>
  {#each MARKUP_TOOLS as t (t.id)}
    <button type="button" class="tool" class:active={viewer.tool === t.id} aria-pressed={viewer.tool === t.id} onclick={() => viewer.setTool(t.id)}>
      <t.icon size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
      <span>{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .strip {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    padding: var(--space-1) var(--space-2);
    padding-bottom: max(var(--space-1), env(safe-area-inset-bottom));
    border-top: var(--border-width) solid var(--border);
    background: var(--surface);
    scrollbar-width: none;
    overscroll-behavior-x: contain;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .tool {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    flex-shrink: 0;
    width: 64px;
    height: 56px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }
  .tool.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  /* Small text on the soft accent needs the darker accent for 4.5:1 contrast. */
  .tool.active span {
    color: var(--accent-strong);
  }
  .divider {
    flex-shrink: 0;
    width: var(--border-width);
    height: 32px;
    margin: 0 var(--space-1);
    background: var(--border);
  }
</style>
