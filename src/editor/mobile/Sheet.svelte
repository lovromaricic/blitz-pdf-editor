<script lang="ts">
  // A bottom sheet for phones. `tall` lets tool forms use most of the screen.
  import type { Snippet } from 'svelte';

  let { label, tall = false, children }: { label: string; tall?: boolean; children: Snippet } = $props();
</script>

<section class="sheet" class:tall aria-label={label}>
  <div class="grip" aria-hidden="true"></div>
  <div class="content">{@render children()}</div>
</section>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    max-height: 42dvh;
    border-top: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--color-bg);
    box-shadow: 0 -4px 16px rgb(0 0 0 / 0.12);
  }
  .sheet.tall {
    /* Leave some of the page visible: many tools preview live. */
    max-height: 64dvh;
  }
  .grip {
    flex-shrink: 0;
    width: 40px;
    height: 4px;
    margin: var(--space-2) auto 0;
    border-radius: 2px;
    background: var(--color-border-strong);
  }
  .content {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-2) var(--space-4) var(--space-4);
  }
</style>
