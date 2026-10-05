// @vitest-environment happy-dom
// One paste (copy, cut) per keystroke, whichever way the browser delivers it;
// and the paste command itself: one object, one undo step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ClipboardShortcuts } from '../src/lib/clipboard-shortcuts';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';
import type { Annotation } from '../src/lib/annotations';

describe('clipboard shortcuts: one action per keystroke', () => {
  let t = 0;
  let ran: string[] = [];
  let cs: ClipboardShortcuts;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    ran = [];
    cs = new ClipboardShortcuts((id) => ran.push(id), 300, () => t);
  });
  afterEach(() => vi.useRealTimers());

  it('the paste event comes during the keystroke (most browsers): the event pastes, the fallback does not', () => {
    cs.keydown('edit.paste');
    expect(cs.event('paste')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(ran).toEqual([]);
  });

  it('the event comes late (Chrome on macOS, through the app menu), before the fallback: pasted once, by the event', () => {
    cs.keydown('edit.paste');
    t = 40;
    vi.advanceTimersByTime(40);
    expect(cs.event('paste')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(ran).toEqual([]);
  });

  it('the event comes after the fallback ran: it is ignored (this used to paste a second copy)', () => {
    cs.keydown('edit.paste');
    t = 300;
    vi.advanceTimersByTime(300);
    expect(ran).toEqual(['edit.paste']);
    t = 450;
    expect(cs.event('paste')).toBe(false);
    expect(ran).toEqual(['edit.paste']);
  });

  it('no event at all (Safari with no text selected): the fallback pastes once', () => {
    cs.keydown('edit.paste');
    vi.advanceTimersByTime(1000);
    expect(ran).toEqual(['edit.paste']);
  });

  it('several keystrokes: one action each; events without a keystroke (the browser menu) act too', () => {
    for (let i = 0; i < 3; i++) {
      cs.keydown('edit.paste');
      expect(cs.event('paste')).toBe(true);
      expect(cs.event('paste')).toBe(false); // a duplicate event for the same keystroke
    }
    cs.keydown('edit.copy');
    vi.advanceTimersByTime(1000);
    expect(ran).toEqual(['edit.copy']);
    t = 10_000;
    expect(cs.event('paste')).toBe(true);
  });
});

describe('the paste command', () => {
  const fakePdf = {
    getPage: async () => ({ rotate: 0, getViewport: () => ({}) }),
  } as unknown as PDFDocumentProxy;
  function setup() {
    const doc = new EditorDocument();
    doc.sources.set('s', new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf));
    const box: Annotation = { id: 'a', type: 'stamp', label: 'OK', color: [1, 0, 0], opacity: 1, rotate: 0, rect: [100, 100, 200, 130] };
    doc.pages = [0, 1].map((i): PageRef => ({ id: `p${i}`, sourceId: 's', sourceIndex: i, rotation: 0, annots: i === 0 ? [box] : [] }));
    const viewer = new Viewer(doc);
    const actions = new Actions(doc, viewer);
    viewer.selectAnnot({ pageId: 'p0', id: 'a' });
    return { doc, viewer, actions };
  }
  const objects = (doc: EditorDocument, i: number) => doc.pages[i].annots ?? [];

  it('one paste is one object and one undo step; repeated pastes each add one, a step further', () => {
    const { doc, actions } = setup();
    actions.copyAnnotation();
    actions.pasteAnnotation();
    expect(objects(doc, 0)).toHaveLength(2);
    expect(doc.history.undoLabel).toBe('Paste stamp');
    actions.pasteAnnotation();
    expect(objects(doc, 0)).toHaveLength(3);
    const [a, b, c] = objects(doc, 0);
    expect(b.type === 'stamp' && b.rect[0] - (a as typeof b).rect[0]).toBe(12);
    expect(c.type === 'stamp' && c.rect[0] - (b as typeof c).rect[0]).toBe(12);
    doc.undo();
    expect(objects(doc, 0)).toHaveLength(2);
    doc.redo();
    expect(objects(doc, 0)).toHaveLength(3);
  });

  it('on another page it lands in the same position', () => {
    const { doc, viewer, actions } = setup();
    actions.copyAnnotation();
    viewer.currentIndex = 1;
    actions.pasteAnnotation();
    expect(objects(doc, 1)).toHaveLength(1);
    expect((objects(doc, 1)[0] as { rect: number[] }).rect).toEqual([100, 100, 200, 130]);
    expect(objects(doc, 0)).toHaveLength(1);
  });
});
