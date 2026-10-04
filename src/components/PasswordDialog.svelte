<script lang="ts">
  import { opening } from '../lib/open-files.svelte';

  let dialog: HTMLDialogElement;
  let value = $state('');

  const request = $derived(opening.password);

  $effect(() => {
    if (request && !dialog.open) {
      value = '';
      dialog.showModal();
    } else if (!request && dialog.open) {
      dialog.close();
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    request?.resolve(value);
  }

  function cancel() {
    request?.resolve(null);
  }
</script>

<dialog bind:this={dialog} aria-labelledby="pw-title" oncancel={(e) => { e.preventDefault(); cancel(); }}>
  {#if request}
    <form onsubmit={submit}>
      <h2 id="pw-title">Password required</h2>
      <p><strong class="name">{request.fileName}</strong> is protected. Enter its password to open it.</p>
      {#if request.retry}
        <p class="error" role="alert">That password is incorrect. Try again.</p>
      {/if}
      <label for="pw-input">Password</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="pw-input" type="password" bind:value autocomplete="off" autofocus />
      <div class="actions">
        <button class="btn" type="button" onclick={cancel}>Cancel</button>
        <button class="btn btn-primary" type="submit">Open</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-5);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-bg);
    color: var(--color-text);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  .name {
    word-break: break-all;
  }
  .error {
    padding: var(--space-2) var(--space-3);
    background: var(--color-error-bg);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
  }
  label {
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  input {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
