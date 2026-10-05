// @vitest-environment happy-dom
// New blank PDF with unsaved changes: "Save a copy first?" and its three answers.
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { EditorDocument, Source } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';
import { dialogs } from '../src/lib/dialogs.svelte';

function setup(dirty: boolean) {
  const doc = new EditorDocument();
  doc.sources.set('s', new Source('s', 'report.pdf', 1, new Uint8Array(), {} as PDFDocumentProxy));
  doc.pages = [{ id: 'p0', sourceId: 's', sourceIndex: 0, rotation: 0 }];
  if (dirty) doc.edit('Rotate right', [{ ...doc.pages[0], rotation: 90 }]);
  const viewer = new Viewer(doc);
  return { doc, actions: new Actions(doc, viewer) };
}

/** Answer the dialog that's showing. */
async function answer(button: string) {
  await vi.waitFor(() => expect(dialogs.current).not.toBeNull());
  const d = dialogs.current!;
  expect(d.title).toBe('Save a copy first?');
  expect(d.buttons.map((b) => b.label)).toEqual(['Cancel', 'Discard changes', 'Save a copy…']);
  expect(d.initialFocus).toBe('save');
  d.resolve({ button, text: '' });
}

describe('replacing a document with unsaved changes', () => {
  it('asks nothing when there are no changes', async () => {
    const { actions } = setup(false);
    expect(await actions.confirmReplace()).toBe(true);
    expect(dialogs.current).toBeNull();
  });

  it('Cancel keeps the document', async () => {
    const { actions } = setup(true);
    const asked = actions.confirmReplace();
    await answer('cancel');
    expect(await asked).toBe(false);
  });

  it('Discard changes goes ahead without saving', async () => {
    const { actions } = setup(true);
    const save = vi.spyOn(actions, 'saveCopy');
    const asked = actions.confirmReplace();
    await answer('discard');
    expect(await asked).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('Save a copy… goes ahead only once the copy is saved', async () => {
    const { actions } = setup(true);
    const save = vi.spyOn(actions, 'saveCopy').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    let asked = actions.confirmReplace();
    await answer('save');
    expect(await asked).toBe(true);
    // Cancelling the file name (or a failed save) stops the new PDF.
    asked = actions.confirmReplace();
    await answer('save');
    expect(await asked).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('Escape counts as Cancel', async () => {
    const { actions } = setup(true);
    const asked = actions.confirmReplace();
    await vi.waitFor(() => expect(dialogs.current).not.toBeNull());
    dialogs.current!.resolve({ button: dialogs.current!.cancelValue, text: '' });
    expect(await asked).toBe(false);
  });
});
