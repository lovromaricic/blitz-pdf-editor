import { describe, expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { buildPageText, normalize } from '../src/lib/search.svelte';

const item = (str: string, hasEOL = false): TextItem => ({
  str,
  hasEOL,
  dir: 'ltr',
  width: str.length * 6,
  height: 12,
  transform: [12, 0, 0, 12, 0, 0],
  fontName: 'F1',
});

describe('normalize', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalize('  Hello \n  World ')).toBe('hello world');
  });
});

describe('buildPageText', () => {
  it('joins items, treating line ends as spaces', () => {
    const t = buildPageText([item('Invoice', true), item('Number'), item(' 42')]);
    expect(t.text).toBe('invoice number 42');
  });

  it('collapses repeated whitespace and maps every char back to its item', () => {
    const t = buildPageText([item('a  b', true), item('  c')]);
    expect(t.text).toBe('a b c');
    expect(t.map).toHaveLength(t.text.length);
    expect(t.map[0]).toEqual([0, 0]); // 'a'
    expect(t.map[2]).toEqual([0, 3]); // 'b'
    expect(t.map[4]).toEqual([1, 2]); // 'c'
  });
});
