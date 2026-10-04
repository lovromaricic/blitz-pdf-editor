// Small DOM helpers.

/** Capture the pointer if possible. Never throws (stale or synthetic pointer ids). */
export function capturePointer(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // The pointer is already gone; dragging still works within the element.
  }
}
