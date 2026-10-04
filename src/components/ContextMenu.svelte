<script lang="ts" module>
  export type ContextItem = { label: string; run: () => void; disabled?: boolean } | '-';
</script>

<script lang="ts">
  import { tick } from 'svelte';

  let {
    x,
    y,
    label,
    items,
    onClose,
  }: { x: number; y: number; label: string; items: ContextItem[]; onClose: (restoreFocus: boolean) => void } = $props();

  let menu: HTMLUListElement;
  let pos = $state({ left: 0, top: 0 });

  $effect(() => {
    // Keep the menu on screen.
    const r = menu.getBoundingClientRect();
    pos = {
      left: Math.max(4, Math.min(x, innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, innerHeight - r.height - 4)),
    };
    void tick().then(() => buttons()[0]?.focus());
  });

  function buttons() {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>('button'));
  }

  function onKey(e: KeyboardEvent) {
    const all = buttons();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') all[(i + 1) % all.length].focus();
    else if (e.key === 'ArrowUp') all[(i - 1 + all.length) % all.length].focus();
    else if (e.key === 'Home') all[0].focus();
    else if (e.key === 'End') all[all.length - 1].focus();
    else if (e.key === 'Escape') onClose(true);
    else if (e.key === 'Tab') onClose(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function activate(item: Exclude<ContextItem, '-'>) {
    if (item.disabled) return;
    onClose(true);
    item.run();
  }
</script>

<svelte:window
  onpointerdown={(e) => !menu.contains(e.target as Node) && onClose(false)}
  onblur={() => onClose(false)}
  onresize={() => onClose(false)}
/>

<ul
  bind:this={menu}
  class="context-menu"
  role="menu"
  aria-label={label}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  onkeydown={onKey}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item, i (i)}
    {#if item === '-'}
      <li role="separator" class="sep"></li>
    {:else}
      <li role="none">
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          aria-disabled={item.disabled}
          class:disabled={item.disabled}
          onclick={() => activate(item)}
        >
          {item.label}
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .context-menu {
    position: fixed;
    z-index: 200;
    min-width: 200px;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  button {
    display: block;
    width: 100%;
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--font-size-sm);
    text-align: left;
  }
  button:hover:not(.disabled),
  button:focus-visible {
    background: var(--surface-2);
  }
  button:focus-visible {
    outline-offset: -2px;
  }
  .disabled {
    opacity: 0.5;
    cursor: default;
  }
  .sep {
    height: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--border);
  }
</style>
