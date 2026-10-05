import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { LINK_COLOR, type Rgb, type TextAnnotation, type TextLink, type TextParagraph, type TextRun } from '../src/lib/annotations';
import { faceKey, fontMetrics } from '../src/lib/font-catalog';
import { parseFontMetrics, textWidth, type FontMetrics } from '../src/lib/font-metrics';
import { isSafeHref, LINK_ERRORS, linkTarget, normalizeUrl, trailingUrl } from '../src/lib/links';
import { linkAreas, type RichEnv } from '../src/lib/text-rich-layout';
import { dropPageLinks, layoutTextAnnotation, linkStyle, plainText, unlinkStyle } from '../src/lib/text-rich';
import { assemble, type PagePlan } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';

// --- Addresses -------------------------------------------------------------------------------

describe('normalizing link addresses', () => {
  const ok = (input: string) => {
    const r = normalizeUrl(input);
    if (!r.ok) throw new Error(`${input}: ${r.error}`);
    return r.href;
  };
  const error = (input: string) => {
    const r = normalizeUrl(input);
    if (r.ok) throw new Error(`${input} was accepted as ${r.href}`);
    return r.error;
  };

  it('trims, and adds https:// to a bare domain and mailto: to a bare email address', () => {
    expect(ok('  example.com  ')).toBe('https://example.com/');
    expect(ok('example.com/path?q=1#top')).toBe('https://example.com/path?q=1#top');
    expect(ok('www.example.org')).toBe('https://www.example.org/');
    expect(ok('example.com:8080/x')).toBe('https://example.com:8080/x');
    expect(ok('localhost:3000')).toBe('https://localhost:3000/');
    expect(ok('192.168.1.10')).toBe('https://192.168.1.10/');
    expect(ok('name@example.com')).toBe('mailto:name@example.com');
  });

  it('keeps allowed schemes in any case, with leading spaces', () => {
    expect(ok('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
    expect(ok('  Http://example.com')).toBe('http://example.com/');
    expect(ok('MAILTO:a@b.co?subject=Hi')).toBe('mailto:a@b.co?subject=Hi');
    expect(ok('tel:+385 1 234-5678')).toBe('tel:+38512345678');
  });

  it('refuses javascript:, data:, file: and every other scheme, however written', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  JAVASCRIPT:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      ' \u0000javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'DATA:text/html,x',
      'file:///etc/passwd',
      'vbscript:msgbox',
      'ftp://example.com',
      'blob:https://example.com/x',
      'chrome://settings',
    ]) {
      expect([LINK_ERRORS.scheme, LINK_ERRORS.invalid]).toContain(error(bad));
    }
    expect(error('javascript:alert(1)')).toBe(LINK_ERRORS.scheme);
  });

  it('refuses what is not an address', () => {
    expect(error('')).toBe(LINK_ERRORS.empty);
    expect(error('   ')).toBe(LINK_ERRORS.empty);
    expect(error('hello')).toBe(LINK_ERRORS.invalid);
    expect(error('1.5')).toBe(LINK_ERRORS.invalid); // the parser would make it 1.0.0.5
    expect(error('example .com')).toBe(LINK_ERRORS.spaces);
    expect(error('https://user:secret@example.com')).toBe(LINK_ERRORS.invalid); // no passwords saved in links
    expect(error('mailto:not-an-address')).toBe(LINK_ERRORS.invalid);
    expect(error('tel:call me')).toBe(LINK_ERRORS.invalid);
    expect(error(`example.com/${'a'.repeat(2100)}`)).toBe(LINK_ERRORS.long);
  });

  it('shows international domain names in punycode (the real domain), and is plain ASCII', () => {
    expect(ok('bücher.de')).toBe('https://xn--bcher-kva.de/');
    expect(ok('https://pаypal.com')).toBe('https://xn--pypal-4ve.com/'); // Cyrillic "а"
    expect(ok('https://bücher.de/ü?q=ž')).toBe('https://xn--bcher-kva.de/%C3%BC?q=%C5%BE');
  });

  it('opens only allowed, already complete addresses', () => {
    expect(isSafeHref('https://example.com/')).toBe(true);
    expect(isSafeHref('mailto:a@b.co')).toBe(true);
    expect(isSafeHref('example.com')).toBe(false); // no guessing when opening
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref(' JavaScript:alert(1)')).toBe(false);
  });

  it('describes a link for the popover', () => {
    expect(linkTarget({ kind: 'url', href: 'mailto:a@b.co' }, () => null)).toBe('a@b.co');
    expect(linkTarget({ kind: 'page', pageId: 'p2' }, (id) => (id === 'p2' ? 2 : null))).toBe('Page 2');
    expect(linkTarget({ kind: 'page', pageId: 'gone' }, () => null)).toBe('A deleted page');
  });
});

