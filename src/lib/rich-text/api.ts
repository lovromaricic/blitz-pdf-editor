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
  /** A list command on the paragraphs the selection touches (the Text panel's List buttons). */
  list(action: import('../list-commands').ListAction): void;
  /** The list state of those paragraphs. */
  readonly listState: { list: import('../annotations').ListKind | null | 'mixed'; canIncrease: boolean; canDecrease: boolean; anyList: boolean };
  /** Finish editing (as Escape does). */
  finish(): void;
  /** Open the link popover for the selection (Cmd/Ctrl+K, Edit > Add link…, the Text panel). */
  openLink(): void;
  /** The box being edited, as drawn now (its box settings: alignment, spacing, background, opacity). */
  readonly box: import('../annotations').TextAnnotation;
  /** Change box settings while editing: undoable inside the session, saved with it as one step. */
  setBox(changes: Partial<import('../annotations').TextAnnotation>): void;
}
