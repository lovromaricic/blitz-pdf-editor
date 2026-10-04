<script lang="ts">
  // "My computer's fonts": asks the browser for permission, lists installed
  // families in a searchable list and prepares the chosen one for use.
  import { tick } from 'svelte';
  import { LocalFontsError, queryFamilies, useLocalFamily, type LocalFontData } from '../lib/local-fonts.svelte';

  let { open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (font: string) => void } = $props();

  let dialog: HTMLDialogElement;
  let families = $state.raw<Map<string, LocalFontData[]> | null>(null);
  let status = $state<{ kind: 'loading' | 'error' | 'busy'; text: string } | null>(null);
  let query = $state('');
  let active = $state<string | null>(null);
  let search = $state<HTMLInputElement>();
  const uid = Math.random().toString(36).slice(2, 8);

  $effect(() => {
    if (open && !dialog.open) {
      dialog.showModal();
      void load();
    } else if (!open && dialog.open) dialog.close();
  });

  async function load() {
    query = '';
    // Ask again after an empty or refused answer (the user may have changed the permission).
    if (families?.size) {
      await tick();
      search?.focus();
      return;
    }
    status = { kind: 'loading', text: 'Waiting for permission to see your fonts…' };
    try {
      families = await queryFamilies();
      // Browsers return an empty list when access isn't granted.
      status = families.size
        ? null
        : { kind: 'error', text: "No fonts were shared. If you blocked access, you can allow it in the browser's site settings. The bundled fonts still work." };
      active = [...families.keys()][0] ?? null;
      await tick();
      search?.focus();
    } catch (e) {
      status = { kind: 'error', text: e instanceof LocalFontsError ? e.message : "Your computer's fonts couldn't be listed. The bundled fonts still work." };
    }
  }

  const names = $derived(families ? [...families.keys()].filter((n) => n.toLowerCase().includes(query.trim().toLowerCase())) : []);
  const optionId = (name: string) => `lf-${uid}-${names.indexOf(name)}`;

  async function choose(name: string) {
    const faces = families?.get(name);
    if (!faces) return;
    status = { kind: 'busy', text: `Preparing "${name}"…` };
    const result = await useLocalFamily(name, faces);
    if (!result.ok) {
      status = { kind: 'error', text: result.message };
      return;
    }
    status = null;
    onChoose(result.id);
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    const i = active ? names.indexOf(active) : -1;
    if (e.key === 'ArrowDown') active = names[Math.min(names.length - 1, i + 1)] ?? null;
    else if (e.key === 'ArrowUp') active = names[Math.max(0, i - 1)] ?? null;
    else if (e.key === 'Enter') {
      if (active && names.includes(active)) void choose(active);
    } else return;
    e.preventDefault();
    void tick().then(() => active && document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' }));
  }

  // Keep the highlighted family among the search results.
  $effect(() => {
    if (names.length && (!active || !names.includes(active))) active = names[0];
  });
</script>

<dialog bind:this={dialog} aria-labelledby="lf-title-{uid}" oncancel={(e) => { e.preventDefault(); onClose(); }}>
  <header>
    <h2 id="lf-title-{uid}">My computer's fonts</h2>
    <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
  </header>
  <div class="body">
    <p class="hint">Fonts installed on this computer, used only in this tab. Fonts whose makers don't allow embedding in documents can't be used.</p>
    {#if status}
      <p class="status" class:error={status.kind === 'error'} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>
    {/if}
    {#if families && families.size}
      <input
        bind:this={search}
        bind:value={query}
        type="text"
        class="search"
        placeholder="Search your fonts"
        aria-label="Search your fonts"
        role="combobox"
        aria-expanded="true"
        aria-controls="lf-list-{uid}"
        aria-autocomplete="list"
        aria-activedescendant={active && names.includes(active) ? optionId(active) : undefined}
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKey}
      />
      <div class="list" id="lf-list-{uid}" role="listbox" aria-label="Your fonts">
        {#each names as name (name)}
          <!-- Chosen with the pointer here, or with the keyboard from the search field. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            id={optionId(name)}
            role="option"
            tabindex="-1"
            aria-selected={name === active}
            class="option"
            class:active={name === active}
            onpointerenter={() => (active = name)}
            onclick={() => choose(name)}
          >
            {name}
          </div>
        {/each}
        {#if !names.length}<p class="empty">No fonts match "{query}".</p>{/if}
      </div>
    {/if}
  </div>
  <footer>
    <button type="button" class="btn" onclick={onClose}>Close</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 2 * var(--space-4)));
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
  }
  footer {
    justify-content: flex-end;
    border-top: var(--border-width) solid var(--border);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  .close {
    width: 32px;
    height: 32px;
    border: 0;
    background: none;
    font-size: var(--font-size-lg);
  }
  .body {
    display: grid;
    gap: var(--space-3);
    padding: 0 var(--space-5) var(--space-4);
    font-size: var(--font-size-sm);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  .status {
    margin: 0;
  }
  /* Calm, not alarming: these are expected situations, not failures. */
  .status.error {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
  }
  .search {
    min-height: 38px;
    padding: 0 var(--space-3);
  }
  .list {
    max-height: 320px;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    min-height: 36px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .option.active {
    background: var(--accent-soft);
  }
  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
    color: var(--muted);
  }
  @media (max-width: 720px), (pointer: coarse) {
    .option,
    .search {
      min-height: var(--touch-target);
    }
  }
</style>