describe('finding an address just typed', () => {
  it('finds it at the end, without trailing punctuation or brackets around it', () => {
    expect(trailingUrl('see example.com')).toEqual({ from: 4, to: 15, href: 'https://example.com/' });
    expect(trailingUrl('see example.com.')).toMatchObject({ from: 4, to: 15 });
    expect(trailingUrl('(www.example.org),')).toMatchObject({ from: 1, to: 16, href: 'https://www.example.org/' });
    expect(trailingUrl('https://en.wikipedia.org/wiki/Foo_(bar)')?.href).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(trailingUrl('write to a@b.co')?.href).toBe('mailto:a@b.co');
    expect(trailingUrl('HTTP://EXAMPLE.COM')?.href).toBe('http://example.com/');
  });

  it('leaves file names, numbers, abbreviations and refused schemes alone', () => {
    for (const text of ['report.pdf', 'photo.JPG', 'v1.5', '3.14', 'e.g.', 'i.e.', 'javascript:alert(1)', 'data:text/html,x', 'hello', 'see example.com and ']) {
      expect(trailingUrl(text)).toBeNull();
    }
  });
});

// --- Where links are -------------------------------------------------------------------------

const DIRS: Record<string, string> = { '': '400Regular', bold: '700Bold', italic: '400Regular_Italic', 'bold-italic': '700Bold_Italic' };
function fontFile(key: string) {
  const m = /^([a-z0-9-]+?)(?:-(bold-italic|bold|italic))?$/.exec(key)!;
  const dir = `node_modules/@expo-google-fonts/${m[1]}/${DIRS[m[2] ?? '']}`;
  return `${dir}/${readdirSync(dir).find((f) => f.endsWith('.ttf'))}`;
}
const metricsCache = new Map<string, FontMetrics>();
function metrics(run: { font: string; bold?: boolean; italic?: boolean }) {
  const key = faceKey(run.font, run.bold, run.italic);
  if (!metricsCache.has(key)) metricsCache.set(key, parseFontMetrics(new Uint8Array(readFileSync(fontFile(key)))));
  return metricsCache.get(key)!;
}
const env: RichEnv = {
  measure: (run, text) => textWidth(metrics(run), text, run.size),
  vertical: (run) => {
    const [ascent, descent] = fontMetrics(run.font);
    return { ascent, descent };
  },
  decoration: (run) => metrics(run),
};

const BLACK: Rgb = [0, 0, 0];
const WEB: TextLink = { kind: 'url', href: 'https://example.com/' };
const run = (text: string, over: Partial<TextRun> = {}): TextRun => ({ text, font: 'roboto', size: 12, color: BLACK, ...over });
const linked = (text: string, link: TextLink = WEB) => run(text, { link, color: LINK_COLOR, underline: true });
const para = (...runs: TextRun[]): TextParagraph => ({ runs });
function box(paragraphs: TextParagraph[], over: Partial<TextAnnotation> = {}): TextAnnotation {
  return { id: 'b', type: 'text', text: plainText(paragraphs), paragraphs, font: 'roboto', size: 12, color: BLACK, opacity: 1, rotate: 0, rect: [100, 600, 300, 700], ...over };
}

