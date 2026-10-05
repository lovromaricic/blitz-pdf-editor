<script lang="ts">
  // The link form: the text to show, where it links (a web or email address,
  // or a page of this document), Apply and Remove. A popover by the text on
  // desktop and tablet, a bottom sheet on phones. Enter applies, Escape cancels.
  import { onMount } from 'svelte';
  import type { TextLink } from '../lib/annotations';
  import { cycleTab, portal } from '../lib/dom';
  import { normalizeUrl } from '../lib/links';

  let {
    anchor,
    phone,
    text: initialText,
    link,
    existing,
    pages,
    onApply,
    onRemove,
    onCancel,
  }: {
    /** Where the text is on screen (viewport coordinates). */
    anchor: { left: number; top: number; bottom: number };
    phone: boolean;
    /** The selected text (empty for a caret: then the Text field is required). */
    text: string;
    /** The link being edited, or null for a new one. */
    link: TextLink | null;
    existing: boolean;
    /** The document's pages, for "Page in this document". */
    pages: { id: string; label: string }[];
    /** `text` is null when the Text field wasn't changed. */
    onApply: (link: TextLink, text: string | null) => void;
    onRemove: () => void;
    onCancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally (the form starts from these and is then the user's)
  let text = $state(initialText);
  // svelte-ignore state_referenced_locally
  let kind = $state<'url' | 'page'>(link?.kind ?? 'url');
  // svelte-ignore state_referenced_locally
  let url = $state(link?.kind === 'url' ? link.href.replace(/^mailto:/, '') : '');
  // svelte-ignore state_referenced_locally
  let pageId = $state(link?.kind === 'page' && pages.some((p) => p.id === link.pageId) ? link.pageId : (pages[0]?.id ?? ''));
  let textError = $state('');
  let urlError = $state('');
  /** After a rejected Apply the address is checked as you type, so the message goes once it's fixed. */
  let checkLive = $state(false);

  // svelte-ignore state_referenced_locally
  const textRequired = !initialText;
  const checked = $derived(normalizeUrl(url));
  $effect(() => {
    if (checkLive) urlError = checked.ok ? '' : checked.error;
  });

  let root: HTMLDivElement;
  let textField: HTMLInputElement;
  let urlField = $state<HTMLInputElement>();
  let pageField = $state<HTMLSelectElement>();
  let height = $state(0);
  let width = $state(0);

  onMount(() => {
    (textRequired ? textField : kind === 'url' ? urlField : pageField)?.focus();
  });

  /** Below the text, or above it when there's no room below; always inside the window. */
  const place = $derived.by(() => {
    if (phone) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
    const below = anchor.bottom + 8;
    const top = below + height + 8 > vh && anchor.top - height - 8 > 8 ? anchor.top - height - 8 : Math.min(below, Math.max(8, vh - height - 8));
    return { left, top };
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    textError = textRequired && !text.trim() ? 'Enter the text to show.' : '';
    let target: TextLink | null = null;
    if (kind === 'url') {
      if (checked.ok) target = { kind: 'url', href: checked.href };
      else {
        urlError = checked.error;
        checkLive = true;
      }
    } else if (pageId) target = { kind: 'page', pageId };
    if (textError) return textField.focus();
    if (!target) return urlField?.focus();
    onApply(target, text === initialText ? null : text.replace(/[\r\n]+/g, ' '));
  }

  function onKey(e: KeyboardEvent) {
    // The editor's and the app's shortcuts stay out of the form.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else cycleTab(e, root);
  }

  const title = $derived(existing ? 'Edit link' : 'Add link');
</script>

<div
  bind:this={root}
  class="rich-editor-popover link-form"
  class:sheet={phone}
  style:left={place ? `${place.left}px` : undefined}
  style:top={place ? `${place.top}px` : undefined}
  bind:clientHeight={height}
  bind:clientWidth={width}
  role="dialog"
  aria-labelledby="link-form-title"
  tabindex="-1"
  onkeydown={onKey}
  {@attach portal}
>
  <form class="panel-form" onsubmit={submit} novalidate>
    <h2 id="link-form-title" class="title">{title}</h2>

    <div class="field">
      <label for="link-text">Text</label>
      <input
        bind:this={textField}
        id="link-text"
        type="text"
        autocomplete="off"
        bind:value={text}
        required={textRequired}
        aria-invalid={textError ? 'true' : undefined}
        aria-describedby={textError ? 'link-text-error' : undefined}
      />
      {#if textError}<span class="error" id="link-text-error" role="alert">{textError}</span>{/if}
    </div>

    <fieldset>
      <legend>Link to</legend>
      <label class="option"><input type="radio" name="link-kind" value="url" bind:group={kind} /> Web or email</label>
      <label class="option"><input type="radio" name="link-kind" value="page" bind:group={kind} /> Page in this document</label>
    </fieldset>

    {#if kind === 'url'}
      <div class="field">
        <label for="link-url">Address</label>
        <input
          bind:this={urlField}
          id="link-url"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="example.com or name@example.com"
          bind:value={url}
          aria-invalid={urlError ? 'true' : undefined}
          aria-describedby={urlError ? 'link-url-error' : checked.ok ? 'link-url-target' : undefined}
        />
        {#if urlError}
          <span class="error" id="link-url-error" role="alert">{urlError}</span>
        {:else if checked.ok}
          <!-- The address as it will be saved: international domain names show in their real (punycode) form. -->
          <span class="hint target" id="link-url-target">Opens <span class="href">{checked.href}</span></span>
        {/if}
      </div>
    {:else}
      <div class="field">
        <label for="link-page">Page</label>
        <select bind:this={pageField} id="link-page" bind:value={pageId}>
          {#each pages as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </div>
    {/if}

    <div class="buttons">
      {#if existing}
        <button type="button" class="btn btn-danger" onclick={onRemove}>Remove</button>
      {/if}
      <button type="button" class="btn" onclick={onCancel}>Cancel</button>
      <button type="submit" class="btn btn-primary">Apply</button>
    </div>
  </form>
</div>

<style>
  .link-form {
    position: fixed;
    z-index: 300;
    box-sizing: border-box;
    width: min(340px, calc(100vw - 16px));
    padding: var(--space-4);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-overlay);
  }
  /* Phones: a bottom sheet across the screen. */
  .link-form.sheet {
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    max-height: 80dvh;
    overflow-y: auto;
    padding: var(--space-4) 16px;
    border-width: var(--border-width) 0 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .panel-form {
    gap: var(--space-3);
  }
  .title {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 700;
  }
  .target {
    overflow-wrap: anywhere;
  }
  .href {
    color: var(--link);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .buttons .btn {
    width: auto;
  }
  /* Remove sits apart, on the left. */
  .buttons .btn-danger {
    margin-right: auto;
  }
  @media (max-width: 720px) {
    .buttons .btn {
      flex: 1;
    }
    .buttons .btn-danger {
      margin-right: 0;
    }
  }
</style>
