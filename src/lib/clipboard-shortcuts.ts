// Cmd/Ctrl+C, X and V for objects: exactly one action per keystroke.
//
// The browser's clipboard event is the one source (it carries images and text
// from other apps). It doesn't always come, or come in time: Safari sends no
// paste event without an editable selection, and Chrome on macOS sends it
// through the app's Edit menu, after the keydown has finished. So a keystroke
// also arms a fallback that runs the command if no event has come by then.
// Whichever comes first handles the keystroke; the other one is ignored. (The
// fallback used to be cancelled only by an event that came first: a late paste
// event then pasted a second copy.)
import type { CommandId } from './commands';

export type ClipboardCommand = Extract<CommandId, 'edit.copy' | 'edit.cut' | 'edit.paste'>;

export const CLIPBOARD_KEYS: Record<string, ClipboardCommand> = { 'mod+c': 'edit.copy', 'mod+x': 'edit.cut', 'mod+v': 'edit.paste' };
const EVENT_OF: Record<ClipboardCommand, string> = { 'edit.copy': 'copy', 'edit.cut': 'cut', 'edit.paste': 'paste' };

/** How long a clipboard event may lag behind its keystroke and still belong to it. */
const SAME_ACTION_MS = 2000;

export class ClipboardShortcuts {
  private pending: { id: ClipboardCommand; at: number; done: boolean } | null = null;

  constructor(
    /** Runs the in-app command (the fallback). */
    private run: (id: ClipboardCommand) => void,
    private fallbackMs = 300,
    private now: () => number = () => performance.now(),
  ) {}

  /** A clipboard shortcut was pressed (outside text fields). */
  keydown(id: ClipboardCommand) {
    const p = { id, at: this.now(), done: false };
    this.pending = p;
    setTimeout(() => {
      if (p.done) return;
      p.done = true;
      this.run(id);
    }, this.fallbackMs);
  }

  /**
   * A copy, cut or paste event arrived. True: handle it (the first for its
   * keystroke, or one with no keystroke, e.g. the browser's own Edit menu).
   * False: its keystroke was already handled; ignore it (but still prevent the default).
   */
  event(type: 'copy' | 'cut' | 'paste'): boolean {
    const p = this.pending;
    if (!p || EVENT_OF[p.id] !== type || this.now() - p.at > SAME_ACTION_MS) return true;
    if (p.done) return false;
    p.done = true;
    return true;
  }
}
