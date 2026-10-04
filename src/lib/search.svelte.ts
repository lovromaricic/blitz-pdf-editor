// Full-text search across the open document, in page order.
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { EditorDocument, PageRef } from './document.svelte';

/** A quadrilateral in PDF user space: four [x, y] corners. */
export type Quad = [number, number][];

export interface SearchMatch {
  pageId: string;
  quads: Quad[];
}

interface PageText {
  /** Lowercased, whitespace-collapsed text. */
  text: string;
  /** For each char of `text`: [item index, char offset in item.str]. */
  map: [number, number][];
  items: TextItem[];
}

export class Search {
  query = $state('');
  matches = $state<SearchMatch[]>([]);
  active = $state(-1);
  running = $state(false);
  progress = $state(0);

  private cache = new Map<string, PageText>();
  private token = 0;

  constructor(private doc: EditorDocument) {}

  get activeMatch(): SearchMatch | undefined {
    return this.matches[this.active];
  }

  clear() {
    this.token++;
    this.query = '';
    this.matches = [];
    this.active = -1;
    this.running = false;
  }

  /**
   * Search for `query`. Calls `onFirst` once with the first match at or after
   * `fromIndex` (wrapping around), so the view can jump to it.
   */
  async run(query: string, fromIndex: number, onFirst: (m: SearchMatch) => void) {
    const token = ++this.token;
    this.query = query;
    this.matches = [];
    this.active = -1;
    const needle = normalize(query);
    if (!needle) {
      this.running = false;
      return;
    }

    this.running = true;
    this.progress = 0;
    const pages = this.doc.pages.slice();
    const found: SearchMatch[] = [];
    let jumped = false;

    for (let i = 0; i < pages.length; i++) {
      const pageText = await this.textFor(pages[i]);
      if (token !== this.token) return;
      const pageMatches = findInPage(pageText, needle).map((quads) => ({ pageId: pages[i].id, quads }));
      if (pageMatches.length) {
        found.push(...pageMatches);
        this.matches = found.slice();
      }
      this.progress = (i + 1) / pages.length;
      if (!jumped && pageMatches.length && i >= fromIndex) {
        jumped = true;
        this.active = found.length - pageMatches.length;
        onFirst(found[this.active]);
      }
    }

    if (!jumped && found.length) {
      this.active = 0;
      onFirst(found[0]);
    }
    this.running = false;
  }

  step(delta: 1 | -1): SearchMatch | undefined {
    if (this.matches.length === 0) return undefined;
    this.active = (this.active + delta + this.matches.length) % this.matches.length;
    return this.matches[this.active];
  }

  private async textFor(page: PageRef): Promise<PageText> {
    const key = `${page.sourceId}:${page.sourceIndex}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pdfPage = await this.doc.source(page).pdf.getPage(page.sourceIndex + 1);
    const content = await pdfPage.getTextContent();
    const items = content.items.filter((it): it is TextItem => 'str' in it);
    const built = buildPageText(items);
    this.cache.set(key, built);
    return built;
  }
}

export function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function buildPageText(items: TextItem[]): PageText {
  let text = '';
  const map: [number, number][] = [];
  const push = (ch: string, item: number, offset: number) => {
    // Collapse runs of whitespace so "foo  bar" and line breaks match "foo bar".
    if (/\s/.test(ch)) {
      if (text.endsWith(' ') || text === '') return;
      ch = ' ';
    }
    for (const c of ch.toLowerCase()) {
      text += c;
      map.push([item, offset]);
    }
  };
  items.forEach((item, i) => {
    for (let o = 0; o < item.str.length; o++) push(item.str[o], i, o);
    if (item.hasEOL) push(' ', i, item.str.length);
  });
  return { text, map, items };
}

function findInPage(page: PageText, needle: string): Quad[][] {
  const results: Quad[][] = [];
  let from = 0;
  for (;;) {
    const at = page.text.indexOf(needle, from);
    if (at < 0) break;
    results.push(quadsFor(page, at, at + needle.length));
    from = at + needle.length;
  }
  return results;
}

/** Turn a character range into one box per text item it touches. */
function quadsFor(page: PageText, start: number, end: number): Quad[] {
  const ranges = new Map<number, [number, number]>();
  for (let k = start; k < end; k++) {
    const [item, offset] = page.map[k];
    const r = ranges.get(item);
    if (r) {
      r[0] = Math.min(r[0], offset);
      r[1] = Math.max(r[1], offset + 1);
    } else {
      ranges.set(item, [offset, offset + 1]);
    }
  }
  const quads: Quad[] = [];
  for (const [i, [s, e]] of ranges) {
    const item = page.items[i];
    const len = item.str.length;
    if (len === 0) continue;
    const [a, b, , , x, y] = item.transform;
    const norm = Math.hypot(a, b) || 1;
    const ux = a / norm;
    const uy = b / norm;
    // Perpendicular ("up") direction.
    const vx = -uy;
    const vy = ux;
    const x0 = (item.width * Math.min(s, len)) / len;
    const x1 = (item.width * Math.min(e, len)) / len;
    const h = item.height || norm;
    const y0 = -0.2 * h;
    const y1 = 0.85 * h;
    const pt = (dx: number, dy: number): [number, number] => [x + ux * dx + vx * dy, y + uy * dx + vy * dy];
    quads.push([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]);
  }
  return quads;
}
