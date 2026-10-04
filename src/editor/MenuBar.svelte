<script lang="ts">
  import { tick } from 'svelte';
  import { COMMANDS, formatKeys, type CommandId, type CommandMeta, type CommandRegistry } from '../lib/commands';
  import { MENUS, type MenuEntry } from './menus';

  let { commands }: { commands: CommandRegistry } = $props();

  let openIndex = $state<number | null>(null);
  let openSub = $state<string | null>(null);
  let bar: HTMLElement;
  const triggers = $state<HTMLButtonElement[]>([]);

  async function openMenu(i: number, focus: 'first' | 'last' | null = 'first') {
    openIndex = (i + MENUS.length) % MENUS.length;
    openSub = null;
    await tick();
    if (focus) focusItem(currentList(), focus === 'first' ? 0 : -1);
  }

  function closeMenu(returnFocus = true) {
    const i = openIndex;
    openIndex = null;
    openSub = null;
    if (returnFocus && i !== null) triggers[i]?.focus();
  }

  function currentList(): HTMLElement | null {
    return bar.querySelector(`[data-menu="${openIndex}"]`);
  }

  function items(list: HTMLElement | null): HTMLElement[] {
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLElement>(':scope > li > [role^="menuitem"]'));
  }

  function focusItem(list: HTMLElement | null, index: number) {
    const all = items(list);
    if (all.length === 0) return;
    all[(index + all.length) % all.length].focus();
  }

  function onTriggerKey(e: KeyboardEvent, i: number) {
    switch (e.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        e.preventDefault();
        openMenu(i, 'first');
        break;
      case 'ArrowUp':
        e.preventDefault();
        openMenu(i, 'last');
        break;
      case 'ArrowRight':
        e.preventDefault();
        triggers[(i + 1) % MENUS.length].focus();
        if (openIndex !== null) openMenu(i + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        triggers[(i - 1 + MENUS.length) % MENUS.length].focus();
        if (openIndex !== null) openMenu(i - 1);
        break;
      case 'Escape':
        closeMenu();
        break;
    }
  }

  function onListKey(e: KeyboardEvent) {
    const list = (e.target as HTMLElement).closest('[role="menu"]') as HTMLElement;
    const all = items(list);
    const pos = all.indexOf(e.target as HTMLElement);
    const inSub = list.dataset.sub !== undefined;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(list, pos + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(list, pos - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(list, 0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(list, -1);
        break;
      case 'ArrowRight': {
        e.preventDefault();
        const sub = (e.target as HTMLElement).dataset.subTrigger;
        if (sub) openSubmenu(sub);
        else openMenu((openIndex ?? 0) + 1);
        break;
      }
      case 'ArrowLeft':
        e.preventDefault();
        if (inSub) {
          const label = list.dataset.sub!;
          openSub = null;
          bar.querySelector<HTMLElement>(`[data-sub-trigger="${label}"]`)?.focus();
        } else {
          openMenu((openIndex ?? 0) - 1);
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (inSub) {
          const label = list.dataset.sub!;
          openSub = null;
          bar.querySelector<HTMLElement>(`[data-sub-trigger="${label}"]`)?.focus();
        } else {
          closeMenu();
        }
        break;
      case 'Tab':
        closeMenu(false);
        break;
    }
  }

  async function openSubmenu(label: string) {
    openSub = label;
    await tick();
    focusItem(bar.querySelector(`[data-sub="${label}"]`), 0);
  }

  function activate(id: CommandId) {
    if (!commands.isEnabled(id)) return;
    closeMenu();
    commands.run(id);
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (openIndex !== null && !bar.contains(e.target as Node)) closeMenu(false);
  }

  function shortcut(id: CommandId) {
    const keys = (COMMANDS[id] as CommandMeta).keys;
    return keys ? formatKeys(keys[0]) : '';
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#snippet list(entries: MenuEntry[], attrs: { menu?: number; sub?: string; label: string })}
  <ul role="menu" aria-label={attrs.label} data-menu={attrs.menu} data-sub={attrs.sub} class:submenu={attrs.sub !== undefined} onkeydown={onListKey}>
    {#each entries as entry, k (typeof entry === 'string' ? entry + k : entry.label)}
      {#if entry === '-'}
        <li role="separator" class="sep"></li>
      {:else if typeof entry === 'object'}
        <li role="none" class="has-sub" onpointerenter={() => (openSub = entry.label)} onpointerleave={() => (openSub = null)}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openSub === entry.label}
            tabindex="-1"
            data-sub-trigger={entry.label}
            onclick={() => openSubmenu(entry.label)}
          >
            <span class="label">{entry.label}</span>
            <span class="arrow" aria-hidden="true">▸</span>
          </button>
          {#if openSub === entry.label}
            {@render list(entry.items, { sub: entry.label, label: entry.label })}
          {/if}
        </li>
      {:else}
        {@const meta = COMMANDS[entry] as CommandMeta}
        {@const enabled = commands.isEnabled(entry)}
        {@const checked = commands.isChecked(entry)}
        <li role="none">
          <button
            type="button"
            role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={checked}
            aria-disabled={!enabled}
            class:disabled={!enabled}
            title={commands.isBuilt(entry) ? undefined : meta.later ? 'Planned for a later version' : 'Not available yet'}
            tabindex="-1"
            onclick={() => activate(entry)}
          >
            <span class="check" aria-hidden="true">{checked ? '✓' : ''}</span>
            <span class="label">{commands.label(entry)}</span>
            {#if meta.later}
              <span class="later">Later</span>
            {:else}
              <span class="keys">{shortcut(entry)}</span>
            {/if}
          </button>
        </li>
      {/if}
    {/each}
  </ul>
{/snippet}

<nav class="menubar" aria-label="Main menu" bind:this={bar}>
  <ul role="menubar" aria-label="Main menu">
    {#each MENUS as menu, i (menu.label)}
      <li role="none" class="top">
        <button
          bind:this={triggers[i]}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openIndex === i}
          class:open={openIndex === i}
          tabindex={i === 0 ? 0 : -1}
          onclick={() => (openIndex === i ? closeMenu() : openMenu(i, null))}
          onpointerenter={() => openIndex !== null && openIndex !== i && openMenu(i, null)}
          onkeydown={(e) => onTriggerKey(e, i)}
        >
          {menu.label}
        </button>
        {#if openIndex === i}
          {@render list(menu.items, { menu: i, label: menu.label })}
        {/if}
      </li>
    {/each}
  </ul>
</nav>

<style>
  .menubar {
    border-bottom: var(--border-width) solid var(--color-border);
    background: var(--color-bg);
    padding: 0 var(--space-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  [role='menubar'] {
    display: flex;
  }

  .top {
    position: relative;
  }

  .top > button {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--font-size-sm);
  }

  .top > button:hover,
  .top > button.open {
    background: var(--color-surface-strong);
  }

  [role='menu'] {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 260px;
    padding: var(--space-1);
    background: var(--color-bg);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .submenu {
    top: calc(-1 * var(--space-1) - var(--border-width));
    left: 100%;
  }

  .has-sub {
    position: relative;
  }

  [role='menu'] button {
    display: grid;
    grid-template-columns: 1.25rem 1fr auto;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--font-size-sm);
    text-align: left;
  }

  .has-sub > button {
    grid-template-columns: 1.25rem 1fr auto;
  }

  .has-sub > button .label {
    grid-column: 2;
  }

  [role='menu'] button:hover:not(.disabled),
  [role='menu'] button:focus-visible {
    background: var(--color-surface-strong);
  }

  [role='menu'] button:focus-visible {
    outline-offset: -2px;
  }

  .disabled {
    color: var(--color-text-muted);
    opacity: 0.6;
    cursor: default;
  }

  .keys,
  .later {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .later {
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .sep {
    height: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--color-border);
  }
</style>
