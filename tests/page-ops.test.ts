import { describe, expect, it } from 'vitest';
import type { PageRef } from '../src/lib/document.svelte';
import { History } from '../src/lib/history.svelte';
import {
  chunkAt,
  chunkEvery,
  deletePages,
  formatPageRange,
  insertPages,
  movePages,
  parsePageRange,
  rotatePages,
} from '../src/lib/page-ops';

const pages = (n: number): PageRef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, sourceId: 's', sourceIndex: i, rotation: 0 }));
const ids = (list: readonly PageRef[]) => list.map((p) => p.id);
const set = (...xs: string[]) => new Set(xs);

describe('page operations', () => {
  it('rotate wraps around and leaves other pages untouched (same object)', () => {
    const p = pages(3);
    const r = rotatePages(p, set('p1'), -90);
    expect(r[1].rotation).toBe(270);
    expect(rotatePages(r, set('p1'), 180)[1].rotation).toBe(90);
    expect(r[0]).toBe(p[0]);
    expect(p[1].rotation).toBe(0);
  });

  it('delete removes the given pages', () => {
    expect(ids(deletePages(pages(4), set('p0', 'p2')))).toEqual(['p1', 'p3']);
  });

  it('insert places pages at an index, clamped', () => {
    const extra = [{ id: 'x', sourceId: 't', sourceIndex: 0, rotation: 0 }];
    expect(ids(insertPages(pages(2), 1, extra))).toEqual(['p0', 'x', 'p1']);
    expect(ids(insertPages(pages(2), 99, extra))).toEqual(['p0', 'p1', 'x']);
  });

  it('move keeps relative order and handles forward and backward moves', () => {
    expect(ids(movePages(pages(5), set('p3'), 1))).toEqual(['p0', 'p3', 'p1', 'p2', 'p4']);
    expect(ids(movePages(pages(5), set('p0'), 3))).toEqual(['p1', 'p2', 'p0', 'p3', 'p4']);
    expect(ids(movePages(pages(5), set('p1', 'p3'), 5))).toEqual(['p0', 'p2', 'p4', 'p1', 'p3']);
    expect(ids(movePages(pages(5), set('p0', 'p4'), 2))).toEqual(['p1', 'p0', 'p4', 'p2', 'p3']);
  });

  it('move to the same place returns the same array', () => {
    const p = pages(3);
    expect(movePages(p, set('p1'), 1)).toBe(p);
    expect(movePages(p, set('p1'), 2)).toBe(p);
  });
});

describe('page ranges', () => {
  it('parses lists, ranges and open ends', () => {
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageRange('-2', 10)).toEqual([0, 1]);
    expect(parsePageRange('3,3,1', 10)).toEqual([0, 2]);
  });
  it('rejects invalid input', () => {
    expect(parsePageRange('', 10)).toBeNull();
    expect(parsePageRange('0', 10)).toBeNull();
    expect(parsePageRange('11', 10)).toBeNull();
    expect(parsePageRange('5-2', 10)).toBeNull();
    expect(parsePageRange('a', 10)).toBeNull();
  });
  it('formats compactly', () => {
    expect(formatPageRange([0, 1, 2, 4, 6, 7])).toBe('1-3, 5, 7-8');
  });
  it('chunks for splitting', () => {
    expect(chunkEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(chunkAt(6, [2, 4])).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(chunkAt(3, [0, 9])).toEqual([[0, 1, 2]]);
  });
});

describe('History', () => {
  it('undoes and redoes, and tracks unsaved changes', () => {
    const h = new History<number>();
    let state = 0;
    const edit = (n: number) => {
      h.push(`set ${n}`, state);
      state = n;
    };
    expect(h.dirty).toBe(false);
    edit(1);
    edit(2);
    expect(h.dirty).toBe(true);
    h.markSaved();
    expect(h.dirty).toBe(false);
    state = h.undo(state)!;
    expect(state).toBe(1);
    expect(h.dirty).toBe(true);
    state = h.redo(state)!;
    expect(state).toBe(2);
    expect(h.dirty).toBe(false);
    state = h.undo(state)!;
    edit(5);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('set 5');
  });
});
