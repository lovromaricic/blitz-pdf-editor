<script lang="ts">
  import type { CommandId, CommandRegistry } from '../lib/commands';
  import { useViewer } from '../lib/viewer.svelte';
  import { MARKUP_TOOLS as tools } from './tools';

  let { commands }: { commands: CommandRegistry } = $props();
  const viewer = useViewer();

  function onKey(e: KeyboardEvent) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + keys[e.key] + buttons.length) % buttons.length;
    buttons[next]?.focus();
    e.preventDefault();
  }

  const history: { id: CommandId; label: string }[] = [
    { id: 'edit.undo', label: 'Undo' },
    { id: 'edit.redo', label: 'Redo' },
  ];

</script>

<!-- One Tab stop (the active tool); arrow keys move between buttons, per the ARIA toolbar pattern. -->
<div class="toolbar" role="toolbar" aria-label="Editing tools" tabindex="-1" onkeydown={onKey}>
  <div class="group" role="group" aria-labelledby="tb-history">
    <span class="group-label" id="tb-history">History</span>
    <div class="buttons">
      {#each history as h (h.id)}
        <button type="button" class="tool" tabindex="-1" disabled={!commands.isEnabled(h.id)} onclick={() => commands.run(h.id)}>
          <span class="icon" aria-hidden="true"></span>
          <span>{h.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="group" role="group" aria-labelledby="tb-markup">
    <span class="group-label" id="tb-markup">Mark up</span>
    <div class="buttons">
      {#each tools as t (t.id)}
        <button
          type="button"
          class="tool"
          class:active={viewer.tool === t.id}
          aria-pressed={viewer.tool === t.id}
          tabindex={viewer.tool === t.id ? 0 : -1}
          onclick={() => viewer.setTool(t.id)}
        >
          <span class="icon" aria-hidden="true"></span>
          <span>{t.label}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: stretch;
    gap: var(--space-5);
    padding: var(--space-1) var(--space-4) var(--space-2);
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-bg);
    overflow-x: auto;
  }
  .group {
    display: grid;
    gap: 2px;
  }
  .group + .group {
    padding-left: var(--space-5);
    border-left: var(--border-width) solid var(--color-border);
  }
  .group-label {
    color: var(--color-text-muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .buttons {
    display: flex;
    gap: 2px;
  }
  .tool {
    display: grid;
    justify-items: center;
    gap: 2px;
    min-width: 52px;
    min-height: var(--touch-target);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }
  .tool:hover:not(:disabled) {
    background: var(--color-surface);
  }
  .tool.active {
    background: var(--color-active-bg);
    border-color: var(--color-border-strong);
    font-weight: 600;
  }
  .tool:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .icon {
    width: 18px;
    height: 18px;
    border: 1.5px solid currentColor;
    border-radius: 3px;
  }
</style>
