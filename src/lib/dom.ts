// Small DOM helpers.

/** Capture the pointer if possible. Never throws (stale or synthetic pointer ids). */
export function capturePointer(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // The pointer is already gone; dragging still works within the element.
  }
}

/**
 * Move an element to the end of <body> (for popovers over transformed or
 * clipped containers). Use it on a component's single root element.
 */
export function portal(node: HTMLElement) {
  document.body.append(node);
  return () => node.remove();
}

/** Keep Tab and Shift+Tab inside `node` (a popover that isn't in the page's tab order). */
export function cycleTab(e: KeyboardEvent, node: HTMLElement) {
  if (e.key !== 'Tab') return;
  const items = [...node.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
