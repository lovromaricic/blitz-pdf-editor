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
    border-top: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
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
    background: var(--border);
  }
  .content {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-3) 16px var(--space-4);
  }
</style>
