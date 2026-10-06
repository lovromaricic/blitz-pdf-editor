// Double-clicking a page with the Select tool: what was hit and what happens.
// Our own objects always come first (they handle their own double-click: a
// text box edits, an image crops). Then the PDF's own content: text (edit
// it), an image (select it), a scan (say so), lines and shapes (say they
// can't be edited yet). Pure: the page analysis is passed in.
import type { PageAnalysis } from './pdf/content/edit';
import type { Tool } from './viewer.svelte';

type Point = [number, number];

export type Route =
  | { kind: 'own' }
  | { kind: 'text'; id: string }
  | { kind: 'image'; id: string }
  | { kind: 'scan' }
  | { kind: 'shape' }
  | { kind: 'unreadable' }
  | { kind: 'none' };

/** Is `p` inside the quad (any turn), with `pad` points to spare? */
function inQuad(q: readonly Point[], p: Point, pad = 0) {
  // Edges taken in order: inside when on the same side of all four (a convex quad, either winding).
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const cross = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
    if (Math.abs(cross) <= pad) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

const area = (q: readonly Point[]) => Math.abs(q.reduce((n, p, i) => n + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0) / 2);

/**
 * What a double-click at `p` (page space) means. `own`: it landed on one of
 * our objects. `a`: the page's analysis (null when it isn't known).
 */
export function routeAt(p: Point, own: boolean, a: PageAnalysis | null): Route {
  if (own) return { kind: 'own' };
  if (!a) return { kind: 'none' };
  if (a.status === 'unreadable') return { kind: 'unreadable' };
  // Text first (it's what people point at), the smallest block under the pointer.
  const texts = a.items.filter((i) => i.kind === 'text' && inQuad(i.quad, p, 1));
  if (texts.length) return { kind: 'text', id: texts.sort((x, y) => area(x.quad) - area(y.quad))[0].id };
  // Then whatever is drawn on top: an image, or a line or shape (a background covering the page is the empty page).
  const pageArea = (a.page[2] - a.page[0]) * (a.page[3] - a.page[1]);
  const images = a.items.filter((i) => i.kind === 'image' && inQuad(i.quad, p)).map((i) => ({ seq: i.seq, route: a.scan && i.coversPage ? ({ kind: 'scan' } as const) : ({ kind: 'image', id: i.id } as const) }));
  const shapes = a.shapes
    .filter((s) => (s.box[2] - s.box[0]) * (s.box[3] - s.box[1]) < 0.9 * pageArea)
    .filter((s) => p[0] >= s.box[0] - 2 && p[0] <= s.box[2] + 2 && p[1] >= s.box[1] - 2 && p[1] <= s.box[3] + 2)
    .map((s) => ({ seq: s.seq, route: { kind: 'shape' } as const }));
  const top = [...images, ...shapes].sort((x, y) => y.seq - x.seq)[0];
  return top ? top.route : { kind: 'none' };
}

/**
 * Should a mouse-down stop the browser's word selection? Only the second press
 * of a double-click, with the Select tool, on the PDF's own text (not on our
 * objects). A drag (first press) and a triple-click (third) work as always.
 */
export function suppressWordSelection(o: { detail: number; button: number; tool: Tool; onOriginalText: boolean; onOwnObject: boolean }) {
  return o.detail === 2 && o.button === 0 && o.tool === 'select' && o.onOriginalText && !o.onOwnObject;
}

/**
 * Edit content entered by a double-click goes back to the tool before it
 * (Escape, or a click on an empty spot); chosen from the toolbar, it stays.
 */
export class ContentModeReturn {
  private back: Tool | null = null;

  /** Edit content was entered: `from` the tool that was on, by a double-click or not. */
  enter(from: Tool, byDoubleClick: boolean) {
    this.back = byDoubleClick && from !== 'content' ? from : null;
  }

  /** The user picked a tool: nothing to go back to. */
  reset() {
    this.back = null;
  }

  /** Where Escape or a click on an empty spot goes (null: stay). Forgets it. */
  leave(): Tool | null {
    const t = this.back;
    this.back = null;
    return t;
  }

  get returns() {
    return this.back !== null;
  }
}