describe('link areas', () => {
  it('one rectangle covering a link on one line, as tall as the line', () => {
    const a = box([para(run('Go to '), linked('the site'), run(' now'))]);
    const layout = layoutTextAnnotation(a, env);
    const areas = linkAreas(layout, env.measure);
    expect(areas).toHaveLength(1);
    const seg = layout.lines[0].segments[1];
    expect(areas[0]).toMatchObject({ link: WEB, x: seg.x, y: layout.lines[0].top, h: layout.lines[0].height });
    expect(areas[0].w).toBeCloseTo(seg.width, 6);
  });

  it('a link broken over lines gets one rectangle per line', () => {
    const a = box([para(run('Start '), linked('a rather long link text that wraps onto the next lines'), run(' end'))], { rect: [100, 600, 220, 700] });
    const layout = layoutTextAnnotation(a, env);
    const areas = linkAreas(layout, env.measure);
    const linesWithLink = layout.lines.filter((l) => l.segments.some((s) => s.run.link));
    expect(linesWithLink.length).toBeGreaterThan(1);
    expect(areas).toHaveLength(linesWithLink.length);
    areas.forEach((r, i) => expect(r.y).toBe(linesWithLink[i].top));
  });

  it('separate links on one line get separate rectangles', () => {
    const other: TextLink = { kind: 'page', pageId: 'p2' };
    const a = box([para(linked('  one'), run(' and '), linked('two', other))], { rect: [100, 600, 400, 700] });
    const layout = layoutTextAnnotation(a, env);
    const areas = linkAreas(layout, env.measure);
    expect(areas.map((r) => r.link)).toEqual([WEB, other]);
    expect(areas[0].x).toBe(layout.lines[0].segments[0].x);
    expect(areas[0].x + areas[0].w).toBeLessThan(areas[1].x);
  });
});

// --- The link look, and links to deleted pages -------------------------------------------------

describe('link look', () => {
  it('a new link is link blue and underlined; removing it restores the text unless it was recoloured', () => {
    const f = { font: 'roboto', size: 12, color: BLACK };
    const l = linkStyle(f, WEB);
    expect(l).toEqual({ ...f, link: WEB, color: LINK_COLOR, underline: true });
    expect(unlinkStyle(l, BLACK)).toEqual(f);
    const recoloured = { ...l, color: [1, 0, 0] as Rgb };
    expect(unlinkStyle(recoloured, BLACK)).toEqual({ ...f, color: [1, 0, 0], underline: true });
  });

  it('links to deleted pages are taken out; others stay', () => {
    const toP2 = { kind: 'page', pageId: 'p2' } as const;
    const toP3 = { kind: 'page', pageId: 'p3' } as const;
    const a = box([para(run('See '), linked('two', toP2), run(' and '), linked('three', toP3), run(' or '), linked('web'))]);
    const { annot, removed } = dropPageLinks(a, (id) => id === 'p2');
    expect(removed).toBe(1);
    expect(annot.paragraphs).toEqual([para(run('See two and '), linked('three', toP3), run(' or '), linked('web'))]);
    expect(dropPageLinks(a, () => false).annot).toBe(a);
  });
});

// --- Saved PDFs ----------------------------------------------------------------------------------

const fonts = createFontProvider(async (key) => new Uint8Array(readFileSync(fontFile(key))));

async function pages(n: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return doc.save();
}

interface SavedLink {
  page: number;
  url?: string;
  dest?: number;
  rect: number[];
  quads: number;
}

/** Links per page as PDF.js reads them, and where each run of text was written (invisible text, user space). */
async function readBack(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const links: SavedLink[] = [];
  const words: { page: number; str: string; x: number; y: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    for (const a of (await page.getAnnotations()) as { subtype: string; url?: string; dest?: unknown[]; rect: number[]; quadPoints?: ArrayLike<number> }[]) {
      if (a.subtype !== 'Link') continue;
      const dest = a.dest ? (await pdf.getPageIndex(a.dest[0] as never)) + 1 : undefined;
      links.push({ page: i, url: a.url, dest, rect: Array.from(a.rect), quads: a.quadPoints ? a.quadPoints.length / 8 : 0 });
    }
    for (const item of (await page.getTextContent()).items as { str: string; transform: number[] }[]) {
      if (item.str.trim()) words.push({ page: i, str: item.str, x: item.transform[4], y: item.transform[5] });
    }
  }
  await pdf.loadingTask.destroy();
  return { links, words };
}

