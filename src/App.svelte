<script lang="ts">
  import { app } from './lib/app-state.svelte';
  import { loadEditorModules } from './lib/open-files.svelte';
  import Home from './screens/Home.svelte';
  import PasswordDialog from './components/PasswordDialog.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import { appError, installGlobalErrorHandlers } from './lib/errors.svelte';

  installGlobalErrorHandlers();

  // The editor (and PDF.js inside it) is a separate chunk, fetched in the background
  // once the Home screen is up so it's ready by the time a file is chosen.
  const loadEditor = () => import('./screens/Editor.svelte');
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
  idle(() => {
    void loadEditor();
    void loadEditorModules();
  });
</script>

{#if app.doc}
  {#await loadEditor() then { default: Editor }}
    {#key app.doc}
      <Editor doc={app.doc} />
    {/key}
  {:catch}
    <p class="load-failed" role="alert">
      The editor could not be loaded. Check your connection and <a href="./">reload the page</a>.
    </p>
  {/await}
{:else}
  <Home />
{/if}

<PasswordDialog />
<DialogHost />

{#if appError.message}
  <div class="app-error" role="alert">
    <span>{appError.message}</span>
    <button type="button" aria-label="Dismiss" onclick={() => (appError.message = null)}>×</button>
  </div>
{/if}

<style>
  .load-failed {
    max-width: 40rem;
    margin: 20vh auto;
    padding: var(--space-4);
    text-align: center;
  }
  .app-error {
    position: fixed;
    left: 50%;
    top: var(--space-3);
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: min(560px, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-2) var(--space-3);
    transform: translateX(-50%);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: var(--font-size-sm);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }
  .app-error button {
    min-width: 32px;
    min-height: 32px;
    border: 0;
    background: none;
    font-size: var(--font-size-lg);
  }
</style>
