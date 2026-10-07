// The end of the landing screen's opening transition: white over the growing
// page, then the editor revealed from white. Driven by hand (fake timers).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpeningSequence, WHITE } from '../src/lib/landing/opening-sequence.svelte';

let events: string[];
let seq: OpeningSequence;
const hooks = () => ({ onWhite: () => events.push('scene away'), onReveal: () => events.push(`editor shown (${seq.phase}, opaque ${seq.opaque})`) });

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  seq = new OpeningSequence();
});
afterEach(() => vi.useRealTimers());

describe('the white before the editor', () => {
  it('a ready file: the white is fully opaque before the editor shows, then fades out and goes', () => {
    seq.start(hooks());
    expect([seq.phase, seq.overlay]).toEqual(['absorbing', false]);
    seq.fileReady(); // ready early: nothing shows yet
    expect(events).toEqual([]);
    seq.covered();
    expect([seq.phase, seq.overlay, seq.opaque]).toEqual(['whitening', true, true]);
    expect(events).toEqual([]);
    seq.whiteShown(); // the fade-in ended
    expect(events).toEqual(['scene away', 'editor shown (white, opaque true)']);
    expect([seq.phase, seq.opaque, seq.overlay]).toEqual(['revealing', false, true]);
    vi.advanceTimersByTime(WHITE.outMs);
    expect([seq.phase, seq.overlay]).toEqual(['idle', false]);
  });

  it('a slow file keeps the white screen up with "Opening…" until it is ready', () => {
    seq.start(hooks());
    seq.covered();
    seq.whiteShown();
    expect(events).toEqual(['scene away']);
    expect([seq.phase, seq.waiting]).toEqual(['white', true]);
    vi.advanceTimersByTime(10_000);
    expect([seq.phase, seq.waiting]).toEqual(['white', true]);
    seq.fileReady();
    expect(events).toEqual(['scene away', 'editor shown (white, opaque true)']);
    expect([seq.phase, seq.waiting]).toEqual(['revealing', false]);
  });

  it('a ready file waits for nothing but the white: in, then straight out', () => {
    seq.start(hooks());
    seq.fileReady();
    seq.covered();
    vi.advanceTimersByTime(WHITE.inMs);
    seq.whiteShown();
    expect(seq.phase).toBe('revealing');
    vi.advanceTimersByTime(WHITE.outMs - 1);
    expect(seq.phase).toBe('revealing');
    vi.advanceTimersByTime(1);
    expect(seq.phase).toBe('idle');
  });

  it('if the fade-in never reports its end (a background tab), it goes on shortly after', () => {
    seq.start(hooks());
    seq.fileReady();
    seq.covered();
    vi.advanceTimersByTime(WHITE.inMs + WHITE.backstopMs - 1);
    expect(seq.phase).toBe('whitening');
    vi.advanceTimersByTime(1);
    expect(seq.phase).toBe('revealing');
    // A late report changes nothing.
    seq.whiteShown();
    expect(events).toEqual(['scene away', 'editor shown (white, opaque true)']);
  });

  it('opening failed: back to the landing screen at once, with no white left', () => {
    seq.start(hooks());
    seq.covered();
    seq.whiteShown();
    seq.cancel();
    expect([seq.phase, seq.overlay, seq.waiting]).toEqual(['idle', false, false]);
    seq.covered(); // a late signal from the scene
    expect(seq.phase).toBe('idle');
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(['scene away']);
  });
});
