<script lang="ts">
  // The floating pill toolbar (desktop and tablet). Self-contained: history,
  // markup tools, tooltips with shortcuts, and arrow-key navigation.
  import type { Component } from 'svelte';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { COMMANDS, formatKeys, type CommandId, type CommandMeta, type CommandRegistry } from '../lib/commands';
  import { useViewer } from '../lib/viewer.svelte';
  import { ICON, MARKUP_TOOLS } from './tools';

  let { commands }: { commands: CommandRegistry } = $props();
  const viewer = useViewer();

  const shortcut = (id: CommandId) => {
    const keys = (COMMANDS[id] as CommandMeta).keys;
    return keys ? formatKeys(keys[0]) : '';
  };

  const history: { id: CommandId; label: string; icon: Component }[] = [
    { id: 'edit.undo', label: 'Undo', icon: Undo2 },
    { id: 'edit.redo', label: 'Redo', icon: Redo2 },
  ];

  // --- Tooltip: after 400ms on hover, at once on keyboard focus -----------------

  let tip = $state<{ text: string; x: number; y: number; for: string } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function showTip(el: HTMLElement, delay: number) {
    clearTimeout(timer);
    const place = () => {
      const r = el.getBoundingClientRect();
      tip = { text: el.dataset.tip!, x: r.left + r.width / 2, y: r.bottom + 8, for: el.id };
    };
    if (delay) timer = setTimeout(place, delay);
    else place();
  }

  function hideTip() {
    clearTimeout(timer);
    tip = null;
  }

  function onFocusIn(e: FocusEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el?.matches(':focus-visible')) showTip(el, 0);
  }

  // --- Arrow keys move between buttons (one Tab stop: the active tool) -----------

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') return hideTip();
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + keys[e.key] + buttons.length) % buttons.length;
    buttons[next]?.focus();
    e.preventDefault();
  }
</script>

<div class="pill-row">
  <div class="pill" role="toolbar" aria-label="Editing tools" tabindex="-1" onkeydown={onKey} onfocusin={onFocusIn} onfocusout={hideTip}>
    {#each history as h (h.id)}
      {@const keys = shortcut(h.id)}
      <button
        type="button"
        class="tool"
        id="tb-{h.id}"
        tabindex="-1"
        aria-label={commands.label(h.id)}
        aria-keyshortcuts={keys}
        aria-describedby={tip?.for === `tb-${h.id}` ? 'toolbar-tip' : undefined}
        data-tip="{commands.label(h.id)}{keys ? ` (${keys})` : ''}"
        disabled={!commands.isEnabled(h.id)}
        onclick={() => commands.run(h.id)}
        onpointerenter={(e) => showTip(e.currentTarget, 400)}
        onpointerleave={hideTip}
      >
        <h.icon size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
      </button>
    {/each}

    <span class="divider" aria-hidden="true"></span>

    {#each MARKUP_TOOLS as t (t.id)}
      {@const keys = shortcut(`tool.${t.id}` as CommandId)}
      {@const active = viewer.tool === t.id}
      <button
        type="button"
        class="tool"
        class:active
        id="tb-tool-{t.id}"
        aria-label={t.label}
        aria-pressed={active}
        aria-keyshortcuts={keys}
        aria-describedby={tip?.for === `tb-tool-${t.id}` ? 'toolbar-tip' : undefined}
        data-tip="{t.tip ?? t.label}{keys ? ` (${keys})` : ''}"
        tabindex={active ? 0 : -1}
        onclick={() => {
          hideTip();
          // The same command as the shortcut (Edit content enters through its one function).
          commands.run(`tool.${t.id}` as CommandId);
        }}
        onpointerenter={(e) => showTip(e.currentTarget, 400)}
        onpointerleave={hideTip}
      >
        <t.icon size={ICON.size} strokeWidth={ICON.strokeWidth} aria-hidden="true" />
      </button>
    {/each}
  </div>
</div>

{#if tip}
  <div class="tooltip" id="toolbar-tip" role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">{tip.text}</div>
{/if}

<style>
  /* Floats over the pages (positioned by CanvasView). Only the pill takes pointer input. */
  .pill-row {
    display: flex;
    justify-content: center;
    min-width: 0;
    max-width: 100%;
    pointer-events: none;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 5px;
    /* Never wraps: scrolls sideways in narrow windows instead. */
    overflow-x: auto;
    border-radius: var(--radius-pill);
    background: var(--surface);
    box-shadow: var(--shadow-pill);
    scrollbar-width: none;
    pointer-events: auto;
  }
  .pill::-webkit-scrollbar {
    display: none;
  }
  .tool {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 42px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text);
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }
  .tool:hover:not(:disabled):not(.active) {
    background: var(--surface-2);
  }
  .tool.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .tool:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .tool:focus-visible {
    outline-offset: 0;
  }
  .divider {
    flex-shrink: 0;
    width: 1px;
    height: 22px;
    margin: 0 6px;
    background: var(--border);
  }
  .tooltip {
    position: fixed;
    z-index: 300;
    padding: var(--space-1) var(--space-2);
    transform: translateX(-50%);
    border-radius: var(--radius-sm);
    background: var(--text);
    color: var(--on-accent);
    font-size: var(--font-size-xs);
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
  }
  @media (pointer: coarse) {
    .tool {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
