<script lang="ts">
  import { tick } from 'svelte';
  import { dialogs } from '../lib/dialogs.svelte';

  let dialog: HTMLDialogElement;
  let text = $state('');
  let input = $state<HTMLInputElement | null>(null);

  const req = $derived(dialogs.current);

  $effect(() => {
    if (req && !dialog.open) {
      text = req.input?.value ?? '';
      dialog.showModal();
      void tick().then(() => {
        if (input) {
          input.focus();
          // Select the name without the extension, like desktop save dialogs.
          const dot = text.lastIndexOf('.');
          input.setSelectionRange(0, dot > 0 ? dot : text.length);
        } else {
          const first = req.initialFocus ? dialog.querySelector<HTMLButtonElement>(`button[data-value="${req.initialFocus}"]`) : null;
          (first ?? dialog.querySelector<HTMLButtonElement>('button.btn-primary'))?.focus();
        }
      });
    } else if (!req && dialog.open) {
      dialog.close();
    }
  });

  function choose(value: string) {
    req?.resolve({ button: value, text });
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const primary = req?.buttons.find((b) => b.primary);
    if (primary) choose(primary.value);
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="dlg-title"
  aria-describedby={req?.message ? 'dlg-message' : undefined}
  oncancel={(e) => {
    e.preventDefault();
    if (req) choose(req.cancelValue);
  }}
  onclick={(e) => {
    // A click on the backdrop (outside the dialog's box) cancels.
    if (e.target === dialog && req) {
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) choose(req.cancelValue);
    }
  }}
>
  {#if req}
    <form onsubmit={onSubmit}>
      <h2 id="dlg-title">{req.title}</h2>
      {#if req.message}<p id="dlg-message">{req.message}</p>{/if}
      {#if req.input}
        <label for="dlg-input">{req.input.label}</label>
        <input id="dlg-input" bind:this={input} bind:value={text} autocomplete="off" spellcheck="false" />
      {/if}
      <div class="actions">
        {#each req.buttons as b (b.value)}
          <button class="btn" class:btn-primary={b.primary} class:btn-danger={b.danger} data-value={b.value} type={b.primary ? 'submit' : 'button'} onclick={b.primary ? undefined : () => choose(b.value)}>
            {b.label}
          </button>
        {/each}
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-5);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  label {
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  input {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
