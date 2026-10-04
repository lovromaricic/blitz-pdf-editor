<script lang="ts">
  import { app } from './lib/app-state.svelte';
  import { loadEditorModules } from './lib/open-files.svelte';
  import Home from './screens/Home.svelte';
  import PasswordDialog from './components/PasswordDialog.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import { appError, installGlobalErrorHandlers } from './lib/errors.svelte';
  import X from '@lucide/svelte/icons/x';
  import { fade } from 'svelte/transition';
  import { tick } from 'svelte';

  installGlobalErrorHandlers();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // When the editor takes over from the landing screen, move focus into the document.
  $effect(() => {
    if (!app.doc || app.landingHold) return;
    // The editor may still be rendering: try for a few frames.
    let tries = 0;
    const focusDocument = () => {
      const view = document.getElementById('document-view');
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('.landing')) return;
      if (view) view.focus({ preventScroll: true });
      else if (++tries < 30) requestAnimationFrame(focusDocument);
    };
    void tick().then(focusDocument);
  });

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
{/if}
{#if !app.doc || app.landingHold}
  <!-- Home stays on top while its opening transition plays (the editor mounts underneath
       as soon as the file is ready), then crossfades to the editor. -->
  <div
    class="home-layer"
    out:fade={{ duration: reducedMotion ? 0 : 150 }}
    onoutrostart={(e) => ((e.currentTarget as HTMLElement).style.pointerEvents = 'none')}
  >
    <Home />
  </div>
{/if}

<PasswordDialog />
<DialogHost />

{#if appError.message}
  <div class="app-error" role="alert">
    <strong>Something went wrong.</strong>
    <span>{appError.message}</span>
    <button type="button" aria-label="Dismiss" onclick={() => (appError.message = null)}>
      <X size={16} strokeWidth={1.7} aria-hidden="true" />
    </button>
  </div>
{/if}

<style>
  /* Above the editor while fading out; the landing itself is fixed to the viewport. */
  .home-layer {
    position: relative;
    z-index: 50;
  }
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
    border: var(--border-width) solid var(--border);
    border-left: 4px solid var(--danger);
    border-radius: var(--radius-lg);
    background: var(--danger-soft);
    color: var(--text);
    font-size: var(--font-size-sm);
    box-shadow: var(--shadow-overlay);
  }
  .app-error strong {
    color: var(--danger);
    white-space: nowrap;
  }
  .app-error button {
    display: grid;
    place-items: center;
    min-width: 32px;
    min-height: 32px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
  }
</style>
