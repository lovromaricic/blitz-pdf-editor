<script lang="ts">
  import { tick } from 'svelte';
  import { focusLost, focusSink } from '../../lib/focus';
  import X from '@lucide/svelte/icons/x';

  let { title, label = 'Properties', onClose }: { title: string; label?: string; onClose?: () => void } = $props();

  /** Closing removes this button: keep focus in the editor rather than losing it on <body>. */
  async function close() {
    onClose?.();
    await tick();
    if (focusLost()) focusSink();
  }
</script>

<header>
  <div class="titles">
    <span class="section-label">{label}</span>
    <h2>{title}</h2>
  </div>
  {#if onClose}
    <button type="button" class="close" aria-label="Close {title}" onclick={close}>
      <X size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  {/if}
</header>

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
  }
  .titles {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  h2 {
    font-size: var(--font-size-lg);
    font-weight: 700;
    line-height: 1.25;
  }
  .close {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    margin: -4px -6px 0 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
  }
  .close:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  @media (max-width: 720px), (pointer: coarse) {
    header {
      margin-bottom: var(--space-4);
    }
    h2 {
      font-size: var(--font-size-base);
    }
    .close {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
