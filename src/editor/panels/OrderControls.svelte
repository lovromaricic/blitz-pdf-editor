<script lang="ts">
  // "Order": the selected object's place in its page's layers, for every kind
  // of object. The same action as the Edit menu, the context menu and the
  // shortcuts (actions.moveLayer).
  import ArrowUpToLine from '@lucide/svelte/icons/arrow-up-to-line';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
  import type { Component } from 'svelte';
  import { useActions } from '../../lib/actions.svelte';
  import { COMMANDS, formatKeys, type CommandId, type CommandMeta } from '../../lib/commands';
  import { LAYER_LABELS, type LayerMove } from '../../lib/z-order';
  import { ICON } from '../tools';

  let { pageId, id }: { pageId: string; id: string } = $props();
  const actions = useActions();

  const MOVES: { move: LayerMove; command: CommandId; icon: Component }[] = [
    { move: 'front', command: 'object.bringToFront', icon: ArrowUpToLine },
    { move: 'forward', command: 'object.bringForward', icon: ArrowUp },
    { move: 'backward', command: 'object.sendBackward', icon: ArrowDown },
    { move: 'back', command: 'object.sendToBack', icon: ArrowDownToLine },
  ];
  const uid = Math.random().toString(36).slice(2, 8);
</script>

<div class="field">
  <span class="label" id="order-{uid}">Order</span>
  <div class="order" role="group" aria-labelledby="order-{uid}">
    {#each MOVES as m (m.move)}
      {@const keys = (COMMANDS[m.command] as CommandMeta).keys![0]}
      <button
        type="button"
        class="order-btn"
        aria-label={LAYER_LABELS[m.move]}
        title="{LAYER_LABELS[m.move]} ({formatKeys(keys)})"
        disabled={!actions.canMoveLayer(pageId, id, m.move)}
        onclick={() => actions.moveLayer(pageId, id, m.move)}><m.icon {...ICON} aria-hidden="true" /></button
      >
    {/each}
  </div>
</div>

<style>
  .order {
    display: flex;
    gap: var(--space-1);
  }
  .order-btn {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
  }
  .order-btn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .order-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  @media (max-width: 720px), (pointer: coarse) {
    .order-btn {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
