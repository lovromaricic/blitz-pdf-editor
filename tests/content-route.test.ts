import { describe, expect, it } from 'vitest';
import { ContentModeReturn, routeAt, suppressWordSelection } from '../src/lib/content-route';
import type { PageAnalysis } from '../src/lib/pdf/content/edit';

const quad = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][];
const page: PageAnalysis = {
  status: 'ok',
  scan: false,
  page: [0, 0, 600, 800],
  items: [
    { id: 't1', kind: 'text', quad: quad(50, 700, 300, 720) as never, order: 0, seq: 5 },
    { id: 'i1', kind: 'image', quad: quad(50, 400, 300, 600) as never, order: 1, seq: 2, width: 100, height: 80 },
  ],
  shapes: [
    { box: [0, 0, 600, 800], seq: 0 }, // a page background
    { box: [100, 450, 200, 452], seq: 3 }, // a line drawn over the image
    { box: [400, 100, 500, 102], seq: 4 }, // a line on its own
  ],
};

describe('double-click routing', () => {
  it('our own objects come first, whatever is under them', () => {
    expect(routeAt([100, 710], true, page)).toEqual({ kind: 'own' });
  });
  it('original text, an image, a line on top of it, a line, an empty spot', () => {
    expect(routeAt([100, 710], false, page)).toEqual({ kind: 'text', id: 't1' });
    expect(routeAt([250, 500], false, page)).toEqual({ kind: 'image', id: 'i1' });
    expect(routeAt([150, 451], false, page)).toEqual({ kind: 'shape' });
    expect(routeAt([450, 101], false, page)).toEqual({ kind: 'shape' });
    // The background covering the page is the empty page.
    expect(routeAt([500, 300], false, page)).toEqual({ kind: 'none' });
  });
  it('a scan says so; an unreadable page says so; no analysis: nothing', () => {
    const scan: PageAnalysis = { ...page, scan: true, items: [{ id: 'i', kind: 'image', quad: quad(0, 0, 600, 800) as never, order: 0, seq: 1, coversPage: true }], shapes: [] };
    expect(routeAt([300, 300], false, scan)).toEqual({ kind: 'scan' });
    expect(routeAt([300, 300], false, { ...page, status: 'unreadable' })).toEqual({ kind: 'unreadable' });
    expect(routeAt([300, 300], false, null)).toEqual({ kind: 'none' });
  });
  it('turned text is hit inside its turned box', () => {
    const turned: PageAnalysis = { ...page, items: [{ id: 't', kind: 'text', quad: [[100, 100], [200, 200], [180, 220], [80, 120]] as never, order: 0, seq: 1 }], shapes: [] };
    expect(routeAt([140, 160], false, turned)).toEqual({ kind: 'text', id: 't' });
    expect(routeAt([190, 120], false, turned)).toEqual({ kind: 'none' });
  });
});

describe('word selection on a double-click', () => {
  const base = { detail: 2, button: 0, tool: 'select' as const, onOriginalText: true, onOwnObject: false };
  it('only the second press, Select tool, on original text, not on our objects', () => {
    expect(suppressWordSelection(base)).toBe(true);
    expect(suppressWordSelection({ ...base, detail: 1 })).toBe(false); // drag-select works
    expect(suppressWordSelection({ ...base, detail: 3 })).toBe(false); // triple-click works
    expect(suppressWordSelection({ ...base, tool: 'text' })).toBe(false);
    expect(suppressWordSelection({ ...base, onOriginalText: false })).toBe(false);
    expect(suppressWordSelection({ ...base, onOwnObject: true })).toBe(false);
    expect(suppressWordSelection({ ...base, button: 2 })).toBe(false);
  });
});

describe('returning from Edit content', () => {
  it('entered by double-click: back to the tool before; from the toolbar: stays', () => {
    const r = new ContentModeReturn();
    r.enter('select', true);
    expect(r.returns).toBe(true);
    expect(r.leave()).toBe('select');
    expect(r.leave()).toBeNull();
    r.enter('select', false);
    expect(r.leave()).toBeNull();
    r.enter('select', true);
    r.reset();
    expect(r.leave()).toBeNull();
    // Already in Edit content: a double-click there doesn't make it return anywhere.
    r.enter('content', true);
    expect(r.leave()).toBeNull();
  });
});
