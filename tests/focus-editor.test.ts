// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { focusEditorLandmark } from '../src/lib/focus-editor';

/** The parts of the editor that matter: <main> landmark and the focusable canvas scroller. */
function editorDom() {
  document.body.innerHTML = `
    <style>
      :focus-visible { outline: 2px solid rgb(63, 111, 224); }
      .scroller:focus-visible { outline: 2px solid rgb(63, 111, 224); }
      #editor-main:focus { outline: none; }
    </style>
    <div class="editor">
      <button id="first-control">Open</button>
      <main id="editor-main" tabindex="-1">
        <div class="scroller" id="document-view" tabindex="0"></div>
      </main>
    </div>`;
  return {
    main: document.getElementById('editor-main')!,
    scroller: document.getElementById('document-view')!,
  };
}

describe('focus when the editor opens', () => {
  it('goes to the <main> landmark, not the canvas, and draws no outline', () => {
    const { main, scroller } = editorDom();
    expect(focusEditorLandmark()).toBe(true);
    expect(document.activeElement).toBe(main);
    expect(document.activeElement).not.toBe(scroller);
    expect(getComputedStyle(main).outlineStyle).not.toBe('solid');
    // The canvas container isn't focused, so it can't show its ring.
    expect(scroller.matches(':focus')).toBe(false);
  });

  it('leaves focus alone if the user is already on a control', () => {
    editorDom();
    const button = document.getElementById('first-control')!;
    button.focus();
    expect(focusEditorLandmark()).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('reports when the editor is not rendered yet (so the caller retries)', () => {
    document.body.innerHTML = '<div class="landing"></div>';
    expect(focusEditorLandmark()).toBe(false);
  });
});
