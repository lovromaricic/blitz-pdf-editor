<script lang="ts">
  // Landing screen: wordmark, headline, "Choose files", and the whole window as
  // a drop target. Works from the first paint; the 3D falling-paper background
  // (Three.js, its own chunk) loads after that, when the browser is idle.
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { onMount } from 'svelte';
  import { APP_NAME } from '../config';
  import { app } from '../lib/app-state.svelte';
  import type { RejectedFile } from '../lib/files';
  import { openFiles, opening } from '../lib/open-files.svelte';
  import { HOME_STRINGS as T } from '../lib/strings';
  import { acceptAttr, dragLooksValid, splitFiles } from '../lib/landing/accepted-files';
  import { carriesFiles, IDLE, isOver, nextDrag, type DragState } from '../lib/landing/drag-state';
  import type { PaperScene } from '../lib/landing/paper-scene';
  import { ABSORB } from '../lib/landing/absorb-timeline';
  import { openingSequence, WHITE } from '../lib/landing/opening-sequence.svelte';

  let input: HTMLInputElement;
  let canvas: HTMLCanvasElement;

  /** HEIC is accepted only where the browser can decode it (found out after first paint). */
  let heic = $state(false);
  let drag = $state<DragState>(IDLE);
  /** The dragged items could be supported files (browsers that reveal types). */
  let looksValid = $state(true);
  const charged = $derived(isOver(drag) && looksValid);
  let message = $state('');
  let rejected = $state<RejectedFile[]>([]);
  let sceneState = $state<'waiting' | 'ready' | 'fallback' | 'gone'>('waiting');
  let scene: PaperScene | null = null;
  const busy = $derived(opening.busy);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tell the scene (if it's there yet) whether a file is over the window (the ring).
  $effect(() => {
    const on = charged;
    scene?.setCharged(on);
  });

  let disposed = false;

  /** Create the 3D scene (after first paint, and again if it was put away for an opening that then failed). */
  async function loadScene() {
    try {
      const { createPaperScene } = await import('../lib/landing/paper-scene');
      if (disposed) return;
      scene = createPaperScene(canvas, { reducedMotion, onReady: () => (sceneState = 'ready') });
      if (!scene) sceneState = 'fallback';
      else scene.setCharged(charged);
      if (import.meta.env.DEV) Object.assign(window, { __paperScene: scene });
    } catch {
      if (!disposed) sceneState = 'fallback';
    }
  }

  /** Fully white: the scene goes (canvas hidden, loop stopped, everything it holds released). */
  function putSceneAway() {
    sceneState = 'gone';
    scene?.dispose();
    scene = null;
  }

  onMount(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    // After the first paint, when the browser has a moment: never in the way of the button.
    const raf = requestAnimationFrame(() =>
      idle(() => {
        void import('../lib/landing/heic-probe').then(({ heicDecodes }) => heicDecodes()).then((ok) => !disposed && (heic = ok));
        void loadScene();
      }),
    );
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(coverTimer);
      scene?.dispose();
      scene = null;
      app.landingHold = false;
    };
  });

  /** The opening transition is playing: the panel has faded and takes no input. */
  let absorbing = $state(false);
  let coverTimer: ReturnType<typeof setTimeout> | undefined;
  /** A document opened from here: this screen is on its way out. */
  let handedOver = $state(false);

  /** Back to the landing screen as it was (opening failed, or the document was closed right away). */
  function backToIdle() {
    clearTimeout(coverTimer);
    openingSequence.cancel();
    app.landingHold = false;
    absorbing = false;
    if (scene) scene.reset();
    else if (sceneState === 'gone') {
      sceneState = 'waiting';
      void loadScene();
    }
  }

  // The document was closed while this screen was still on its way out: Svelte brings
  // the same screen back, so return it to idle. (It kept "absorbing" and ignored
  // every file chosen or dropped afterwards.)
  $effect(() => {
    if (app.doc || !handedOver) return;
    handedOver = false;
    backToIdle();
  });

  async function intake(list: File[]) {
    if (list.length === 0 || busy || absorbing) return;
    message = '';
    rejected = [];
    const { accepted, rejected: unsupported } = splitFiles(list, heic);
    if (accepted.length === 0) {
      // No animation for files we can't open: back to idle, calmly.
      message = T.unsupported;
      return;
    }
    // The absorb plays while the files load; Home stays on top (the editor mounting underneath
    // as soon as the file is ready) until the window has gone white, then the white fades
    // out over the editor (opening-sequence.svelte.ts).
    const animate = !!scene && !reducedMotion;
    if (animate) {
      absorbing = true;
      app.landingHold = true;
      openingSequence.start({ onWhite: putSceneAway, onReveal: () => (app.landingHold = false) });
      const covered = () => {
        clearTimeout(coverTimer);
        openingSequence.covered();
      };
      scene!.absorb(covered, WHITE.coverAt);
      // Never let the animation hold the editor back (e.g. frames paused in a background tab).
      coverTimer = setTimeout(covered, (ABSORB.doneAt + 0.3) * 1000);
    }
    // Start reading at once, in parallel with the animation.
    const problems = await openFiles(accepted);
    const skipped = unsupported.map((f) => ({ name: f.name, reason: T.unsupported }));
    if (app.doc) {
      // Opened: anything skipped is listed in the editor's notice.
      if (skipped.length) app.openWarnings = [...app.openWarnings, ...skipped];
      handedOver = true;
      if (animate) openingSequence.fileReady();
      return;
    }
    // Not opened (damaged, cancelled…): back to the landing screen as it was.
    backToIdle();
    rejected = [...skipped, ...problems];
  }

  function onPick(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    input.value = '';
    void intake(list);
  }

  // --- Whole-window drop target ---------------------------------------------------

  function onDragEnter(e: DragEvent) {
    if (!carriesFiles(e.dataTransfer?.types)) return;
    e.preventDefault();
    if (!isOver(drag)) {
      message = '';
      looksValid = dragLooksValid(Array.from(e.dataTransfer?.items ?? []), heic);
    }
    drag = nextDrag(drag, { kind: 'enter', files: true });
  }

  function onDragOver(e: DragEvent) {
    if (!carriesFiles(e.dataTransfer?.types)) return;
    // Without this the browser would open the dropped file itself.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: DragEvent) {
    const files = carriesFiles(e.dataTransfer?.types);
    const leftWindow =
      !e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight);
    drag = nextDrag(drag, { kind: 'leave', files, leftWindow });
  }

  function onDrop(e: DragEvent) {
    const files = carriesFiles(e.dataTransfer?.types);
    drag = nextDrag(drag, { kind: 'drop', files });
    if (!files) return;
    e.preventDefault();
    void intake(Array.from(e.dataTransfer?.files ?? []));
  }
