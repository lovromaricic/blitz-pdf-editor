// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { canMoveLayer, insertAbove, layerPosition, moveLayer, type LayerMove } from '../src/lib/z-order';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';
import type { Annotation } from '../src/lib/annotations';

const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (l: readonly { id: string }[]) => l.map((x) => x.id).join('');

describe('layer order operations', () => {
  it('to front, forward, backward, to back', () => {
    expect(ids(moveLayer(list, 'b', 'front'))).toBe('acdb');
    expect(ids(moveLayer(list, 'b', 'forward'))).toBe('acbd');
    expect(ids(moveLayer(list, 'c', 'backward'))).toBe('acbd');
    expect(ids(moveLayer(list, 'c', 'back'))).toBe('cabd');
  });

  it('at the top it can only go down; at the bottom only up; nothing changes otherwise', () => {
    for (const move of ['front', 'forward'] as LayerMove[]) {
      expect(canMoveLayer(list, 'd', move)).toBe(false);
      expect(moveLayer(list, 'd', move)).toBe(list);
    }
    for (const move of ['back', 'backward'] as LayerMove[]) {
      expect(canMoveLayer(list, 'a', move)).toBe(false);
      expect(moveLayer(list, 'a', move)).toBe(list);
    }
    expect(canMoveLayer(list, 'd', 'back')).toBe(true);
    expect(canMoveLayer(list, 'a', 'front')).toBe(true);
    // A single object, or one that isn't there, can't move at all.
    expect((['front', 'forward', 'backward', 'back'] as LayerMove[]).some((m) => canMoveLayer([{ id: 'x' }], 'x', m))).toBe(false);
    expect(canMoveLayer(list, 'zz', 'front')).toBe(false);
  });

  it('inserts directly above an object, or on top when it is not there', () => {
    expect(ids(insertAbove(list, 'b', { id: 'x' }))).toBe('abxcd');
    expect(ids(insertAbove(list, 'd', { id: 'x' }))).toBe('abcdx');
    expect(ids(insertAbove(list, 'gone', { id: 'x' }))).toBe('abcdx');
    expect(ids(insertAbove(list, null, { id: 'x' }))).toBe('abcdx');
  });

  it('reports the place of an object (1 = bottom)', () => {
    expect(layerPosition(list, 'c')).toEqual({ index: 3, count: 4 });
  });
});

describe('layer order in the editor', () => {
  const fakePdf = { getPage: async () => ({ rotate: 0, getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
  const stamp = (id: string, x = 100): Annotation => ({ id, type: 'stamp', label: id, color: [1, 0, 0], opacity: 1, rotate: 0, rect: [x, 100, x + 100, 130] });
  function setup() {
    const doc = new EditorDocument();
    doc.sources.set('s', new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf));
    doc.pages = [0, 1].map((i): PageRef => ({ id: `p${i}`, sourceId: 's', sourceIndex: i, rotation: 0, annots: i === 0 ? [stamp('a'), stamp('b'), stamp('c')] : [] }));
    const viewer = new Viewer(doc);
    return { doc, viewer, actions: new Actions(doc, viewer) };
  }
  const order = (doc: EditorDocument, i = 0) => (doc.pages[i].annots ?? []).map((a) => (a.type === 'stamp' ? a.label : a.id)).join('');

  it('each move is one undo step with a readable label; undo and redo restore the exact order', () => {
    const { doc, actions } = setup();
    actions.moveLayer('p0', 'a', 'front');
    expect(order(doc)).toBe('bca');
    expect(doc.history.undoLabel).toBe('Bring to front');
    actions.moveLayer('p0', 'a', 'backward');
    expect(order(doc)).toBe('bac');
    expect(doc.history.undoLabel).toBe('Send backward');
    doc.undo();
    expect(order(doc)).toBe('bca');
    doc.undo();
    expect(order(doc)).toBe('abc');
    doc.redo();
    doc.redo();
    expect(order(doc)).toBe('bac');
  });

  it('moves that cannot happen add no undo step', () => {
    const { doc, actions } = setup();
    actions.moveLayer('p0', 'c', 'front');
    actions.moveLayer('p0', 'a', 'back');
    expect(doc.history.canUndo).toBe(false);
  });

  it('new objects go on top; duplicates and same-page pastes directly above their original', () => {
    const { doc, viewer, actions } = setup();
    actions.addAnnotation('p0', stamp('n'));
    expect(order(doc)).toBe('abcn');
    viewer.selectAnnot({ pageId: 'p0', id: 'a' });
    actions.duplicateAnnotation();
    expect(order(doc)).toBe('aabcn');
    viewer.selectAnnot({ pageId: 'p0', id: 'b' });
    actions.copyAnnotation();
    actions.pasteAnnotation();
    expect(order(doc)).toBe('aabbcn');
  });

  it('pasting on another page, or after a cut, puts the object on top', () => {
    const { doc, viewer, actions } = setup();
    actions.addAnnotation('p1', stamp('x'));
    viewer.selectAnnot({ pageId: 'p0', id: 'a' });
    actions.copyAnnotation();
    viewer.currentIndex = 1;
    actions.pasteAnnotation();
    expect(order(doc, 1)).toBe('xa');
    viewer.currentIndex = 0;
    viewer.selectAnnot({ pageId: 'p0', id: 'b' });
    actions.cutAnnotation();
    expect(order(doc)).toBe('ac');
    actions.pasteAnnotation();
    expect(order(doc)).toBe('acb');
  });
});
