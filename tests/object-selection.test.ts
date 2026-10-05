// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation } from '../src/lib/annotations';
import { addUnits, clampDelta, copyWithNewIds, describeUnits, groupUnits, membersOf, toggleUnit, ungroupUnits, unionBounds, unitsIn, unitsTouching } from '../src/lib/object-selection';
import { canMoveUnits, insertAboveUnit, moveUnits } from '../src/lib/z-order';
import { EditorDocument, Source, type PageRef } from '../src/lib/document.svelte';
import { Viewer } from '../src/lib/viewer.svelte';
import { Actions } from '../src/lib/actions.svelte';

const stamp = (id: string, x: number, y = 100, groups?: string[]): Annotation => ({ id, type: 'stamp', label: id, color: [1, 0, 0], opacity: 1, rotate: 0, rect: [x, y, x + 50, y + 20], ...(groups ? { groups } : {}) });
const ids = (l: readonly { id: string }[]) => l.map((a) => a.id).join(' ');

describe('selecting objects', () => {
  it('Shift+click toggles objects in and out; the last one out clears the selection', () => {
    let r = toggleUnit(null, 'p1', 'a');
    expect(r).toEqual({ selection: { pageId: 'p1', ids: ['a'] } });
    r = toggleUnit((r as { selection: never }).selection, 'p1', 'b');
    expect(r).toEqual({ selection: { pageId: 'p1', ids: ['a', 'b'] } });
    r = toggleUnit({ pageId: 'p1', ids: ['a', 'b'] }, 'p1', 'a');
    expect(r).toEqual({ selection: { pageId: 'p1', ids: ['b'] } });
    expect(toggleUnit({ pageId: 'p1', ids: ['b'] }, 'p1', 'b')).toEqual({ selection: null });
  });

  it('only on one page: an object on another page leaves the selection alone', () => {
    expect(toggleUnit({ pageId: 'p1', ids: ['a'] }, 'p2', 'x')).toEqual({ otherPage: true });
    // Nothing selected yet: any page will do.
    expect(toggleUnit(null, 'p2', 'x')).toEqual({ selection: { pageId: 'p2', ids: ['x'] } });
  });

  it('the marquee selects every object it touches; Shift adds to the selection', () => {
    const list = [stamp('a', 0), stamp('b', 100), stamp('c', 200), stamp('d', 0, 400)];
    expect(unitsTouching(list, [40, 90, 120, 130])).toEqual(['a', 'b']);
    expect(unitsTouching(list, [300, 0, 400, 50])).toEqual([]);
    expect(addUnits({ pageId: 'p', ids: ['c'] }, 'p', ['a', 'c'])).toEqual({ pageId: 'p', ids: ['c', 'a'] });
    expect(addUnits(null, 'p', [])).toBeNull();
  });

  it('a moved selection stops at the page edge as a whole', () => {
    const box: [number, number, number, number] = [100, 100, 200, 150];
    const page: [number, number, number, number] = [0, 0, 612, 792];
    expect(clampDelta(box, page, -500, 0)).toEqual([-100, 0]);
    expect(clampDelta(box, page, 500, 700)).toEqual([412, 642]);
    expect(clampDelta(box, page, 10, -20)).toEqual([10, -20]);
    expect(unionBounds([stamp('a', 0), stamp('b', 100, 300)])).toEqual([0, 100, 150, 320]);
  });

  it('names a selection for labels and announcements', () => {
    const list = [stamp('a', 0), stamp('b', 100), stamp('c', 200, 100, ['group-1']), stamp('d', 300, 100, ['group-1'])];
    expect(describeUnits(list, ['a'])).toBe('stamp');
    expect(describeUnits(list, ['a', 'b', 'group-1'], true)).toBe('3 objects');
    expect(describeUnits(list, ['group-1'])).toBe('group (2 objects)');
  });
});

