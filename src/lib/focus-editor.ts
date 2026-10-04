// Where focus goes when the editor opens: its <main> landmark, a non-visual
// target (tabindex -1, no ring). Never the scrolling canvas: that one shows its
// focus ring, which is meant for keyboard users who Tab to it.

/** Focus the editor's <main> unless the user has already focused something real. Returns true once done. */
export function focusEditorLandmark(doc: Document = document): boolean {
  const main = doc.getElementById('editor-main');
  if (!main) return false;
  const active = doc.activeElement;
  // Leave focus alone if it's already on a control (e.g. the user started typing in search).
  if (active && active !== doc.body && !active.closest('.landing') && active !== main) return true;
  main.focus({ preventScroll: true });
  return true;
}
