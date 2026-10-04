<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import FileUp from '@lucide/svelte/icons/file-up';
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
    <span class="drop-icon" aria-hidden="true"><FileUp size={28} strokeWidth={1.7} /></span>
    <p class="drop-hint" aria-hidden="true">Drop PDF files here</p>
    <p class="drop-sub" aria-hidden="true">Images work too: they become a PDF.</p>
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
      accept="application/pdf,.pdf,image/*"
      multiple
      tabindex="-1"
      aria-hidden="true"
      onchange={(e) => intake(e.currentTarget.files)}
    />

    <p class="privacy">{COPY.privacyNote}</p>
  </section>

  {#if rejected.length > 0}
    <div class="errors card card-error" role="alert">
      <p class="card-title">
        <CircleAlert size={18} strokeWidth={1.7} aria-hidden="true" />
        {rejected.length === 1 ? 'This file could not be opened' : 'These files could not be opened'}
      </p>
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
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--muted);
    font-size: var(--font-size-sm);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .intro {
    display: grid;
    gap: var(--space-2);
    text-align: center;
  }

  h1 {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .value {
    color: var(--muted);
    font-size: var(--font-size-base);
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 640px;
    padding: var(--space-7) var(--space-5);
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    text-align: center;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);
  }

  .dropzone.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .drop-icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .drop-hint {
    font-size: var(--font-size-lg);
    font-weight: 700;
  }

  .drop-or,
  .drop-sub {
    color: var(--muted);
    font-size: var(--font-size-sm);
  }

  .choose {
    min-width: 200px;
    min-height: var(--touch-target);
    font-size: var(--font-size-md);
  }

  .choose:disabled {
    cursor: progress;
  }

  .label-mobile {
    display: none;
  }

  .privacy {
    margin-top: var(--space-2);
    color: var(--muted);
    font-size: var(--font-size-sm);
  }

  .errors {
    width: 100%;
    max-width: 640px;
    padding: var(--space-4);
    font-size: var(--font-size-sm);
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .errors ul {
    margin: var(--space-2) 0 0;
    padding-left: calc(var(--space-5) + var(--space-2));
  }

  .filename {
    font-weight: 600;
    word-break: break-all;
  }

  /* Phones and touch-first devices: no drag-and-drop wording, one big button. */
  @media (max-width: 720px), (pointer: coarse) {
    .drop-hint,
    .drop-or,
    .drop-sub,
    .drop-icon {
      display: none;
    }
    .label-desktop {
      display: none;
    }
    .label-mobile {
      display: inline;
    }
  }

  @media (max-width: 720px) {
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
