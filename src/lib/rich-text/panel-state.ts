// The Text panel's view of the text being edited: the selection's formats
// (Mixed where they differ) plus the box's settings.
import { hasBold, hasItalic } from '../font-catalog';
import { alignOf, lineSpacingOf, MIXED as PANEL_MIXED, type TextFormatState } from '../text-format';
import type { RichEditorApi } from './api';
import { MIXED } from './mixed';

const v = <T,>(x: T | typeof MIXED) => (x === MIXED ? PANEL_MIXED : x);

export function editorFormatState(ed: RichEditorApi): TextFormatState {
  const s = ed.selection;
  const box = ed.box;
  return {
    font: v(s.font),
    size: v(s.size),
    bold: v(s.bold),
    italic: v(s.italic),
    underline: v(s.underline),
    strike: v(s.strike),
    color: v(s.color),
    align: alignOf(box),
    lineSpacing: lineSpacingOf(box),
    background: box.background ?? null,
    opacity: box.opacity,
    // Bold (italic) works when every font in the selection has it.
    canBold: ed.formats.every((f) => hasBold(f.font)),
    canItalic: ed.formats.every((f) => hasItalic(f.font)),
  };
}
