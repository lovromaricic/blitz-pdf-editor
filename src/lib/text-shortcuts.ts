// Keyboard shortcuts for text formatting, shown in the Text panel's tooltips.
// Only shortcuts that reach the page in every supported browser are listed:
// Ctrl/Cmd+B, I and U can be taken over by a page in Chrome, Safari and Firefox
// (web editors such as Google Docs rely on them). Strikethrough has none: the
// usual candidates collide (Firefox on Windows uses Ctrl+Shift+X in text fields).
import { COMMANDS, formatKeys } from './commands';

export type TextStyleKey = 'bold' | 'italic' | 'underline' | 'strike';

export const TEXT_STYLE_COMMANDS = { bold: 'text.bold', italic: 'text.italic', underline: 'text.underline' } as const;

/** "Ctrl+B" / "⌘B" per style, for tooltips. */
export const TEXT_SHORTCUTS: Partial<Record<TextStyleKey, string>> = Object.fromEntries(
  Object.entries(TEXT_STYLE_COMMANDS).map(([style, id]) => [style, formatKeys(COMMANDS[id].keys[0])]),
);

/** The style a shortcut toggles, if any (`combo` as from comboFromEvent). */
export function textStyleForCombo(combo: string | null): TextStyleKey | null {
  for (const [style, id] of Object.entries(TEXT_STYLE_COMMANDS)) if ((COMMANDS[id].keys as readonly string[]).includes(combo ?? '')) return style as TextStyleKey;
  return null;
}
