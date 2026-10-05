<script lang="ts">
  // Shown while typing in a text box, when the pointer is over a link or the
  // caret is in one: where it goes, and Edit, Remove and Open. Its buttons
  // don't take focus from the text (you keep typing where you were).
  import Pencil from '@lucide/svelte/icons/pencil';
  import Unlink from '@lucide/svelte/icons/unlink';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { portal } from '../lib/dom';
  import { isMac } from '../lib/commands';
  import { ICON } from './tools';

  let {
    anchor,
    target,
    kind,
    onEdit,
    onRemove,
    onOpen,
    onHover,
  }: {
    anchor: { left: number; top: number; bottom: number };
    /** The address (or "Page 3"). */
    target: string;
    kind: 'url' | 'page';
    onEdit: () => void;
    onRemove: () => void;
    onOpen: () => void;
    /** The pointer entered (true) or left (false) the card. */
    onHover: (inside: boolean) => void;
  } = $props();

  let height = $state(0);
  let width = $state(0);
  const place = $derived.by(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
    const below = anchor.bottom + 6;
    const top = below + height + 8 > vh ? Math.max(8, anchor.top - height - 6) : below;
    return { left, top };
  });

  const openHint = `Alt+Enter, or ${isMac ? '⌘' : 'Ctrl'}+click the link`;
</script>

<!-- The pointer listeners only keep the card open and the caret in the text; the buttons are the controls. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="rich-editor-popover link-card"
  role="group"
  aria-label="Link"
  style:left="{place.left}px"
  style:top="{place.top}px"
  bind:clientHeight={height}
  bind:clientWidth={width}
  onpointerenter={() => onHover(true)}
  onpointerleave={() => onHover(false)}
  onmousedown={(e) => e.preventDefault()}
  {@attach portal}
>
  <span class="target" class:page={kind === 'page'} title={target}>{target}</span>
  <button type="button" class="act" aria-label="Edit link" title="Edit link ({isMac ? '⌘K' : 'Ctrl+K'})" onclick={onEdit}><Pencil {...ICON} aria-hidden="true" /></button>
  <button type="button" class="act" aria-label="Remove link" title="Remove link" onclick={onRemove}><Unlink {...ICON} aria-hidden="true" /></button>
  <button type="button" class="act" aria-label={kind === 'page' ? 'Go to page' : 'Open link in a new tab'} title={kind === 'page' ? `Go to page (${openHint})` : `Open in a new tab (${openHint})`} onclick={onOpen}>
    <ExternalLink {...ICON} aria-hidden="true" />
  </button>
</div>

<style>
  .link-card {
    position: fixed;
    z-index: 290;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: min(360px, calc(100vw - 16px));
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-overlay);
    font-size: var(--font-size-sm);
  }
  .target {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--link);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .target.page {
    color: var(--text);
  }
  .act {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
  }
  .act:hover {
    background: var(--surface-2);
  }
  @media (max-width: 720px), (pointer: coarse) {
    .act {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
