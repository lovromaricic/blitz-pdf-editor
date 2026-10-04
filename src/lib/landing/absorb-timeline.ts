// The "absorb" transition after files are chosen or dropped, as a timeline:
// sheets travel to the center (staggered), land in one stack, then the top
// sheet grows to fill the window while the others fade. Pure: the scene reads
// progress values from it, tests drive it directly.

export const ABSORB = {
  /** Sheet k starts after (k / count) * stagger seconds. */
  stagger: 0.2,
  /** Each sheet's trip to the stack. */
  travel: 0.5,
  /** The top sheet starts growing… */
  heroAt: 0.72,
  /** …and fills the window after this long. */
  heroDuration: 0.4,
  /** The other sheets fade out from heroAt over this long. */
  fadeDuration: 0.2,
  /** The page fills the window: the transition is done. */
  doneAt: 1.2,
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smoothstep = (x: number) => x * x * (3 - 2 * x);

export class AbsorbTimeline {
  /** Seconds since the absorb started. */
  t = 0;
  finished = false;

  constructor(private onDone: () => void) {}

  /** Advance by dt seconds. Calls onDone once, the first time the end is reached. */
  advance(dt: number) {
    if (dt > 0) this.t += dt;
    if (!this.finished && this.t >= ABSORB.doneAt) {
      this.finished = true;
      this.onDone();
    }
  }

  /** Eased travel progress (0..1) of sheet k of n. */
  sheet(k: number, n: number) {
    const delay = (k / Math.max(1, n)) * ABSORB.stagger;
    return smoothstep(clamp01((this.t - delay) / ABSORB.travel));
  }

  /** Growth of the top sheet (0..1, linear; the scene eases it). */
  get hero() {
    return clamp01((this.t - ABSORB.heroAt) / ABSORB.heroDuration);
  }

  /** Fade of the other sheets (0 = visible, 1 = gone). */
  get fade() {
    return clamp01((this.t - ABSORB.heroAt) / ABSORB.fadeDuration);
  }
}
