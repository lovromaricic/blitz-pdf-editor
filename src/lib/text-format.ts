// Text box formatting rules shared by the Text panel and tests: size limits,
// line spacing choices, which styles a font really has, and the "mixed" state
// when several text boxes with different settings are selected. No DOM.
import { sameRgb, type Rgb, type TextAlign, type TextAnnotation } from './annotations';
import { hasBold, hasItalic } from './font-catalog';

export const MIN_TEXT_SIZE = 6;
export const MAX_TEXT_SIZE = 144;

/** Line height as a multiple of the size. 1.25 is what text boxes have always used. */
export const DEFAULT_LINE_SPACING = 1.25;
export const LINE_SPACINGS = [1, 1.15, 1.25, 1.5, 2] as const;

export const ALIGNS: TextAlign[] = ['left', 'center', 'right', 'justify'];

export const lineSpacingOf = (a: Pick<TextAnnotation, 'lineSpacing'>) => a.lineSpacing ?? DEFAULT_LINE_SPACING;
export const alignOf = (a: Pick<TextAnnotation, 'align'>) => a.align ?? 'left';

/** A typed size: a whole number from 6 to 144, else null. */
export function parseTextSize(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_TEXT_SIZE && n <= MAX_TEXT_SIZE ? n : null;
}

/** The size one step (or `delta`) up or down, kept in range and whole. */
export function stepTextSize(size: number, delta: number): number {
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(size) + delta));
}

/** Is bold (or italic) available in this font? If not, the button is disabled and the setting has no effect. */
export function styleAvailable(font: string, style: 'bold' | 'italic') {
  return style === 'bold' ? hasBold(font) : hasItalic(font);
}

export const MIXED: unique symbol = Symbol('mixed');
export type Shared<T> = T | typeof MIXED;

/** Several selected boxes differ here. */
export function isMixed<T>(v: Shared<T>): v is typeof MIXED {
  return v === MIXED;
}

/** The one value all items share, or MIXED. */
export function shared<A, T>(items: readonly A[], get: (a: A) => T, same: (x: T, y: T) => boolean = Object.is): Shared<T> {
  if (items.length === 0) return MIXED;
  const first = get(items[0]);
  return items.every((a) => same(get(a), first)) ? first : MIXED;
}

export interface TextFormatState {
  font: Shared<string>;
  size: Shared<number>;
  bold: Shared<boolean>;
  italic: Shared<boolean>;
  underline: Shared<boolean>;
  strike: Shared<boolean>;
  align: Shared<TextAlign>;
  lineSpacing: Shared<number>;
  color: Shared<Rgb>;
  background: Shared<Rgb | null>;
  opacity: Shared<number>;
  canBold: boolean;
  canItalic: boolean;
}

/** What the Text panel shows for a selection of text boxes (one today; several later). */
export function textFormatState(items: readonly TextAnnotation[]): TextFormatState {
  return {
    font: shared(items, (a) => a.font),
    size: shared(items, (a) => a.size),
    bold: shared(items, (a) => !!a.bold),
    italic: shared(items, (a) => !!a.italic),
    underline: shared(items, (a) => !!a.underline),
    strike: shared(items, (a) => !!a.strike),
    align: shared(items, alignOf),
    lineSpacing: shared(items, lineSpacingOf),
    color: shared<TextAnnotation, Rgb>(items, (a) => a.color, sameRgb),
    background: shared<TextAnnotation, Rgb | null>(items, (a) => a.background ?? null, sameRgb),
    opacity: shared(items, (a) => a.opacity),
    /** A style button is enabled when every selected box's font has that style. */
    canBold: items.length > 0 && items.every((a) => hasBold(a.font)),
    canItalic: items.length > 0 && items.every((a) => hasItalic(a.font)),
  };
}

/**
 * Pressed state of a toggle: true, false, or 'mixed'. A style the font lacks
 * shows as not pressed (and disabled), though the setting is kept.
 */
export function pressed(value: Shared<boolean>, available = true): boolean | 'mixed' {
  if (!available) return false;
  return isMixed(value) ? 'mixed' : value;
}

/** Turning a mixed toggle on sets it on everywhere; otherwise it flips. */
export function nextToggle(value: Shared<boolean>): boolean {
  return isMixed(value) ? true : !value;
}
