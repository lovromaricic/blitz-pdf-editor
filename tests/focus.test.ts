// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { focusLost, focusSink, installFocusModality, settleFocusAfterRemoval, tabRing } from '../src/lib/focus';

function dom() {
  document.body.innerHTML = `<main id="editor-main" tabindex="-1"><button id="b">x</button><div id="document-view" tabindex="0"></div></main>`;
  const canvas = document.getElementById('document-view')!;
  tabRing(canvas);
  installFocusModality();
  return { canvas, main: document.getElementById('editor-main')!, button: document.getElementById('b')! };
}
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

describe('focus rings on scroll containers', () => {
  it('shows only when the container was reached with Tab', () => {
    const { canvas, button } = dom();
    key('Tab');
    canvas.focus();
    expect(canvas.dataset.tabFocus).toBe('');
    // Pointer on it: the ring goes, and stays gone while keys are pressed.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    key('Backspace');
    expect(canvas.dataset.tabFocus).toBeUndefined();
    button.focus();
    // Programmatic focus (or after any other key) never marks it.
    key('ArrowDown');
    canvas.focus();
    expect(canvas.dataset.tabFocus).toBeUndefined();
  });
});

describe('focus sink', () => {
  it('takes focus that was lost, or left on the canvas, after a removal', () => {
    const { canvas, main, button } = dom();
    button.focus();
    button.remove();
    expect(focusLost()).toBe(true);
    settleFocusAfterRemoval();
    expect(document.activeElement).toBe(main);

    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    canvas.focus();
    settleFocusAfterRemoval();
    expect(document.activeElement).toBe(main);

    focusSink();
    expect(document.activeElement?.id).toBe('editor-main');
  });

  it('leaves the canvas alone when the user tabbed to it', () => {
    const { canvas } = dom();
    key('Tab');
    canvas.focus();
    settleFocusAfterRemoval();
    expect(document.activeElement).toBe(canvas);
  });
});
