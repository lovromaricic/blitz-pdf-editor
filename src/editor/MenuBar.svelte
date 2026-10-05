<script lang="ts">
  import { tick } from 'svelte';
  import { COMMANDS, formatKeys, type CommandId, type CommandMeta, type CommandRegistry } from '../lib/commands';
  import { MENUS, type MenuEntry } from './menus';
  import { placeSubmenu, SubmenuIntent, type Hover } from '../lib/submenu';

  let { commands }: { commands: CommandRegistry } = $props();

  let openIndex = $state<number | null>(null);
  let openSub = $state<string | null>(null);
  /** Hover intent for submenus: close delay and safe triangle (shared helper). */
  const intent = new SubmenuIntent((id) => (openSub = id));
  $effect(() => () => intent.dispose());

  /** What a mouse or pen is over inside an open menu. */
  function hoverAt(target: EventTarget | null): Hover {
    const el = target instanceof Element ? target : null;
    if (el?.closest('[data-sub]')) return { kind: 'submenu' };
    const parent = el?.closest<HTMLElement>('[data-sub-trigger], .has-sub');
    const id = parent?.dataset.subTrigger ?? parent?.querySelector<HTMLElement>('[data-sub-trigger]')?.dataset.subTrigger;
    return id ? { kind: 'parent', id } : { kind: 'item' };
  }

  function onMenuPointer(e: PointerEvent, leaving = false) {
    // Touch has no hover: submenus open by tapping their parent item.
    if (e.pointerType === 'touch') return;
    intent.pointer([e.clientX, e.clientY], leaving ? null : hoverAt(e.target));
  }

  /** Place an open submenu inside the window (left of its parent if needed, shifted up) and tell the intent where it is. */
  function placeSub(node: HTMLElement) {
    const parent = node.parentElement!.getBoundingClientRect();
    const { side, shiftUp } = placeSubmenu(parent, node.offsetWidth, node.offsetHeight, window.innerWidth, window.innerHeight, 4);
    node.dataset.side = side;
    if (shiftUp) node.style.transform = `translateY(${-shiftUp}px)`;
    intent.setSubmenu(node.getBoundingClientRect(), side);
    return () => intent.setSubmenu(null);
  }
  let bar: HTMLElement;
  const triggers = $state<HTMLButtonElement[]>([]);

  async function openMenu(i: number, focus: 'first' | 'last' | null = 'first') {
    openIndex = (i + MENUS.length) % MENUS.length;
    intent.close();
    await tick();
    if (focus) focusItem(currentList(), focus === 'first' ? 0 : -1);
  }

  function closeMenu(returnFocus = true) {
    const i = openIndex;
    openIndex = null;
    intent.close();
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
          intent.close();
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
          intent.close();
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

  /** Click, tap, Enter or Right Arrow: open and keep open. */
  async function openSubmenu(label: string) {
    intent.openNow(label);
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
  {#if attrs.sub !== undefined}
    <ul role="menu" aria-label={attrs.label} data-sub={attrs.sub} class="submenu" onkeydown={onListKey} {@attach placeSub}>
      {@render entriesOf(entries)}
    </ul>
  {:else}
    <!-- Pointer tracking for the submenu hover intent (a pointer convenience; keyboard has its own paths). -->
    <ul
      role="menu"
      aria-label={attrs.label}
      data-menu={attrs.menu}
      onkeydown={onListKey}
      onpointermove={(e) => onMenuPointer(e)}
      onpointerleave={(e) => onMenuPointer(e, true)}
    >
      {@render entriesOf(entries)}
    </ul>
  {/if}
{/snippet}

{#snippet entriesOf(entries: MenuEntry[])}
    {#each entries as entry, k (typeof entry === 'string' ? entry + k : entry.label)}
      {#if entry === '-'}
        <li role="separator" class="sep"></li>
      {:else if typeof entry === 'object'}
        <li role="none" class="has-sub">
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
            role={checked === undefined ? 'menuitem' : meta.radio ? 'menuitemradio' : 'menuitemcheckbox'}
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
    display: flex;
    flex-shrink: 0;
    align-items: center;
    height: var(--menubar-height);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
    padding: 0 var(--space-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  [role='menubar'] {
    display: flex;
    gap: 2px;
  }

  .top {
    position: relative;
  }

  .top > button {
    height: 30px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-size: var(--font-size-md);
    transition: background var(--transition-fast);
  }

  .top > button:hover,
  .top > button.open {
    background: var(--surface-2);
  }

  [role='menu'] {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 100;
    min-width: 264px;
    padding: 6px;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }

  .submenu {
    top: calc(-6px - var(--border-width));
    left: calc(100% + 4px);
  }
  .submenu:global([data-side='left']) {
    left: auto;
    right: calc(100% + 4px);
  }
  /* No dead gap: an invisible bridge over the 4px between parent item and
     submenu, overlapping the parent item by 4px, belongs to the submenu. */
  .submenu::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: 100%;
    width: calc(4px + 4px + var(--border-width));
  }
  .submenu:global([data-side='left'])::before {
    right: auto;
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
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font-size: var(--font-size-md);
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
    background: var(--surface-2);
  }

  [role='menu'] button:focus-visible {
    outline-offset: -2px;
  }

  /* Dimmed but still readable. */
  [role='menu'] button.disabled {
    color: var(--muted);
    opacity: 0.7;
    cursor: default;
  }
  .check {
    color: var(--accent);
  }

  .keys,
  .later {
    color: var(--muted);
    font-size: var(--font-size-xs);
  }

  .later {
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    font-size: var(--font-size-label);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .sep {
    height: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--border);
  }
</style>
