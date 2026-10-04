// Promise-based modal dialogs (confirm / prompt), rendered by DialogHost.

export interface DialogButton {
  value: string;
  label: string;
  primary?: boolean;
  /** Destructive (e.g. discard changes). */
  danger?: boolean;
}

export interface DialogRequest {
  title: string;
  message?: string;
  /** Present for prompts: the text field's label and starting value. */
  input?: { label: string; value: string };
  buttons: DialogButton[];
  /** Value returned on Escape / backdrop. */
  cancelValue: string;
  /** Button (by value) that gets focus first; default: the primary button. */
  initialFocus?: string;
  resolve: (result: { button: string; text: string }) => void;
}

export const dialogs = $state({ current: null as DialogRequest | null });

export function showDialog(req: Omit<DialogRequest, 'resolve'>): Promise<{ button: string; text: string }> {
  return new Promise((resolve) => {
    dialogs.current = {
      ...req,
      resolve: (r) => {
        dialogs.current = null;
        resolve(r);
      },
    };
  });
}

/** Ask what to do with unsaved changes. */
export async function confirmDiscard(action: string): Promise<'save' | 'discard' | 'cancel'> {
  const r = await showDialog({
    title: 'Unsaved changes',
    message: `This document has changes that haven't been saved. Save a copy before you ${action}?`,
    buttons: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'discard', label: "Don't save", danger: true },
      { value: 'save', label: 'Save', primary: true },
    ],
    cancelValue: 'cancel',
  });
  return r.button as 'save' | 'discard' | 'cancel';
}

export async function promptText(title: string, label: string, value: string, okLabel = 'OK'): Promise<string | null> {
  const r = await showDialog({
    title,
    input: { label, value },
    buttons: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'ok', label: okLabel, primary: true },
    ],
    cancelValue: 'cancel',
  });
  return r.button === 'ok' ? r.text : null;
}
