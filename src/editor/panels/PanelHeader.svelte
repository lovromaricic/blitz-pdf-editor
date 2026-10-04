<script lang="ts">
  let { title, onClose }: { title: string; onClose?: () => void } = $props();
</script>

<header>
  <h2>{title}</h2>
  {#if onClose}
    <button type="button" class="close" aria-label="Close {title}" onclick={onClose}>×</button>
  {/if}
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }
  h2 {
    font-size: var(--font-size-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
  .close {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--font-size-lg);
    line-height: 1;
  }
  @media (max-width: 640px), (pointer: coarse) {
    .close {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
  .close:hover {
    background: var(--color-surface-strong);
  }
</style>
