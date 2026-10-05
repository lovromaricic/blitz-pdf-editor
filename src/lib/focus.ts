// Focus management in one place.
// - Input modality: was the last input a Tab press? Browsers show :focus-visible
//   on an already focused element after any key press, so a scroll container
//   focused by a click would grow a ring on Backspace or Ctrl+Z. Scroll
//   containers use `tabRing` and show their ring only when reached with Tab.
// - Focus sink: when the focused thing goes away (an object or page deleted),
//   focus moves to the editor's <main> (tabindex -1, never a ring), not to the
//   scroll container and not lost on <body>.

let tabbing = false;
let installed = false;

/** Track the last input: a flag set by Tab, cleared by any pointer or other key. */
export function installFocusModality(target: Window = window) {
  if (installed) return;
  installed = true;
  target.addEventListener('keydown', (e) => (tabbing = e.key === 'Tab'), true);
  target.addEventListener('pointerdown', () => (tabbing = false), true);
}

/** Was the last input a Tab press? */
export function lastInputWasTab() {
  return tabbing;
}

/**
 * For focusable scroll containers (tabindex 0): marks the element with
 * data-tab-focus while it holds focus reached by Tab, which the CSS uses to
 * draw its ring. Programmatic or pointer focus never shows one.
 */
export function tabRing(node: HTMLElement) {
  installFocusModality();
  const onFocus = (e: FocusEvent) => {
    if (e.target === node && tabbing) node.dataset.tabFocus = '';
  };
  const clear = () => delete node.dataset.tabFocus;
  const onBlur = (e: FocusEvent) => e.target === node && clear();
  node.addEventListener('focus', onFocus);
  node.addEventListener('blur', onBlur);
  node.addEventListener('pointerdown', clear);
  return () => {
    node.removeEventListener('focus', onFocus);
    node.removeEventListener('blur', onBlur);
    node.removeEventListener('pointerdown', clear);
  };
}

/** Move focus to the editor's non-visual sink (its <main>). */
export function focusSink(doc: Document = document) {
  doc.getElementById('editor-main')?.focus({ preventScroll: true });
}

/** Focus a selected object on the page (its keyboard handle), or the sink if it isn't rendered. */
export function focusObject(id: string, doc: Document = document) {
  const el = doc.querySelector<HTMLElement>(`[data-annot-id="${id}"]`);
  if (el) el.focus({ preventScroll: true });
  else focusSink(doc);
}

/** Focus was lost: on <body>, or on an element that is no longer in the page. */
export function focusLost(doc: Document = document) {
  const a = doc.activeElement;
  return !a || a === doc.body || !a.isConnected;
}

/**
 * After something was deleted: focus goes to the sink if it was lost, if it
 * sits on the canvas scroll container (where the next key press would make
 * the browser draw a ring around the whole canvas), or if it went back to the
 * menu bar (Edit › Delete).
 */
export function settleFocusAfterRemoval(doc: Document = document) {
  const a = doc.activeElement;
  if (doc.querySelector('dialog[open]')) return;
  const onCanvas = a instanceof HTMLElement && a.id === 'document-view' && a.dataset.tabFocus === undefined;
  if (focusLost(doc) || onCanvas || !!a?.closest('[role="menubar"]')) focusSink(doc);
}
