import { describe, expect, it } from 'vitest';
import { computeHunks, hunkKind, wordsOf } from '../src/lib/compare-diff';

const words = (s: string) => s.split(' ');

describe('compare', () => {
  it('finds changed, added and removed words', () => {
    const a = words('the supplier delivers goods within 10 days of the order');
    const b = words('the supplier delivers products within 10 days of the order plus fees');
    const hunks = computeHunks(a, b);
    expect(hunks).toEqual([
      { aStart: 3, aEnd: 4, bStart: 3, bEnd: 4 },
      { aStart: 10, aEnd: 10, bStart: 10, bEnd: 12 },
    ]);
    expect(hunks.map(hunkKind)).toEqual(['changed', 'added']);
    expect(hunkKind(computeHunks(words('a b c'), words('a c'))[0])).toBe('removed');
  });

  it('reports nothing for identical text', () => {
    expect(computeHunks(words('same text here'), words('same text here'))).toEqual([]);
  });

  it('splits text runs into words with boxes along the run', () => {
    const run = { str: 'Pay 500 EUR', transform: [10, 0, 0, 10, 100, 700], width: 110, height: 10 };
    const w = wordsOf([run, { str: '   ', transform: [10, 0, 0, 10, 0, 0], width: 30, height: 10 }], 2);
    expect(w.map((x) => x.text)).toEqual(['Pay', '500', 'EUR']);
    expect(w.every((x) => x.page === 2)).toBe(true);
    // "500" starts 4/11 of the way along the run and is 3/11 wide.
    expect(w[1].rect[0]).toBeCloseTo(140);
    expect(w[1].rect[2]).toBeCloseTo(170);
    expect(w[1].rect[1]).toBeLessThan(700);
    expect(w[1].rect[3]).toBeGreaterThan(705);
  });

  it('handles rotated text', () => {
    // Text running upwards (90°).
    const [w] = wordsOf([{ str: 'Up', transform: [0, 10, -10, 0, 50, 100], width: 20, height: 10 }], 0);
    expect(w.rect[1]).toBeCloseTo(100);
    expect(w.rect[3]).toBeCloseTo(120);
    expect(w.rect[0]).toBeLessThan(50);
  });
});