describe('moving a selection in the layer order, as a block', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id, i) => stamp(id, i * 10));
  it('keeps the block\'s own order', () => {
    expect(ids(moveUnits(list, ['b', 'd'], 'front'))).toBe('a c e b d');
    expect(ids(moveUnits(list, ['b', 'd'], 'back'))).toBe('b d a c e');
    // Forward: past the next unselected object above the block's top (e).
    expect(ids(moveUnits(list, ['b', 'd'], 'forward'))).toBe('a c e b d');
    // Backward: past the next unselected object below its bottom (a).
    expect(ids(moveUnits(list, ['b', 'd'], 'backward'))).toBe('b d a c e');
    expect(ids(moveUnits(list, ['a', 'b'], 'forward'))).toBe('c a b d e');
  });

  it('knows when there is nowhere to go', () => {
    expect(canMoveUnits(list, ['d', 'e'], 'front')).toBe(false);
    expect(canMoveUnits(list, ['d', 'e'], 'forward')).toBe(false);
    expect(canMoveUnits(list, ['c', 'e'], 'front')).toBe(true); // d is above c
    expect(canMoveUnits(list, ['c', 'e'], 'forward')).toBe(false); // nothing above e
    expect(canMoveUnits(list, ['a', 'b'], 'back')).toBe(false);
  });

  it('inserts a pasted block above a unit (or on top)', () => {
    const block = [stamp('x', 0), stamp('y', 0)];
    expect(ids(insertAboveUnit(list, 'b', block))).toBe('a b x y c d e');
    expect(ids(insertAboveUnit(list, null, block))).toBe('a b c d e x y');
  });
});

