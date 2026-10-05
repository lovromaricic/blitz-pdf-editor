// What the text box being edited offers the Text panel and the shortcuts.
import type { RunFormat } from '../text-rich';
import type { SelectionFormat } from './schema';

export interface RichEditorApi {
  toggle(style: 'bold' | 'italic' | 'underline' | 'strike'): void;
  format(changes: Partial<RunFormat>): void;
  /** Formats in the selection (or the typing style at the caret), updated on every change. */
  readonly selection: SelectionFormat;
  /** Every format in the selection (to know whether all its fonts have bold, say). */
  readonly formats: RunFormat[];
  focus(): void;
  /** The box being edited, as drawn now (its box settings: alignment, spacing, background, opacity). */
  readonly box: import('../annotations').TextAnnotation;
  /** Change box settings while editing (one undo step each for a saved box). */
  setBox(changes: Partial<import('../annotations').TextAnnotation>, label: string, coalesceKey?: string): void;
}
