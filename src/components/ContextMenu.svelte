<script lang="ts" module>
  /** A menu item (with the shortcut that really does the same, if any), or a divider. */
  export type ContextItem = { label: string; run: () => void; disabled?: boolean; keys?: string } | '-';
</script>

<script lang="ts">
  // The app's right-click menu (pages in the thumbnail rail, objects and pages
  // on the canvas). Looks like the File and Edit menus. Keyboard: Up/Down
  // (skipping disabled items, which stay readable), Home/End, a letter jumps to
  // the next item starting with it, Enter activates, Escape closes and gives
  // focus back. It opens beside the point, flipping left or up to stay in the
  // window, and closes on a click elsewhere, scroll, resize or leaving the window.
  import { tick } from 'svelte';

  let {
    x,
    y,
    label,
    items,
    onClose,
  }: { x: number; y: number; label: string; items: ContextItem[]; onClose: (restoreFocus: boolean) => void } = $props();

  let menu: HTMLUListElement;
  let pos = $state({ left: -9999, top: -9999 });

  $effect(() => {
    // Beside the point; flipped to the other side when it wouldn't fit, and never outside the window.
    const r = menu.getBoundingClientRect();
    const left = x + r.width + 4 > innerWidth ? x - r.width : x;
    const top = y + r.height + 4 > innerHeight ? y - r.height : y;
    pos = {
      left: Math.max(4, Math.min(left, innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(top, innerHeight - r.height - 4)),
    };
    void tick().then(() => enabled()[0]?.focus());
  });

  function enabled() {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not([aria-disabled="true"])'));
  }

  function onKey(e: KeyboardEvent) {
    const all = enabled();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') all[(i + 1) % all.length]?.focus();
    else if (e.key === 'ArrowUp') all[(i - 1 + all.length) % all.length]?.focus();
    else if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all[all.length - 1]?.focus();
    else if (e.key === 'Escape') onClose(true);
    else if (e.key === 'Tab') onClose(false);
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: the next item starting with this letter.
      const k = e.key.toLowerCase();
      const from = i < 0 ? 0 : i + 1;
      const order = [...all.slice(from), ...all.slice(0, from)];
      order.find((b) => b.dataset.label!.toLowerCase().startsWith(k))?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function activate(item: Exclude<ContextItem, '-'>) {
    if (item.disabled) return;
    onClose(true);
    item.run();
  }

  /** Scrolling the page (not the menu) closes it: what it was opened on has moved. */
  function onScroll(e: Event) {
    if (!menu.contains(e.target as Node)) onClose(false);
  }
</script>

<svelte:window
  onpointerdown={(e) => !menu.contains(e.target as Node) && onClose(false)}
  onblur={() => onClose(false)}
  onresize={() => onClose(false)}
/>
<svelte:document onscrollcapture={onScroll} />

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
          data-label={item.label}
          aria-disabled={item.disabled ? 'true' : undefined}
          class:disabled={item.disabled}
          onclick={() => activate(item)}
        >
          <span class="label">{item.label}</span>
          {#if item.keys}<span class="keys">{item.keys}</span>{/if}
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  /* The same look as the File and Edit menus (MenuBar.svelte). */
  .context-menu {
    position: fixed;
    z-index: 200;
    min-width: 220px;
    margin: 0;
    padding: 6px;
    list-style: none;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  button {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-size: var(--font-size-md);
    text-align: left;
  }
  button:hover:not(.disabled),
  button:focus-visible {
    background: var(--surface-2);
  }
  button:focus-visible {
    outline-offset: -2px;
  }
  /* Dimmed but still readable. */
  .disabled {
    color: var(--muted);
    opacity: 0.7;
    cursor: default;
  }
  .keys {
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  .sep {
    height: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--border);
  }
  @media (pointer: coarse) {
    button {
      min-height: var(--touch-target);
    }
  }
</style>
