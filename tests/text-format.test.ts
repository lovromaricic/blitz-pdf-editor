import { describe, expect, it } from 'vitest';
import type { TextAnnotation } from '../src/lib/annotations';
import {
  DEFAULT_LINE_SPACING,
  isMixed,
  LINE_SPACINGS,
  nextToggle,
  parseTextSize,
  pressed,
  stepTextSize,
  styleAvailable,
  textFormatState,
} from '../src/lib/text-format';

const box = (over: Partial<TextAnnotation> = {}): TextAnnotation => ({
  id: Math.random().toString(36),
  type: 'text',
  text: 'Hi',
  lines: ['Hi'],
  font: 'arimo',
  size: 12,
  color: [0, 0, 0],
  opacity: 1,
  rotate: 0,
  rect: [0, 0, 100, 20],
  ...over,
});

describe('text size', () => {
  it('accepts whole numbers from 6 to 144', () => {
    expect(parseTextSize('6')).toBe(6);
    expect(parseTextSize(' 144 ')).toBe(144);
    for (const bad of ['', '5', '145', '12.5', '1e2', 'abc', '-12', '12pt']) expect(parseTextSize(bad), bad).toBeNull();
  });

  it('steps by 1 (or 10) and stays in range', () => {
    expect(stepTextSize(12, 1)).toBe(13);
    expect(stepTextSize(12, -10)).toBe(6);
    expect(stepTextSize(140, 10)).toBe(144);
    expect(stepTextSize(12.4, 0)).toBe(12);
  });
});

describe('line spacing', () => {
  it('keeps the old 1.25 as the default, and offers it', () => {
    expect(DEFAULT_LINE_SPACING).toBe(1.25);
    expect(LINE_SPACINGS).toEqual([1, 1.15, 1.25, 1.5, 2]);
    // A text box from before (no setting) reads as the default.
    expect(textFormatState([box()]).lineSpacing).toBe(1.25);
  });
});

describe('bold and italic follow the font', () => {
  it('are available only where the font has them', () => {
    expect(styleAvailable('roboto', 'bold')).toBe(true);
    expect(styleAvailable('caveat', 'italic')).toBe(false);
    expect(styleAvailable('great-vibes', 'bold')).toBe(false);
  });

  it('show as disabled and not pressed, but keep the setting, on a font without them', () => {
    const s = textFormatState([box({ font: 'great-vibes', bold: true, italic: true })]);
    expect([s.canBold, s.canItalic]).toEqual([false, false]);
    expect(s.bold).toBe(true); // kept…
    expect(pressed(s.bold, s.canBold)).toBe(false); // …shown off while unavailable
    const back = textFormatState([box({ font: 'roboto', bold: true })]);
    expect(pressed(back.bold, back.canBold)).toBe(true);
  });
});

describe('several text boxes', () => {
  it('shows shared values, and Mixed where they differ', () => {
    const s = textFormatState([
      box({ font: 'roboto', size: 12, underline: true, align: 'center', color: [1, 0, 0] }),
      box({ font: 'roboto', size: 18, underline: false, align: 'center', color: [1, 0, 0], background: [1, 1, 1] }),
    ]);
    expect(s.font).toBe('roboto');
    expect(s.align).toBe('center');
    expect(s.color).toEqual([1, 0, 0]);
    expect(isMixed(s.size)).toBe(true);
    expect(isMixed(s.background)).toBe(true);
    expect(pressed(s.underline)).toBe('mixed');
    expect(isMixed(s.strike)).toBe(false);
  });

  it('turns a mixed toggle on for all; otherwise flips it', () => {
    expect(nextToggle(textFormatState([box({ strike: true }), box()]).strike)).toBe(true);
    expect(nextToggle(true)).toBe(false);
    expect(nextToggle(false)).toBe(true);
  });

  it('enables bold only when every selected font has it', () => {
    const s = textFormatState([box({ font: 'roboto' }), box({ font: 'great-vibes' })]);
    expect(s.canBold).toBe(false);
    expect(s.canItalic).toBe(false);
  });
});
