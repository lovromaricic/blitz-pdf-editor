// Document-wide output settings: watermark, page numbers and password
// protection. Part of undo history alongside the pages. Plain data.
import type { Rgb } from './annotations';

export interface WatermarkSettings {
  text: string;
  /** Share of the page the text spans: small, medium or large. */
  size: 'small' | 'medium' | 'large';
  color: Rgb;
  opacity: number;
  /** Counter-clockwise angle on screen, in degrees. */
  angle: 0 | 45;
  /** 'all', or the ids of the pages that get it. */
  pages: 'all' | string[];
}

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
export type NumberFormat = 'n' | 'page-n' | 'page-n-of-total' | 'n-of-total';

export interface PageNumberSettings {
  position: NumberPosition;
  format: NumberFormat;
  /** Number shown on the first numbered page. */
  firstNumber: number;
  /** 1-based position of the first page that gets a number. */
  fromPage: number;
  /** Points. */
  size: number;
}

export interface ProtectionSettings {
  password: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowEditing: boolean;
}

export interface DocSettings {
  watermark?: WatermarkSettings;
  pageNumbers?: PageNumberSettings;
  protection?: ProtectionSettings;
}

export const WATERMARK_SIZES = { small: 0.4, medium: 0.6, large: 0.85 } as const;

/** Distance of page numbers from the page edge, in points. */
export const NUMBER_MARGIN = 24;

export function formatPageNumber(format: NumberFormat, n: number, total: number) {
  switch (format) {
    case 'n':
      return `${n}`;
    case 'page-n':
      return `Page ${n}`;
    case 'page-n-of-total':
      return `Page ${n} of ${total}`;
    case 'n-of-total':
      return `${n} / ${total}`;
  }
}

/** Labels for every numbered page, by page id. Follows the current page order. */
export function pageNumberLabels(pageIds: readonly string[], s: PageNumberSettings): Map<string, string> {
  const labels = new Map<string, string>();
  const start = Math.max(1, s.fromPage) - 1;
  const total = s.firstNumber + Math.max(0, pageIds.length - start) - 1;
  for (let i = start; i < pageIds.length; i++) {
    labels.set(pageIds[i], formatPageNumber(s.format, s.firstNumber + i - start, total));
  }
  return labels;
}

export function watermarkApplies(s: WatermarkSettings | undefined, pageId: string) {
  return !!s && (s.pages === 'all' || s.pages.includes(pageId));
}