describe('the selection commands', () => {
  const fakePdf = { getPage: async () => ({ rotate: 0, getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
  function setup() {
    const doc = new EditorDocument();
    doc.sources.set('s', new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf));
    doc.pages = [0, 1].map((i): PageRef => ({ id: `p${i}`, sourceId: 's', sourceIndex: i, rotation: 0, annots: i === 0 ? [stamp('a', 100), stamp('b', 200, 300), stamp('c', 300, 500)] : [] }));
    const viewer = new Viewer(doc);
    const actions = new Actions(doc, viewer);
    viewer.selectObjects({ pageId: 'p0', ids: ['a', 'c'] });
    return { doc, viewer, actions };
  }
  const labels = (doc: EditorDocument) => doc.pages[0].annots!.map((a) => (a.type === 'stamp' ? a.label : '?')).join(' ');

  it('delete removes all of them as one undo step', () => {
    const { doc, viewer, actions } = setup();
    actions.deleteSelection();
    expect(labels(doc)).toBe('b');
    expect(doc.history.undoLabel).toBe('Delete 2 objects');
    expect(viewer.objectSelection).toBeNull();
    doc.undo();
    expect(labels(doc)).toBe('a b c');
  });

  it('copy and paste keep their positions relative to each other; one step, the copies selected', () => {
    const { doc, viewer, actions } = setup();
    actions.copyAnnotation();
    actions.pasteAnnotation();
    const all = doc.pages[0].annots!;
    expect(all).toHaveLength(5);
    expect(doc.history.undoLabel).toBe('Paste 2 objects');
    // Directly above the top of the copied ones (c), in their order.
    expect(labels(doc)).toBe('a b c a c');
    const [, , , pa, pc] = all as unknown as { rect: number[] }[];
    expect(pc.rect[0] - pa.rect[0]).toBe(200);
    expect(pc.rect[1] - pa.rect[1]).toBe(400);
    expect(viewer.objectSelection?.ids).toEqual([all[3].id, all[4].id]);
    // On another page: same positions, on top.
    viewer.currentIndex = 1;
    actions.pasteAnnotation();
    expect(doc.pages[1].annots!.map((a) => (a as { rect: number[] }).rect[0])).toEqual([112, 312]);
  });

  it('duplicate puts the copies directly above the selection; nudge moves all of it, one step per run', () => {
    const { doc, actions } = setup();
    actions.duplicateAnnotation();
    expect(labels(doc)).toBe('a b c a c');
    expect(doc.history.undoLabel).toBe('Duplicate 2 objects');
    actions.nudgeSelection(1, 0);
    actions.nudgeSelection(1, 0);
    expect(doc.history.undoLabel).toBe('Move 2 objects');
    const [, , , da, dc] = doc.pages[0].annots! as unknown as { rect: number[] }[];
    expect([da.rect[0], dc.rect[0]]).toEqual([114, 314]);
    doc.undo();
    expect((doc.pages[0].annots![3] as { rect: number[] }).rect[0]).toBe(112);
  });

  it('the layer moves act on the selection as a block', () => {
    const { doc, actions } = setup();
    expect(actions.canMoveSelected('front')).toBe(true); // b is above a
    actions.moveSelectedLayer('front');
    expect(labels(doc)).toBe('b a c');
    expect(actions.canMoveSelected('front')).toBe(false);
    actions.moveSelectedLayer('back');
    expect(labels(doc)).toBe('a c b');
    doc.undo();
    doc.undo();
    expect(labels(doc)).toBe('a b c');
  });

  it('select all on a page, and copies get new ids (groups too: new groups)', () => {
    const { viewer, actions } = setup();
    expect(actions.selectAllObjects('p0')).toBe(true);
    expect(viewer.objectSelection?.ids).toEqual(['a', 'b', 'c']);
    expect(actions.selectAllObjects('p1')).toBe(false);
    let n = 0;
    const copies = copyWithNewIds([stamp('x', 0, 0, ['group-g']), stamp('y', 0, 0, ['group-g', 'group-h'])], () => `n${++n}`);
    expect(copies.map((a) => a.id)).toEqual(['n1', 'n3']);
    expect(copies[0].groups).toEqual(['group-n2']);
    expect(copies[1].groups).toEqual(['group-n2', 'group-n4']);
    expect(unitsIn(copies)).toEqual(['group-n2']);
    expect(membersOf(copies, ['group-n2'])).toHaveLength(2);
  });
});

describe('groups', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id, i) => stamp(id, i * 60));
  const groupsOf = (l: readonly Annotation[]) => l.map((a) => `${a.id}${a.groups ? ':' + a.groups.join('/') : ''}`).join(' ');

  it('groups units where the topmost of them is, keeping their order; units in between stay below', () => {
    const g = groupUnits(list, ['b', 'd'], 'group-1');
    expect(groupsOf(g)).toBe('a c b:group-1 d:group-1 e');
    expect(unitsIn(g)).toEqual(['a', 'c', 'group-1', 'e']);
    // One object is no group.
    expect(groupUnits(list, ['b'], 'group-x')).toBe(list);
  });

  it('nests: a group of a group and an object; ungroup removes one level only', () => {
    const inner = groupUnits(list, ['a', 'b'], 'group-in');
    const outer = groupUnits(inner, ['group-in', 'c'], 'group-out');
    expect(groupsOf(outer)).toBe('a:group-out/group-in b:group-out/group-in c:group-out d e');
    expect(unitsIn(outer)).toEqual(['group-out', 'd', 'e']);
    expect(describeUnits(outer, ['group-out'])).toBe('group (3 objects)');
    const { list: one, children } = ungroupUnits(outer, ['group-out']);
    expect(groupsOf(one)).toBe('a:group-in b:group-in c d e');
    expect(children).toEqual(['group-in', 'c']);
    const { list: none } = ungroupUnits(one, ['group-in']);
    expect(groupsOf(none)).toBe('a b c d e');
    expect(none[0]).not.toHaveProperty('groups');
  });

  it('a group moves in the layer order as one unit, its objects together', () => {
    const g = groupUnits(list, ['a', 'b'], 'group-1');
    expect(ids(moveUnits(g, ['group-1'], 'front'))).toBe('c d e a b');
    expect(ids(moveUnits(g, ['group-1'], 'forward'))).toBe('c a b d e');
    expect(canMoveUnits(g, ['group-1'], 'back')).toBe(false);
    expect(ids(moveUnits(g, ['e'], 'backward'))).toBe('a b c e d');
    expect(ids(moveUnits(g, ['c'], 'back'))).toBe('c a b d e'); // below the whole group, not inside it
  });

  it('its bounding box is around all its objects', () => {
    const g = groupUnits(list, ['a', 'c'], 'group-1');
    expect(unionBounds(membersOf(g, ['group-1']))).toEqual([0, 100, 170, 120]);
  });

  it('copied groups become new groups with copies of their objects', () => {
    const g = groupUnits(groupUnits(list, ['a', 'b'], 'group-in'), ['group-in', 'c'], 'group-out');
    let n = 0;
    const copies = copyWithNewIds(membersOf(g, ['group-out']), () => `k${++n}`);
    expect(unitsIn(copies)).toHaveLength(1);
    expect(copies.every((a) => a.groups![0] === copies[0].groups![0] && a.groups![0] !== 'group-out')).toBe(true);
    expect(copies[0].groups![1]).toBe(copies[1].groups![1]);
    expect(copies[2].groups).toHaveLength(1);
  });
});

