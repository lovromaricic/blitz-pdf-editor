import { describe, expect, it } from 'vitest';
import { acceptAttr, dragLooksValid, kindOf, splitFiles } from '../src/lib/landing/accepted-files';
import { carriesFiles, IDLE, isOver, nextDrag, type DragInput, type DragState } from '../src/lib/landing/drag-state';

const run = (events: DragInput[], from: DragState = IDLE) => events.reduce(nextDrag, from);
const enter: DragInput = { kind: 'enter', files: true };
const leave: DragInput = { kind: 'leave', files: true };

describe('drag counter', () => {
  it('stays charged while the cursor crosses elements', () => {
    // window → panel → button → panel: enter/leave pairs overlap, never reaching 0.
    let s = run([enter, enter, leave, enter, leave]);
    expect(isOver(s)).toBe(true);
    s = run([leave], s);
    expect(isOver(s)).toBe(false);
  });

  it('resets when the drag leaves the window, and charges again when it comes back', () => {
    let s = run([enter, enter]);
    s = nextDrag(s, { kind: 'leave', files: true, leftWindow: true });
    expect(s).toEqual(IDLE);
    s = run([enter], s);
    expect(isOver(s)).toBe(true);
  });

  it('never goes below zero', () => {
    expect(run([leave, leave])).toEqual(IDLE);
    expect(isOver(run([leave, enter]))).toBe(true);
  });

  it('a drop or the end of the drag returns to idle', () => {
    expect(run([enter, enter, { kind: 'drop', files: true }])).toEqual(IDLE);
    expect(run([enter, { kind: 'end', files: false }])).toEqual(IDLE);
  });

  it('ignores drags without files (selected text, links, images from other pages)', () => {
    const text: DragInput = { kind: 'enter', files: false };
    expect(run([text, text])).toEqual(IDLE);
    expect(carriesFiles(['text/plain', 'text/html'])).toBe(false);
    expect(carriesFiles(['text/uri-list'])).toBe(false);
    expect(carriesFiles(['Files'])).toBe(true);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe('accepted files', () => {
  const f = (name: string, type = '') => ({ name, type });

  it('accepts PDFs, JPG, PNG and WebP by type or extension', () => {
    expect(kindOf(f('a.pdf', 'application/pdf'))).toBe('pdf');
    expect(kindOf(f('Report.PDF'))).toBe('pdf');
    expect(kindOf(f('photo.jpg', 'image/jpeg'))).toBe('image');
    expect(kindOf(f('photo.jpeg'))).toBe('image');
    expect(kindOf(f('scan.png', 'image/png'))).toBe('image');
    expect(kindOf(f('pic.webp', 'image/webp'))).toBe('image');
  });

  it('rejects unsupported types', () => {
    expect(kindOf(f('notes.txt', 'text/plain'))).toBeNull();
    expect(kindOf(f('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull();
    expect(kindOf(f('anim.gif', 'image/gif'))).toBeNull();
  });

  it('accepts HEIC only where the browser can decode it', () => {
    expect(kindOf(f('IMG_1.HEIC', 'image/heic'))).toBeNull();
    expect(kindOf(f('IMG_1.HEIC', 'image/heic'), true)).toBe('image');
    expect(acceptAttr()).not.toContain('heic');
    expect(acceptAttr(true)).toContain('image/heic');
  });

  it('splits a mix in the original order', () => {
    const files = [f('a.pdf', 'application/pdf'), f('x.txt', 'text/plain'), f('b.jpg', 'image/jpeg'), f('c.png', 'image/png'), f('y.zip', 'application/zip')];
    const { accepted, rejected } = splitFiles(files);
    expect(accepted.map((x) => x.name)).toEqual(['a.pdf', 'b.jpg', 'c.png']);
    expect(rejected.map((x) => x.name)).toEqual(['x.txt', 'y.zip']);
  });

  it('the picker lists exactly the supported types', () => {
    expect(acceptAttr().split(',')).toEqual(['application/pdf', '.pdf', 'image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp']);
  });

  it('charges during a drag only if an item could be supported', () => {
    expect(dragLooksValid([{ kind: 'file', type: 'application/pdf' }])).toBe(true);
    expect(dragLooksValid([{ kind: 'file', type: 'text/plain' }])).toBe(false);
    expect(dragLooksValid([{ kind: 'file', type: 'text/plain' }, { kind: 'file', type: 'image/png' }])).toBe(true);
    // Safari hides types while dragging: give it the benefit of the doubt.
    expect(dragLooksValid([{ kind: 'file', type: '' }])).toBe(true);
  });
});

describe('absorb timeline', async () => {
  const { ABSORB, AbsorbTimeline } = await import('../src/lib/landing/absorb-timeline');

  it('reaches its finished state and calls back exactly once', () => {
    let calls = 0;
    const tl = new AbsorbTimeline(() => calls++);
    for (let t = 0; t < 2; t += 1 / 60) tl.advance(1 / 60);
    expect(tl.finished).toBe(true);
    expect(calls).toBe(1);
    tl.advance(1);
    tl.advance(0);
    expect(calls).toBe(1);
  });

  it('finishes once even when one big step jumps past the end', () => {
    let calls = 0;
    const tl = new AbsorbTimeline(() => calls++);
    tl.advance(5);
    tl.advance(5);
    expect(tl.finished).toBe(true);
    expect(calls).toBe(1);
  });

  it('is not finished before about 1.2 s', () => {
    let calls = 0;
    const tl = new AbsorbTimeline(() => calls++);
    tl.advance(ABSORB.doneAt - 0.01);
    expect(tl.finished).toBe(false);
    expect(calls).toBe(0);
  });

  it('follows the prototype timings: stagger, travel, top page growth, fade', () => {
    const tl = new AbsorbTimeline(() => {});
    tl.advance(0.1);
    expect(tl.sheet(0, 46)).toBeGreaterThan(0); // sheet 0 starts at once
    expect(tl.sheet(45, 46)).toBe(0); // the last waits for the stagger (about 0.2 s)
    tl.advance(0.6); // t = 0.7
    expect(tl.sheet(0, 46)).toBe(1); // 0.5 s travel
    expect(tl.sheet(45, 46)).toBeGreaterThan(0.9);
    expect(tl.hero).toBe(0); // growth starts at 0.72 s
    expect(tl.fade).toBe(0);
    tl.advance(0.12); // t = 0.82
    expect(tl.fade).toBeCloseTo(0.5, 5); // others fade over 0.2 s
    expect(tl.hero).toBeCloseTo(0.25, 5); // the top page grows over 0.4 s
    tl.advance(0.31); // t = 1.13 (growth ends at 1.12 s)
    expect(tl.hero).toBe(1);
    expect(tl.fade).toBe(1);
  });
});
