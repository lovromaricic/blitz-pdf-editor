// Submenu hover intent, shared by every menu with submenus. Two rules keep a
// submenu open while the pointer travels to it:
// - Close delay: leaving the parent item or the submenu only closes it (or
//   switches to another parent's submenu) after `closeDelay`, cancelled by coming back.
// - Safe triangle: while the pointer heads from the parent item toward the
//   submenu (inside the triangle between its last position on the parent and
//   the submenu's near corners), other items' hover is ignored, until it
//   leaves the triangle or rests for `restDelay`.
// No DOM here: the menu reports pointer positions and what's under them.

export type Pt = [number, number];
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Is `p` inside triangle a-b-c (edges included)? */
export function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const cross = (o: Pt, u: Pt, v: Pt) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  // Degenerate (all points on a line): nothing is inside.
  if (cross(a, b, c) === 0) return false;
  return !(neg && pos);
}

/** The triangle from `apex` to the submenu's near edge (its left edge when it opens on the right). */
export function safeTriangle(apex: Pt, sub: Box, side: 'right' | 'left'): [Pt, Pt, Pt] {
  const x = side === 'right' ? sub.left : sub.right;
  return [apex, [x, sub.top], [x, sub.bottom]];
}

/** What the pointer is over, inside one menu. */
export type Hover = { kind: 'parent'; id: string } | { kind: 'submenu' } | { kind: 'item' } | null;

export interface SubmenuOptions {
  closeDelay?: number;
  restDelay?: number;
  now?: () => number;
}

export class SubmenuIntent {
  open: string | null = null;
  /** Opened by click or keyboard: stays open until closed on purpose. */
  pinned = false;
  private apex: Pt | null = null;
  private sub: { box: Box; side: 'right' | 'left' } | null = null;
  private hover: Hover = null;
  private point: Pt | null = null;
  private lastMove = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly closeDelay: number;
  private readonly restDelay: number;
  private readonly now: () => number;

  constructor(
    private onChange: (open: string | null) => void,
    { closeDelay = 250, restDelay = 100, now = () => performance.now() }: SubmenuOptions = {},
  ) {
    this.closeDelay = closeDelay;
    this.restDelay = restDelay;
    this.now = now;
  }

  /** Where the open submenu is on screen (after it's placed). */
  setSubmenu(box: Box | null, side: 'right' | 'left' = 'right') {
    this.sub = box ? { box, side } : null;
  }

  /** The pointer moved (or entered/left something) at `p`, over `hover`. Mouse and pen only. */
  pointer(p: Pt | null, hover: Hover) {
    this.point = p;
    this.hover = hover;
    this.lastMove = this.now();
    this.decide();
  }

  /** Open now (click, tap, keyboard). */
  openNow(id: string, pinned = true) {
    this.cancel();
    this.pinned = pinned;
    this.apex = null;
    this.set(id);
  }

  close() {
    this.cancel();
    this.pinned = false;
    this.apex = null;
    this.set(null);
  }

  dispose() {
    this.cancel();
  }

  /** Heading for the open submenu: inside the safe triangle and still moving. */
  aiming(): boolean {
    if (!this.open || !this.apex || !this.sub || !this.point) return false;
    if (this.now() - this.lastMove > this.restDelay) return false;
    return inTriangle(this.point, ...safeTriangle(this.apex, this.sub.box, this.sub.side));
  }

  private decide() {
    const h = this.hover;
    if (!this.open) {
      clearTimeout(this.closeTimer);
      if (h?.kind === 'parent') this.set(h.id);
      if (h?.kind === 'parent' && this.point) this.apex = this.point;
      return;
    }
    // On the open parent or in its submenu: stay.
    if ((h?.kind === 'parent' && h.id === this.open) || h?.kind === 'submenu') {
      if (h.kind === 'parent' && this.point) this.apex = this.point;
      this.cancel();
      return;
    }
    // Opened on purpose: only another parent item (after the same delay) replaces it.
    if (this.pinned && h?.kind !== 'parent') return;
    clearTimeout(this.restTimer);
    if (this.aiming()) {
      // Ignore what's passed over; if the pointer rests here, look again.
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
      this.restTimer = setTimeout(() => this.decide(), this.restDelay + 1);
      return;
    }
    // Moved on: after the delay, close (or switch to the parent now under the pointer).
    this.closeTimer ??= setTimeout(() => {
      this.closeTimer = undefined;
      const now = this.hover;
      if ((now?.kind === 'parent' && now.id === this.open) || now?.kind === 'submenu') return;
      if (this.pinned && now?.kind !== 'parent') return;
      this.apex = now?.kind === 'parent' ? this.point : null;
      this.set(now?.kind === 'parent' ? now.id : null);
    }, this.closeDelay);
  }

  private cancel() {
    clearTimeout(this.closeTimer);
    clearTimeout(this.restTimer);
    this.closeTimer = undefined;
    this.restTimer = undefined;
  }

  private set(id: string | null) {
    if (id === this.open) return;
    this.open = id;
    if (!id) {
      this.pinned = false;
      this.sub = null;
    }
    this.onChange(id);
  }
}

/**
 * Where to put a submenu of size `w` × `h` next to a parent item `parent`
 * inside a `vw` × `vh` window: on the right if it fits, else on the left, and
 * shifted up so its bottom stays inside. Returns the side and the upward shift.
 */
export function placeSubmenu(parent: Box, w: number, h: number, vw: number, vh: number, gap = 0): { side: 'right' | 'left'; shiftUp: number } {
  const side = parent.right + gap + w <= vw || parent.left - gap - w < 0 ? 'right' : 'left';
  const shiftUp = Math.max(0, Math.min(parent.top, parent.top + h - vh));
  return { side, shiftUp };
}
