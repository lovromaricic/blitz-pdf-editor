// Custom colors picked in this session, newest first. In memory only:
// nothing is written to any storage.
import type { Rgb } from './annotations';
import { quantize, toHex } from './color';

const RECENT_LIMIT = 8;

/** Custom colors used in this session, newest first. */
export const recentColors = $state<{ list: Rgb[] }>({ list: [] });

export function rememberColor(rgb: Rgb) {
  const hex = toHex(rgb);
  recentColors.list = [quantize(rgb), ...recentColors.list.filter((c) => toHex(c) !== hex)].slice(0, RECENT_LIMIT);
}
