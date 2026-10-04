<script lang="ts">
  // Font picker: a button that opens a searchable list grouped by kind, each
  // name shown in its own typeface. Previews use tiny name-only fonts; the real
  // font file is fetched when a font is hovered or chosen.
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { tick, type Snippet } from 'svelte';
  import { FONT_GROUPS, FONTS, fontLabel } from '../lib/font-catalog';
  import { cssFamily, ensureFont, loadFontPreviews, type FontPreviews } from '../lib/fonts';
  import FontName from './FontName.svelte';

  let {
    id,
    value,
    onChange,
    extra,
  }: {
    id: string;
    value: string;
    onChange: (font: string) => void;
    /** Extra content at the bottom of the list (e.g. "My computer's fonts…"). */
    extra?: Snippet<[close: () => void]>;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let active = $state<string | null>(null);
  let trigger = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();
  let search = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let previews = $state.raw<FontPreviews | null>(null);
  const uid = Math.random().toString(36).slice(2, 8);

  const filtered = $derived(FONTS.filter((f) => f.label.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = $derived(FONT_GROUPS.map((g) => ({ name: g, fonts: filtered.filter((f) => f.group === g) })).filter((g) => g.fonts.length));
  const optionId = (font: string) => `font-${uid}-${font}`;

  function loadPreviews() {
    void loadFontPreviews().then((p) => (previews = p));
  }

  /** Real font loaded (after hover or choice): the preview can use it too. */
  let loaded = $state<Record<string, boolean>>({});
  function prefetch(font: string) {
    if (loaded[font]) return;
    void ensureFont(font).then((ok) => ok && (loaded[font] = true));
  }

  async function show() {
    loadPreviews();
    query = '';
    active = FONTS.some((f) => f.id === value) ? value : FONTS[0].id;
    open = true;
    await tick();
    search?.focus();
    scrollActive();
  }

  async function hide(returnFocus = true) {
    open = false;
    if (returnFocus) {
      await tick();
      trigger?.focus();
    }
  }

  function choose(font: string) {
    onChange(font);
    void hide();
  }

  function scrollActive() {
    if (active) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }

  function move(delta: number) {
    if (!filtered.length) return;
    // Visual order: by group, as listed.
    const order = groups.flatMap((g) => g.fonts);
    const i = order.findIndex((f) => f.id === active);
    const next = order[Math.min(order.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
    active = next.id;
    prefetch(next.id);
    void tick().then(scrollActive);
  }

  function onKey(e: KeyboardEvent) {
    const order = groups.flatMap((g) => g.fonts);
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home' && order.length) (active = order[0].id), void tick().then(scrollActive);
    else if (e.key === 'End' && order.length) (active = order[order.length - 1].id), void tick().then(scrollActive);
    else if (e.key === 'Enter') {
      if (active && order.some((f) => f.id === active)) choose(active);
    } else if (e.key === 'Escape') {
      // Handled here: the editor must not also treat it as "deselect".
      e.stopPropagation();
      void hide();
    } else return;
    e.preventDefault();
  }

  // Typing filters; keep the highlighted font visible in the results.
  $effect(() => {
    void query;
    if (open && filtered.length && !filtered.some((f) => f.id === active)) active = groups[0]?.fonts[0]?.id ?? null;
  });

  // Click outside closes.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popover?.contains(t) || trigger?.contains(t)) return;
      void hide(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  const current = $derived(FONTS.find((f) => f.id === value));
  // The current font is the one new text uses: load it to show its name in it.
  $effect(() => prefetch(value));
</script>

<div class="font-picker">
  <button
    bind:this={trigger}
    {id}
    type="button"
    class="trigger"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? `fonts-${uid}` : undefined}
    onclick={() => (open ? hide() : show())}
    onkeydown={(e) => (e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.preventDefault(), show())}
  >
    <span class="current" style:font-family={current && loaded[value] ? `"${cssFamily(value)}", var(--font-sans)` : undefined}>{fontLabel(value)}</span>
    <ChevronDown size={16} strokeWidth={1.7} aria-hidden="true" />
  </button>

  {#if open}
    <div class="backdrop" aria-hidden="true"></div>
    <div bind:this={popover} class="popover" role="dialog" aria-label="Choose a font">
      <input
        bind:this={search}
        bind:value={query}
        type="text"
        class="search"
        placeholder="Search fonts"
        aria-label="Search fonts"
        role="combobox"
        aria-expanded="true"
        aria-controls="fonts-{uid}"
        aria-autocomplete="list"
        aria-activedescendant={active && filtered.some((f) => f.id === active) ? optionId(active) : undefined}
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKey}
      />
      <div bind:this={list} class="list" id="fonts-{uid}" role="listbox" aria-label="Fonts">
        {#each groups as g (g.name)}
          <div role="group" aria-labelledby="fg-{uid}-{g.name}">
            <div class="group-label section-label" id="fg-{uid}-{g.name}" role="presentation">{g.name}</div>
            {#each g.fonts as f (f.id)}
              <!-- Options are chosen with the pointer here, or with the keyboard from the search field. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                id={optionId(f.id)}
                role="option"
                tabindex="-1"
                aria-selected={f.id === value}
                class="option"
                class:active={f.id === active}
                onpointerenter={() => ((active = f.id), prefetch(f.id))}
                onclick={() => choose(f.id)}
              >
                <FontName font={f.id} label={f.label} {previews} loaded={loaded[f.id]} />
                {#if f.id === value}<Check class="check" size={16} strokeWidth={2} aria-hidden="true" />{/if}
              </div>
            {/each}
          </div>
        {/each}
        {#if !filtered.length}<p class="empty">No fonts match "{query}".</p>{/if}
      </div>
      {@render extra?.(() => hide())}
    </div>
  {/if}
</div>

<style>
  .font-picker {
    position: relative;
  }
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    min-height: 38px;
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--font-size-md);
    text-align: left;
  }
  .current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    /* Wide enough for the longest name; the panel is 288px. */
    width: max(100%, 244px);
    z-index: 50;
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-overlay);
  }
  .search {
    width: 100%;
    min-height: 34px;
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
  }
  .list {
    max-height: 320px;
    overflow-y: auto;
  }
  .group-label {
    padding: var(--space-2) var(--space-2) var(--space-1);
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 36px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  /* The option the arrow keys are on (focus stays in the search field, which has the ring). */
  .option.active {
    background: var(--accent-soft);
  }
  .option[aria-selected='true'] {
    color: var(--accent-strong);
  }
  .option :global(.check) {
    flex-shrink: 0;
    color: var(--accent);
  }
  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
    color: var(--muted);
    font-size: var(--font-size-sm);
  }
  .backdrop {
    display: none;
  }
  @media (max-width: 720px), (pointer: coarse) {
    .trigger,
    .search,
    .option {
      min-height: var(--touch-target);
    }
  }
  @media (max-width: 720px) {
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 400;
      display: block;
      background: var(--backdrop);
    }
    .popover {
      position: fixed;
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 401;
      max-height: 85dvh;
      grid-template-rows: auto minmax(0, 1fr) auto;
      padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    }
    .list {
      max-height: none;
    }
  }
</style>