describe('group and ungroup commands', () => {
  const fakePdf = { getPage: async () => ({ rotate: 0, getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
  function setup() {
    const doc = new EditorDocument();
    doc.sources.set('s', new Source('s', 'test.pdf', 1, new Uint8Array(), fakePdf));
    doc.pages = [0, 1].map((i): PageRef => ({ id: `p${i}`, sourceId: 's', sourceIndex: i, rotation: 0, annots: i === 0 ? ['a', 'b', 'c', 'd'].map((id, k) => stamp(id, k * 100)) : [] }));
    const viewer = new Viewer(doc);
    return { doc, viewer, actions: new Actions(doc, viewer) };
  }
  const order = (doc: EditorDocument, i = 0) => doc.pages[i].annots!.map((a) => `${(a as { label: string }).label}${a.groups ? '*' : ''}`).join(' ');

  it('group: one undo step, the group selected; undo and redo restore exactly', () => {
    const { doc, viewer, actions } = setup();
    viewer.selectObjects({ pageId: 'p0', ids: ['a', 'c', 'd'] });
    expect(actions.canGroup()).toBe(true);
    actions.groupSelection();
    expect(order(doc)).toBe('b a* c* d*');
    expect(doc.history.undoLabel).toBe('Group 3 objects');
    const g = viewer.objectSelection!.ids[0];
    expect(g.startsWith('group-')).toBe(true);
    expect(actions.describeSelection()).toBe('group (3 objects)');
    doc.undo();
    expect(order(doc)).toBe('a b c d');
    doc.redo();
    expect(order(doc)).toBe('b a* c* d*');
  });

  it('ungroup: one level, the former children selected, positions and order kept; one undo step', () => {
    const { doc, viewer, actions } = setup();
    viewer.selectObjects({ pageId: 'p0', ids: ['a', 'b'] });
    actions.groupSelection();
    const inner = viewer.objectSelection!.ids[0];
    viewer.selectObjects({ pageId: 'p0', ids: [inner, 'c'] });
    actions.groupSelection();
    const outer = viewer.objectSelection!.ids[0];
    const before = JSON.stringify(doc.pages[0].annots!.map((a) => (a as { rect: number[] }).rect));
    expect(actions.canUngroup()).toBe(true);
    actions.ungroupSelection();
    expect(doc.history.undoLabel).toBe('Ungroup');
    expect(viewer.objectSelection!.ids).toEqual([inner, 'c']);
    expect(JSON.stringify(doc.pages[0].annots!.map((a) => (a as { rect: number[] }).rect))).toBe(before);
    expect(doc.pages[0].annots!.filter((a) => a.groups?.length === 1).map((a) => a.id)).toEqual(['a', 'b']);
    doc.undo();
    expect(viewer.objectSelection).not.toBeNull();
    expect(doc.pages[0].annots!.find((a) => a.id === 'a')!.groups).toEqual([outer, inner]);
  });

  it('a group is copied, pasted (on another page too), duplicated, moved and deleted as a whole', () => {
    const { doc, viewer, actions } = setup();
    viewer.selectObjects({ pageId: 'p0', ids: ['a', 'b'] });
    actions.groupSelection();
    actions.copyAnnotation();
    viewer.currentIndex = 1;
    actions.pasteAnnotation();
    expect(order(doc, 1)).toBe('a* b*');
    expect(doc.history.undoLabel).toBe('Paste group (2 objects)');
    expect(unitsIn(doc.pages[1].annots!)).toHaveLength(1);
    expect(unitsIn(doc.pages[1].annots!)[0]).not.toBe(unitsIn(doc.pages[0].annots!)[0]);
    viewer.selectObjects({ pageId: 'p0', ids: [unitsIn(doc.pages[0].annots!)[0]] });
    actions.duplicateAnnotation();
    expect(order(doc)).toBe('a* b* a* b* c d');
    actions.moveSelectedLayer('front');
    expect(order(doc)).toBe('a* b* c d a* b*');
    actions.deleteSelection();
    expect(order(doc)).toBe('a* b* c d');
    expect(doc.history.undoLabel).toBe('Delete group (2 objects)');
  });
});
