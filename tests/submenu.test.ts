import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inTriangle, placeSubmenu, safeTriangle, SubmenuIntent, type Box, type Hover } from '../src/lib/submenu';

describe('safe triangle', () => {
  // Parent item on the left, submenu from x = 200, y 100..300; pointer last seen at (150, 120).
  const sub: Box = { left: 200, top: 100, right: 400, bottom: 300 };
  const tri = safeTriangle([150, 120], sub, 'right');

  it('runs from the pointer to the near corners of the submenu', () => {
    expect(tri).toEqual([[150, 120], [200, 100], [200, 300]]);
  });

  it('contains points on the way to the submenu', () => {
    expect(inTriangle([175, 150], ...tri)).toBe(true);
    expect(inTriangle([195, 270], ...tri)).toBe(true);
  });

  it('excludes points going elsewhere', () => {
    expect(inTriangle([140, 150], ...tri)).toBe(false); // back to the left
    expect(inTriangle([170, 60], ...tri)).toBe(false); // up and away
    expect(inTriangle([210, 150], ...tri)).toBe(false); // past the near edge (that's the submenu itself)
  });

  it('counts the edges and corners as inside', () => {
    expect(inTriangle([150, 120], ...tri)).toBe(true);
    expect(inTriangle([200, 200], ...tri)).toBe(true);
    expect(inTriangle([175, 110], ...tri)).toBe(true); // on the upper edge
  });

  it('has no inside when the pointer is level with the near edge (degenerate)', () => {
    const flat = safeTriangle([200, 150], sub, 'right');
    expect(inTriangle([200, 150], ...flat)).toBe(false);
  });

  it('mirrors for a submenu that opens on the left', () => {
    const left = safeTriangle([250, 120], { left: 0, top: 100, right: 200, bottom: 300 }, 'left');
    expect(left[1]).toEqual([200, 100]);
    expect(inTriangle([225, 150], ...left)).toBe(true);
    expect(inTriangle([260, 150], ...left)).toBe(false);
  });
});

describe('placing a submenu inside the window', () => {
  const parent: Box = { left: 300, top: 200, right: 560, bottom: 232 };

  it('opens on the right when there is room', () => {
    expect(placeSubmenu(parent, 264, 120, 1200, 800, 4)).toEqual({ side: 'right', shiftUp: 0 });
  });

  it('opens on the left when the right side is too narrow', () => {
    expect(placeSubmenu(parent, 264, 120, 700, 800, 4).side).toBe('left');
  });

  it('shifts up so the bottom stays inside, never above the top', () => {
    expect(placeSubmenu(parent, 264, 120, 1200, 250, 4).shiftUp).toBe(70);
    expect(placeSubmenu(parent, 264, 900, 1200, 250, 4).shiftUp).toBe(200);
  });
});

describe('submenu hover intent', () => {
  let t = 0;
  let intent: SubmenuIntent;
  const changes: (string | null)[] = [];
  const parent: Hover = { kind: 'parent', id: 'Export as' };
  const other: Hover = { kind: 'item' };

  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    changes.length = 0;
    intent = new SubmenuIntent((id) => changes.push(id), { now: () => t });
  });
  afterEach(() => {
    intent.dispose();
    vi.useRealTimers();
  });

  /** Move at `ms` later. */
  const move = (ms: number, p: [number, number], h: Hover) => {
    t += ms;
    vi.advanceTimersByTime(ms);
    intent.pointer(p, h);
  };
  const wait = (ms: number) => {
    t += ms;
    vi.advanceTimersByTime(ms);
  };

  function openExport() {
    intent.pointer([150, 120], parent);
    intent.setSubmenu({ left: 200, top: 100, right: 400, bottom: 300 }, 'right');
  }

  it('opens on hover right away, and closes 250 ms after the pointer moves on', () => {
    openExport();
    expect(intent.open).toBe('Export as');
    move(10, [150, 160], other); // straight down onto another item: not toward the submenu
    wait(240);
    expect(intent.open).toBe('Export as');
    wait(20);
    expect(intent.open).toBe(null);
  });

  it('cancels the close when the pointer comes back', () => {
    openExport();
    move(10, [150, 160], other);
    wait(200);
    move(10, [150, 125], parent);
    wait(500);
    expect(intent.open).toBe('Export as');
  });

  it('ignores other items while heading for the submenu through the triangle', () => {
    openExport();
    // Diagonally down-right across "Print…" toward the submenu, a step every 16 ms.
    for (const [x, y] of [[160, 140], [170, 160], [180, 180], [190, 200]] as [number, number][]) move(16, [x, y], other);
    move(16, [205, 210], { kind: 'submenu' });
    wait(1000);
    expect(intent.open).toBe('Export as');
    expect(changes).toEqual(['Export as']);
  });

  it('behaves normally again when the pointer rests in the triangle for over 100 ms', () => {
    openExport();
    move(16, [170, 160], other);
    wait(100 + 250 + 10);
    expect(intent.open).toBe(null);
  });

  it('switches to another parent only after the delay', () => {
    openExport();
    move(10, [150, 60], { kind: 'parent', id: 'Other' }); // up, out of the triangle
    expect(intent.open).toBe('Export as');
    wait(260);
    expect(intent.open).toBe('Other');
  });

  it('closes when the pointer leaves the menu entirely', () => {
    openExport();
    move(10, [600, 600], null);
    wait(260);
    expect(intent.open).toBe(null);
  });

  it('keeps a clicked (or keyboard-opened) submenu open until closed on purpose', () => {
    intent.openNow('Export as');
    move(10, [150, 160], other);
    wait(1000);
    expect(intent.open).toBe('Export as');
    intent.close();
    expect(intent.open).toBe(null);
  });
});
