<script lang="ts">
  import { COPY } from '../config';
  import type { RejectedFile } from '../lib/files';
  import { openFiles, opening } from '../lib/open-files.svelte';

  let input: HTMLInputElement;
  let dragDepth = $state(0);
  let rejected = $state<RejectedFile[]>([]);

  const dragging = $derived(dragDepth > 0);
  const busy = $derived(opening.busy);

  async function intake(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    try {
      rejected = await openFiles(Array.from(files));
    } finally {
      if (input) input.value = '';
    }
  }

  function hasFiles(e: DragEvent) {
    return e.dataTransfer?.types.includes('Files') ?? false;
  }

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
  }

  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
  }

  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    intake(e.dataTransfer?.files ?? null);
  }

  // Stop the browser from navigating to a file dropped outside the drop zone.
  function blockStrayDrop(e: DragEvent) {
    if (hasFiles(e)) e.preventDefault();
  }
</script>

<svelte:window ondragover={blockStrayDrop} ondrop={blockStrayDrop} />

<main class="home">
  <div class="hero-placeholder" role="img" aria-label="Animation placeholder">
    <span>Visual / animation placeholder</span>
  </div>

  <section class="intro">
    <h1>{COPY.headline}</h1>
    <p class="value">{COPY.valueStatement}</p>
  </section>

  <section
    class="dropzone"
    class:dragging
    aria-label="Open a PDF"
    ondragenter={onDragEnter}
    ondragleave={onDragLeave}
    ondragover={onDragOver}
    ondrop={onDrop}
  >
    <p class="drop-hint" aria-hidden="true">Drop PDF files here</p>
    <p class="drop-or" aria-hidden="true">or</p>

    <button class="btn btn-primary choose" type="button" onclick={() => input.click()} disabled={busy}>
      {#if busy}
        Opening…
      {:else}
        <span class="label-desktop">Choose file</span>
        <span class="label-mobile">Choose a PDF</span>
      {/if}
    </button>

    <input
      bind:this={input}
      class="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      multiple
      tabindex="-1"
      aria-hidden="true"
      onchange={(e) => intake(e.currentTarget.files)}
    />

    <p class="privacy">{COPY.privacyNote}</p>
  </section>

  {#if rejected.length > 0}
    <div class="errors" role="alert">
      <p><strong>{rejected.length === 1 ? 'This file could not be opened:' : 'These files could not be opened:'}</strong></p>
      <ul>
        {#each rejected as r (r.name)}
          <li><span class="filename">{r.name}</span>: {r.reason}</li>
        {/each}
      </ul>
    </div>
  {/if}
</main>

<style>
  .home {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    width: 100%;
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-8);
  }

  .hero-placeholder {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 16 / 5;
    min-height: 160px;
    background: var(--color-placeholder);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .intro {
    text-align: center;
    display: grid;
    gap: var(--space-2);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: 1.2;
  }

  .value {
    color: var(--color-text-muted);
    font-size: var(--font-size-lg);
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 640px;
    padding: var(--space-7) var(--space-5);
    border: 2px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    text-align: center;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .dropzone.dragging {
    background: var(--color-surface-strong);
    border-color: var(--color-accent);
    border-style: solid;
  }

  .drop-hint {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  .drop-or {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .choose {
    min-width: 200px;
    font-size: var(--font-size-md);
    font-weight: 600;
  }

  .choose:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .label-mobile {
    display: none;
  }

  .privacy {
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .errors {
    width: 100%;
    max-width: 640px;
    padding: var(--space-4);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: var(--font-size-sm);
  }

  .errors ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
  }

  .filename {
    font-weight: 600;
    word-break: break-all;
  }

  /* Phones and touch-first devices: no drag-and-drop wording, one big button. */
  @media (max-width: 640px), (pointer: coarse) {
    .drop-hint,
    .drop-or {
      display: none;
    }
    .label-desktop {
      display: none;
    }
    .label-mobile {
      display: inline;
    }
  }

  @media (max-width: 640px) {
    .home {
      gap: var(--space-5);
      padding-top: var(--space-4);
    }
    .hero-placeholder {
      aspect-ratio: 4 / 3;
    }
    h1 {
      font-size: var(--font-size-xl);
    }
    .value {
      font-size: var(--font-size-md);
    }
    .dropzone {
      padding: var(--space-5) var(--space-4);
      border: none;
      background: none;
    }
    .choose {
      width: 100%;
      min-height: 56px;
    }
  }
</style>