/** Is the text run's start point (its baseline origin) inside the rectangle? */
const inside = (r: number[], p: { x: number; y: number }) => p.x >= r[0] - 0.5 && p.x <= r[2] + 0.5 && p.y >= r[1] - 0.5 && p.y <= r[3] + 0.5;

describe('saving links', () => {
  it('writes a Link annotation per line, over the linked words, with a URI action', async () => {
    const a = box([para(run('Read '), linked('the long manual online', WEB), run(' today'))], { rect: [100, 600, 190, 700] });
    const out = await assemble([{ id: 's', bytes: await pages(1) }], [{ pageId: 'p1', sourceId: 's', index: 0, rotation: 0, annots: [a] }], 'preserve', { fonts });
    const { links, words } = await readBack(out);
    const linkWords = words.filter((w) => /long|manual|online|the/.test(w.str) && !/Read|today/.test(w.str));
    expect(links.length).toBeGreaterThan(1); // wrapped: one per line
    expect(links.every((l) => l.url === 'https://example.com/' && l.quads === 1)).toBe(true);
    for (const w of linkWords) expect(links.some((l) => inside(l.rect, w))).toBe(true);
    // Words outside the link are outside every rectangle.
    for (const w of words.filter((w) => /^(Read|today)/.test(w.str.trim()))) expect(links.some((l) => inside(l.rect, w))).toBe(false);
  });

  it('turns with a box made on a rotated page, and stays put when the page is rotated later', async () => {
    const a = box([para(linked('Rotated link'))], { rotate: 90, rect: [300, 300, 340, 450] });
    for (const rotation of [0, 90, 270]) {
      const out = await assemble([{ id: 's', bytes: await pages(1) }], [{ pageId: 'p1', sourceId: 's', index: 0, rotation, annots: [a] }], 'preserve', { fonts });
      const { links, words } = await readBack(out);
      expect(links).toHaveLength(1);
      const r = links[0].rect;
      // Turned 90°: taller than wide, inside the box, over the text.
      expect(r[3] - r[1]).toBeGreaterThan(r[2] - r[0]);
      expect(r[0]).toBeGreaterThanOrEqual(300 - 0.01);
      expect(r[2]).toBeLessThanOrEqual(340 + 0.01);
      expect(inside(r, words.find((w) => w.str.includes('Rotated'))!)).toBe(true);
    }
  });

  it('page links point at the page itself: they follow reordering, and are left out when the page is not saved', async () => {
    const toThird: TextLink = { kind: 'page', pageId: 'p3' };
    const a = box([para(run('See '), linked('the appendix', toThird))]);
    const src = [{ id: 's', bytes: await pages(3) }];
    const plan = (order: number[], ids = ['p1', 'p2', 'p3']): PagePlan[] =>
      order.map((index, pos) => ({ pageId: ids[index], sourceId: 's', index, rotation: 0, annots: pos === order.indexOf(0) ? [a] : undefined }));

    let { links } = await readBack(await assemble(src, plan([0, 1, 2]), 'preserve', { fonts }));
    expect(links.map((l) => [l.page, l.dest])).toEqual([[1, 3]]);
    // Page 3 moved to the front: the link (still on the box's page, now 2nd) goes to page 1.
    ({ links } = await readBack(await assemble(src, plan([2, 0, 1]), 'preserve', { fonts })));
    expect(links.map((l) => [l.page, l.dest])).toEqual([[2, 1]]);
    // Extracting pages 1-2 only: nowhere to go, so no link (the text stays).
    ({ links } = await readBack(await assemble(src, plan([0, 1]), 'fresh', { fonts })));
    expect(links).toEqual([]);
  });
});
