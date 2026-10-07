// The end of the landing screen's opening transition: once the growing top
// page covers most of the window, a plain white layer fades in over it (before
// the page's lines grow into bands), the 3D scene goes, the editor shows
// underneath, and the white fades out to reveal it. A file that isn't ready
// yet keeps the white screen up with "Opening…"; the white never makes a ready
// file wait longer than its own fade. Reduced motion: none of this.

/** Timing of the white layer, in ms (the CSS transitions use the same numbers). */
export const WHITE = {
  /**
   * The growing top page spans this much of the window's height: the white starts.
   * Chosen from recorded frames: the white starts ~2 frames after it's added and
   * is fully opaque when the page spans about 0.9–1.0 of the height, while its
   * lines are still thin lines (they become bands from about 1.5).
   */
  coverAt: 0.3,
  /** White in, ease-in. */
  inMs: 120,
  /** White out, ease-out, revealing the editor. */
  outMs: 150,
  /** If the fade-in's end is never reported, go on this long after it should have ended. */
  backstopMs: 250,
} as const;

/**
 * idle: the landing screen. absorbing: sheets travel and the top page grows.
 * whitening: the white fades in. white: fully white (the scene is gone; the
 * editor shows underneath once the file is ready). revealing: the white fades
 * out over the editor. Then idle again (the white layer is removed).
 */
export type OpeningPhase = 'idle' | 'absorbing' | 'whitening' | 'white' | 'revealing';

export interface OpeningHooks {
  /** Fully white: hide the 3D scene and dispose of it. */
  onWhite?: () => void;
  /** The file is ready and the window is white: the landing screen goes, the editor is under the white. */
  onReveal?: () => void;
}

type Timer = (fn: () => void, ms: number) => unknown;

export class OpeningSequence {
  phase = $state<OpeningPhase>('idle');
  /** The file is open (the editor is mounted, still under the white). */
  ready = $state(false);
  private timer: unknown = null;

  private hooks: OpeningHooks = {};

  constructor(
    private later: Timer = (fn, ms) => setTimeout(fn, ms),
    private cancelLater: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  ) {}

  /** The white layer is in the page (from the start of its fade-in to the end of its fade-out). */
  get overlay() {
    return this.phase === 'whitening' || this.phase === 'white' || this.phase === 'revealing';
  }
  /** Fully white: the opacity the white layer is heading to. */
  get opaque() {
    return this.phase === 'whitening' || this.phase === 'white';
  }
  /** White and the file still loading: show "Opening…" on it. */
  get waiting() {
    return this.phase === 'white' && !this.ready;
  }
  /** Files were chosen or dropped: the absorb plays. */
  start(hooks: OpeningHooks = {}) {
    this.clear();
    this.hooks = hooks;
    this.ready = false;
    this.phase = 'absorbing';
  }

  /** The top page covers enough of the window: the white fades in. */
  covered() {
    if (this.phase !== 'absorbing') return;
    this.phase = 'whitening';
    // The white layer says when its fade-in has ended (whiteShown); this is only a
    // backstop for when that never comes (animations held back in a background tab).
    this.timer = this.later(() => this.whiteShown(), WHITE.inMs + WHITE.backstopMs);
  }

  /** The white layer's fade-in has ended: the window is fully white. */
  whiteShown() {
    if (this.phase !== 'whitening') return;
    this.clear();
    this.phase = 'white';
    this.hooks.onWhite?.();
    if (this.ready) this.reveal();
  }

  /** The file is open. */
  fileReady() {
    this.ready = true;
    if (this.phase === 'white') this.reveal();
  }

  /** Opening failed or was cancelled: back to the landing screen at once. */
  cancel() {
    this.clear();
    this.phase = 'idle';
    this.ready = false;
  }

  private reveal() {
    this.hooks.onReveal?.();
    this.phase = 'revealing';
    this.timer = this.later(() => {
      this.timer = null;
      this.phase = 'idle';
    }, WHITE.outMs);
  }

  private clear() {
    if (this.timer !== null) this.cancelLater(this.timer);
    this.timer = null;
  }
}

/** The one sequence: started by the landing screen, drawn by App (the white layer outlives the landing screen). */
export const openingSequence = new OpeningSequence();
