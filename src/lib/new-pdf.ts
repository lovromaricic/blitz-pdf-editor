// File › New blank PDF…: page sizes, units, validation and the choices made
// this session (kept in memory only, never stored).

export type PresetId = 'a4' | 'letter' | 'a5' | 'legal';
export type SizeId = PresetId | 'custom';
export type Unit = 'mm' | 'in' | 'pt';
export type Orientation = 'portrait' | 'landscape';

/** Portrait sizes in points. */
export const PAGE_SIZES: Record<PresetId, { label: string; width: number; height: number }> = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  letter: { label: 'US Letter', width: 612, height: 792 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
  legal: { label: 'Legal', width: 612, height: 1008 },
};

export const UNIT_PT: Record<Unit, number> = { mm: 72 / 25.4, in: 72, pt: 1 };

/** Smallest page side: 36 pt (about 13 mm). */
export const MIN_PT = 36;
/** Largest page side: 14400 pt (5080 mm, 200 in), the practical PDF limit. */
export const MAX_PT = 14400;
export const MAX_PAGES = 200;

export interface NewPdfChoice {
  size: SizeId;
  orientation: Orientation;
  unit: Unit;
  /** Custom size as typed, in `unit`. */
  width: string;
  height: string;
  pages: string;
}

export type NewPdfErrors = Partial<Record<'width' | 'height' | 'pages', string>>;

export type NewPdfResult = { ok: true; width: number; height: number; pages: number } | { ok: false; errors: NewPdfErrors };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A size in `unit`, for showing in the fields (no more decimals than useful). */
export function formatIn(pt: number, unit: Unit): string {
  const v = pt / UNIT_PT[unit];
  const digits = unit === 'in' ? 2 : unit === 'mm' ? 1 : 0;
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

/** A typed number: digits with an optional decimal point or comma, nothing else. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$|^\.\d+$/.test(t) ? Number(t) : null;
}

function sideError(text: string, unit: Unit): string | undefined {
  const v = parseNumber(text);
  if (v === null) return 'Enter a number.';
  const pt = v * UNIT_PT[unit];
  // A little tolerance so "13 mm" and "5080 mm" (36.85 and 14400 pt) are accepted.
  if (pt < MIN_PT - 0.01) return `Too small: at least ${formatIn(MIN_PT, unit)} ${unit}.`;
  if (pt > MAX_PT + 0.01) return `Too large: at most ${formatIn(MAX_PT, unit)} ${unit}.`;
  return undefined;
}

/** Width and height for the orientation: portrait is never wider than tall, landscape the other way. */
export function orient(width: number, height: number, orientation: Orientation): [number, number] {
  const [short, long] = width <= height ? [width, height] : [height, width];
  return orientation === 'portrait' ? [short, long] : [long, short];
}

/** Check the choices; on success, the page size in points (orientation applied) and the page count. */
export function validateNewPdf(c: NewPdfChoice): NewPdfResult {
  const errors: NewPdfErrors = {};
  let w: number;
  let h: number;
  if (c.size === 'custom') {
    errors.width = sideError(c.width, c.unit);
    errors.height = sideError(c.height, c.unit);
    w = (parseNumber(c.width) ?? 0) * UNIT_PT[c.unit];
    h = (parseNumber(c.height) ?? 0) * UNIT_PT[c.unit];
  } else {
    ({ width: w, height: h } = PAGE_SIZES[c.size]);
  }
  const n = /^\s*\d+\s*$/.test(c.pages) ? Number(c.pages) : NaN;
  if (!(n >= 1 && n <= MAX_PAGES)) errors.pages = `Enter a whole number from 1 to ${MAX_PAGES}.`;
  if (errors.width || errors.height || errors.pages) return { ok: false, errors: Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) };
  const [width, height] = orient(Math.min(MAX_PT, Math.max(MIN_PT, w)), Math.min(MAX_PT, Math.max(MIN_PT, h)), c.orientation);
  return { ok: true, width: round2(width), height: round2(height), pages: n };
}

/** The last choices this session (memory only). */
export const lastNewPdf: NewPdfChoice = { size: 'a4', orientation: 'portrait', unit: 'mm', width: '210', height: '297', pages: '1' };

export function rememberNewPdf(c: NewPdfChoice) {
  Object.assign(lastNewPdf, c);
}
