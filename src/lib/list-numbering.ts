// Numbered lists: which number each item gets, and how it's written.
//
// Rules (paragraph by paragraph, top to bottom):
// - A numbered item continues the count of the previous numbered item at its
//   level, unless something broke that count since.
// - A paragraph that isn't a list item breaks every count.
// - A list item at some level (bullet or number) breaks the counts of all
//   deeper levels: a sublist restarts under each new parent item.
// - A bullet item breaks the numbered count at its own level.
// - Deeper items don't break a shallower count: 1. / a. / b. / 2. continues.
// Levels are written 1. 2. 3. (level 0), a. b. c. (level 1), i. ii. iii. (level 2).
import { MAX_LIST_LEVEL, type TextParagraph } from './annotations';

/** The number of each numbered item (null for everything else). */
export function listNumbers(paragraphs: readonly TextParagraph[]): (number | null)[] {
  const count = Array.from({ length: MAX_LIST_LEVEL + 1 }, () => 0);
  return paragraphs.map((p) => {
    if (!p.list) {
      count.fill(0);
      return null;
    }
    const level = listLevel(p);
    for (let l = level + 1; l <= MAX_LIST_LEVEL; l++) count[l] = 0;
    if (p.list === 'bullet') {
      count[level] = 0;
      return null;
    }
    return ++count[level];
  });
}

export function listLevel(p: TextParagraph) {
  return Math.max(0, Math.min(MAX_LIST_LEVEL, Math.round(p.level ?? 0)));
}

/** How item `n` (from 1) is written at a level: "3.", "c.", "iii.". */
export function listLabel(n: number, level: number) {
  if (level === 1) return `${alphabetic(n)}.`;
  if (level === 2) return `${roman(n)}.`;
  return `${n}.`;
}

/**
 * a … z, then aa, ab … az, ba … zz, aaa … (like spreadsheet columns and CSS
 * lower-alpha): every count has a label.
 */
export function alphabetic(n: number) {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s;
}

/**
 * i, ii, iii, iv … xxxix, xl, xli … up to 3999 (mmmcmxcix), as CSS
 * lower-roman; past that, plain digits (there are no standard numerals).
 */
export function roman(n: number) {
  if (n < 1 || n > 3999) return String(n);
  const parts: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let s = '';
  for (const [v, r] of parts) for (; n >= v; n -= v) s += r;
  return s;
}