</script>

<svelte:window ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop} />

<div class="landing" class:charged>
  <!-- Transparent until the 3D scene has drawn, then fades in: no layout shift. -->
  <canvas bind:this={canvas} class="scene" class:ready={sceneState === 'ready'} class:gone={sceneState === 'gone'} aria-hidden="true"></canvas>
  {#if sceneState === 'fallback'}
    <div class="fallback" aria-hidden="true">
      <i style:left="6%" style:top="12%" style:--turn="-12deg"></i>
      <i style:left="14%" style:top="62%" style:--turn="9deg"></i>
      <i style:right="8%" style:top="16%" style:--turn="11deg"></i>
      <i style:right="15%" style:top="64%" style:--turn="-8deg"></i>
    </div>
  {/if}

  <main class="center">
    <div class="panel" class:away={absorbing} inert={absorbing}>
      <div class="wordmark">
        <svg class="bolt" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
        </svg>
        <span>{APP_NAME}</span>
      </div>
      <h1>{T.headline}</h1>
      <p class="drop-line" aria-hidden="true">{charged ? T.dropLineCharged : T.dropLine}</p>
      <button class="btn choose" type="button" disabled={busy} onclick={() => input.click()}>
        {busy ? T.opening : T.chooseFiles}
      </button>
      <input
        bind:this={input}
        class="visually-hidden"
        type="file"
        accept={acceptAttr(heic)}
        multiple
        tabindex="-1"
        aria-hidden="true"
        onchange={(e) => onPick(e.currentTarget.files)}
      />
      <p class="message" aria-live="polite">{message}</p>
      {#if rejected.length > 0}
        <div class="errors" role="alert">
          <p class="errors-title">
            <CircleAlert size={18} strokeWidth={1.7} aria-hidden="true" />
            {rejected.length === 1 ? T.couldNotOpenOne : T.couldNotOpenMany}
          </p>
          <ul>
            {#each rejected as r, i (r.name + i)}
              <li><span class="filename">{r.name}</span>: {r.reason}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </main>
  {#if openingSequence.waiting}
    <!-- White, the file still loading: for screen readers (App draws it on the white). -->
    <p class="visually-hidden" role="status">{T.opening}</p>
  {/if}
  <p class="visually-hidden" aria-live="polite">{charged ? T.chargedAnnouncement : ''}</p>
</div>

<style>
  .landing {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--bg);
  }
  .scene {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 300ms ease;
    pointer-events: none;
  }
  .scene.ready {
    opacity: 1;
  }
  /* Put away under the white of the opening transition. */
  .scene.gone {
    visibility: hidden;
    transition: none;
  }
  /* No WebGL: a few still, faded pages at the sides. */
  .fallback {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .fallback i {
    position: absolute;
    width: 70px;
    height: 96px;
    border: var(--border-width) solid var(--border);
    border-radius: 3px;
    background: var(--page);
    opacity: 0.7;
    transform: rotate(var(--turn));
  }
  /* The text sits in the optical center; only the button takes the pointer, so a drop works everywhere. */
  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    pointer-events: none;
  }
  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 100%;
    padding: 22px 32px;
    border-radius: 18px;
    background: var(--landing-panel);
    text-align: center;
  }
  /* The opening transition: the panel fades out the moment it starts. */
  .panel.away {
    opacity: 0;
    transform: scale(0.97);
  }
  .panel {
    transition:
      opacity 300ms ease,
      transform 300ms ease;
  }
  .wordmark {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 22px;
    font-weight: 500;
  }
  .bolt {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
  }
  .bolt path {
    fill: var(--bolt);
    stroke: var(--bolt-edge);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  h1 {
    margin: 0;
    font-size: clamp(24px, 6vw, 32px);
    font-weight: 500;
    line-height: 1.15;
  }
  @media (min-width: 640px) {
    h1 {
      white-space: nowrap;
    }
  }
  .drop-line {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-size-md);
  }
  /* Touch devices: nothing can be dragged. */
  @media (hover: none) and (pointer: coarse) {
    .drop-line {
      display: none;
    }
  }
  .choose {
    min-height: var(--touch-target);
    margin-top: var(--space-1);
    padding: 0 26px;
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--font-size-md);
    font-weight: 600;
    pointer-events: auto;
  }
  .choose:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .choose:disabled {
    cursor: progress;
  }
  .message {
    min-height: 1.4em;
    margin: 0;
    color: var(--muted);
    font-size: var(--font-size-sm);
  }
  .message:empty {
    min-height: 0;
  }
  .errors {
    max-width: 30rem;
    padding: var(--space-3) var(--space-4);
    border-left: 4px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--danger-soft);
    font-size: var(--font-size-sm);
    text-align: left;
    pointer-events: auto;
  }
  .errors-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--danger);
    font-weight: 700;
  }
  .errors ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
  }
  .filename {
    font-weight: 600;
    word-break: break-all;
  }
  @media (prefers-reduced-motion: reduce) {
    .scene,
    .panel {
      transition: none;
    }
  }
</style>
