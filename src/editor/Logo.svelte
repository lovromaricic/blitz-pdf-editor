<script lang="ts">
  // Temporary logo: accent square with a lightning bolt (to be replaced by the real logo).
  import Zap from '@lucide/svelte/icons/zap';

  let { size = 30 }: { size?: number } = $props();
</script>

<span class="logo" style:width="{size}px" style:height="{size}px" aria-hidden="true">
  <Zap size={size * 0.55} strokeWidth={2} fill="currentColor" />
</span>

<style>
  .logo {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
