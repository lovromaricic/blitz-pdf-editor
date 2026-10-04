<script lang="ts">
  // The menu bar's contents as a full-screen accordion (same commands, no shortcuts).
  import { tick } from 'svelte';
  import type { CommandId, CommandRegistry } from '../../lib/commands';
  import { MENUS, type MenuEntry } from '../menus';

  let { commands, open, onClose }: { commands: CommandRegistry; open: boolean; onClose: () => void } = $props();

  let dialog: HTMLDialogElement;
  let expanded = $state<string | null>(null);

  $effect(() => {
    if (open && !dialog.open) {
      dialog.showModal();
      void tick().then(() => dialog.querySelector<HTMLButtonElement>('.section-btn')?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  /** Flatten submenus into labelled groups. */
  function rows(entries: MenuEntry[], heading?: string): ({ id: CommandId; heading?: string } | '-')[] {
    return entries.flatMap((e, i) => {
      if (e === '-') return ['-' as const];
      if (typeof e === 'string') return [{ id: e, heading: i === 0 ? heading : undefined }];
      return ['-' as const, ...rows(e.items, e.label)];
    });
  }

  function run(id: CommandId) {
    if (!commands.isEnabled(id)) return;
    onClose();
    commands.run(id);
  }
</script>

<dialog bind:this={dialog} class="menu" aria-label="Menu" oncancel={(e) => { e.preventDefault(); onClose(); }}>
  <header>
    <h2>Menu</h2>
    <button type="button" class="close" aria-label="Close menu" onclick={onClose}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" /></svg>
    </button>
  </header>
  <div class="sections">
    {#each MENUS as menu (menu.label)}
      {@const isOpen = expanded === menu.label}
      <section>
        <h3>
          <button type="button" class="section-btn" aria-expanded={isOpen} aria-controls="mm-{menu.label}" onclick={() => (expanded = isOpen ? null : menu.label)}>
            <span>{menu.label}</span>
            <span class="chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
          </button>
        </h3>
        {#if isOpen}
          <ul id="mm-{menu.label}">
            {#each rows(menu.items) as row, i (i)}
              {#if row === '-'}
                <li class="sep" aria-hidden="true"></li>
              {:else}
                {@const enabled = commands.isEnabled(row.id)}
                {@const checked = commands.isChecked(row.id)}
                {#if row.heading}<li class="heading">{row.heading}</li>{/if}
                <li>
                  <button
                    type="button"
                    class="item"
                    aria-disabled={!enabled}
                    aria-pressed={checked}
                    class:disabled={!enabled}
                    onclick={() => run(row.id)}
                  >
                    <span class="check" aria-hidden="true">{checked ? '✓' : ''}</span>
                    <span>{commands.label(row.id)}</span>
                    {#if commands.meta(row.id).later}<span class="later">Later</span>{/if}
                  </button>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  </div>
</dialog>

<style>
  .menu {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--color-bg);
    color: var(--color-text);
  }
  .menu[open] {
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    padding-top: max(var(--space-2), env(safe-area-inset-top));
    border-bottom: var(--border-width) solid var(--color-border);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  .close {
    display: grid;
    place-items: center;
    width: var(--touch-target);
    height: var(--touch-target);
    border: 0;
    background: none;
  }
  .sections {
    overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom);
  }
  section {
    border-bottom: var(--border-width) solid var(--color-border);
  }
  h3 {
    margin: 0;
  }
  .section-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    min-height: 52px;
    padding: 0 var(--space-4);
    border: 0;
    background: none;
    font-size: var(--font-size-md);
    font-weight: 600;
  }
  .chev {
    font-size: var(--font-size-lg);
    color: var(--color-text-muted);
  }
  ul {
    margin: 0;
    padding: 0 0 var(--space-2);
    list-style: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
    border: 0;
    background: none;
    text-align: left;
  }
  .item:active:not(.disabled) {
    background: var(--color-surface-strong);
  }
  .check {
    width: 1.25rem;
  }
  .disabled {
    color: var(--color-text-muted);
    opacity: 0.6;
  }
  .later {
    margin-left: auto;
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    text-transform: uppercase;
  }
  .heading {
    padding: var(--space-2) var(--space-4) 0 calc(var(--space-4) + 1.25rem + var(--space-2));
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sep {
    height: var(--border-width);
    margin: var(--space-1) var(--space-4);
    background: var(--color-border);
  }
</style>
