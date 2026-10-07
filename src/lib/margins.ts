// View › Margin size: the presets and a custom value (one value for all four
// sides, kept in memory only). Typed values, their allowed range and how they
// show in mm or inches.
import { parseNumber } from './new-pdf';

export type MarginUnit = 'mm' | 'in';

/** The menu's presets, in mm (6.35 and 12.7 mm are exactly ¼ and ½ inch). */
export const MARGIN_PRESETS = [6.35, 12.7, 20, 25] as const;
export const DEFAULT_MARGIN_MM = 25;

const MM_PER: Record<MarginUnit, number> = { mm: 1, in: 25.4 };
const DIGITS: Record<MarginUnit, number> = { mm: 2, in: 3 };
/** Closer than this to a preset counts as that preset (typing 0.25 in, rounding). */
const SAME_MM = 0.005;

export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export const ptToMm = (pt: number) => (pt * 25.4) / 72;

/** The margin on a page, in points: limited to a quarter of the page's smaller side so small pages aren't all margin. */
export function marginPoints(mm: number, pageWidthPt: number, pageHeightPt: number) {
  return Math.min(mmToPt(mm), Math.min(pageWidthPt, pageHeightPt) / 4);
}

/** The preset a value matches (to a hair), or null for a custom value. */
export function presetFor(mm: number): number | null {
  return MARGIN_PRESETS.find((p) => Math.abs(p - mm) < SAME_MM) ?? null;
}

/** A value in `unit`, without trailing zeros ("30", "6.35", "1.181"). */
export function formatMargin(mm: number, unit: MarginUnit): string {
  const d = 10 ** DIGITS[unit];
  return String(Math.round((mm / MM_PER[unit]) * d) / d);
}

/** "30 mm", "1.181 in". */
export const marginLabel = (mm: number, unit: MarginUnit) => `${formatMargin(mm, unit)} ${unit}`;

/** Change a typed value to another unit (text that isn't a number stays as it is). */
export function convertTyped(text: string, from: MarginUnit, to: MarginUnit): string {
  const v = parseNumber(text);
  return v === null ? text : formatMargin(v * MM_PER[from], to);
}

/**
 * The largest margin the document allows, in mm: a quarter of the smaller
 * side of its smallest page. `sizes` are the pages' visible sizes in points.
 */
export function maxMarginMm(sizes: readonly { width: number; height: number }[]): number {
  if (!sizes.length) return 0;
  return ptToMm(Math.min(...sizes.map((s) => Math.min(s.width, s.height))) / 4);
}

/** The maximum as shown (rounded down, so the value shown is always allowed). */
export function shownMax(maxMm: number, unit: MarginUnit): number {
  const d = 10 ** (unit === 'mm' ? 1 : 2);
  return Math.floor((maxMm / MM_PER[unit]) * d + 1e-9) / d;
}

export const rangeText = (maxMm: number, unit: MarginUnit) => `0 to ${shownMax(maxMm, unit)} ${unit}`;

export type MarginCheck = { ok: true; mm: number } | { ok: false; error: string };

/**
 * A typed margin: a number with a dot or a comma, from 0 to the document's
 * maximum. Empty, negative, letters and anything out of range are refused
 * (with one message); the value is in mm, matched to a preset when it is one.
 */
export function checkMargin(text: string, unit: MarginUnit, maxMm: number): MarginCheck {
  const v = parseNumber(text);
  const max = shownMax(maxMm, unit);
  if (v === null || !Number.isFinite(v) || v > max) return { ok: false, error: `Enter a value from ${rangeText(maxMm, unit)}` };
  const mm = v * MM_PER[unit];
  return { ok: true, mm: presetFor(mm) ?? mm };
}

/** After a new margin: how many objects cross it ("3 objects are outside…"), or nothing to say. */
export function outsideMessage(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? '1 object is outside the new margins. It stays where it is.' : `${n} objects are outside the new margins. They stay where they are.`;
}
