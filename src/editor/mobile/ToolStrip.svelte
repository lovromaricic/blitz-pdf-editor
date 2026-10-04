<script lang="ts">
  import { useViewer } from '../../lib/viewer.svelte';
  import { MARKUP_TOOLS } from '../tools';

  let { onPages }: { onPages: () => void } = $props();
  const viewer = useViewer();
</script>

<nav class="strip" aria-label="Tools">
  <button type="button" class="tool" onclick={onPages}>
    <span class="icon pages" aria-hidden="true"></span>
    <span>Pages</span>
  </button>
  <span class="divider" aria-hidden="true"></span>
  {#each MARKUP_TOOLS as t (t.id)}
    <button type="button" class="tool" class:active={viewer.tool === t.id} aria-pressed={viewer.tool === t.id} onclick={() => viewer.setTool(t.id)}>
      <span class="icon" aria-hidden="true"></span>
      <span>{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .strip {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    overflow-x: auto;
    padding: var(--space-1) var(--space-2);
    padding-bottom: max(var(--space-1), env(safe-area-inset-bottom));
    border-top: var(--border-width) solid var(--color-border);
    background: var(--color-bg);
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
    min-width: 60px;
    min-height: 52px;
    padding: var(--space-1);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-md);
    background: none;
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }
  .tool.active {
    background: var(--color-active-bg);
    border-color: var(--color-border-strong);
    font-weight: 600;
  }
  .icon {
    width: 20px;
    height: 20px;
    border: 1.5px solid currentColor;
    border-radius: 3px;
  }
  .icon.pages {
    box-shadow: 3px -3px 0 -1.5px var(--color-bg), 3px -3px 0 0 currentColor;
  }
  .divider {
    flex-shrink: 0;
    width: var(--border-width);
    margin: var(--space-2) var(--space-1);
    background: var(--color-border);
  }
</style>
