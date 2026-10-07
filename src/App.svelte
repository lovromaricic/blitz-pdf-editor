<script lang="ts">
  import { app } from './lib/app-state.svelte';
  import { loadEditorModules } from './lib/open-files.svelte';
  import Home from './screens/Home.svelte';
  import PasswordDialog from './components/PasswordDialog.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import { appError, installGlobalErrorHandlers } from './lib/errors.svelte';
  import X from '@lucide/svelte/icons/x';
  import { fade } from 'svelte/transition';
  import { cubicOut, quadIn } from 'svelte/easing';
  import { openingSequence, WHITE } from './lib/landing/opening-sequence.svelte';
  import { HOME_STRINGS } from './lib/strings';
  import { tick } from 'svelte';
  import { focusEditorLandmark } from './lib/focus-editor';

  installGlobalErrorHandlers();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // When the editor takes over from the landing screen, move focus to its <main> landmark:
  // not the scrolling canvas, which would show its keyboard focus ring.
  $effect(() => {
    if (!app.doc || app.landingHold) return;
    // The editor may still be rendering: try for a few frames.
    let tries = 0;
    const focusDocument = () => {
      if (!focusEditorLandmark() && ++tries < 30) requestAnimationFrame(focusDocument);
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
       as soon as the file is ready). It goes at once under the white of the transition;
       without the transition (no 3D scene) it crossfades to the editor. -->
  <div
    class="home-layer"
    out:fade={{ duration: reducedMotion || openingSequence.overlay ? 0 : 150 }}
    onoutrostart={(e) => ((e.currentTarget as HTMLElement).style.pointerEvents = 'none')}
  >
    <Home />
  </div>
{/if}

{#if openingSequence.opaque}
  <!-- The end of the opening transition: plain white over the growing page, then faded out
       over the editor. Not focusable, nothing to read (the landing screen has the status). -->
  <div
    class="whiteout"
    aria-hidden="true"
    in:fade={{ duration: WHITE.inMs, easing: quadIn }}
    out:fade={{ duration: WHITE.outMs, easing: cubicOut }}
    onintroend={() => openingSequence.whiteShown()}
  >
    {#if openingSequence.waiting}<p class="waiting">{HOME_STRINGS.opening}</p>{/if}
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
  /* Above the landing screen and the editor; dialogs (password, large file) are above it. */
  .whiteout {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: var(--page);
    pointer-events: none;
  }
  .waiting {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--muted);
    font-size: var(--font-size-sm);
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
