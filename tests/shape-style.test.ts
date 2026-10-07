import { describe, expect, it } from 'vitest';
import { bounds, type ShapeAnnotation } from '../src/lib/annotations';
import { outlineOf, withFill, withOutline } from '../src/lib/shape-style';
import { toPrimitives } from '../src/lib/annotation-view';

const RED: [number, number, number] = [0.8, 0, 0];
const BLUE: [number, number, number] = [0, 0, 0.8];
const rect = (over: Partial<ShapeAnnotation> = {}): ShapeAnnotation => ({
  id: 's',
  type: 'shape',
  shape: 'rect',
  color: RED,
  fill: BLUE,
  width: 4,
  opacity: 1,
  from: [100, 100],
  to: [200, 160],
  ...over,
});

describe('outline and fill of a closed shape', () => {
  it('no outline: kept color and thickness; a color brings it back as it was', () => {
    const off = withOutline(rect(), null) as ShapeAnnotation;
    expect(off.noOutline).toBe(true);
    expect([off.color, off.width]).toEqual([RED, 4]);
    const on = withOutline(off, BLUE) as ShapeAnnotation;
    expect(on.noOutline).toBeUndefined();
    expect([on.color, on.width]).toEqual([BLUE, 4]);
  });

  it('never both none: the second "none" is refused, whichever comes second', () => {
    expect(withOutline(rect({ fill: null }), null)).toBe('invisible');
    expect(withFill(rect({ noOutline: true }), null)).toBe('invisible');
    // One at a time is fine.
    expect((withFill(rect(), null) as ShapeAnnotation).fill).toBeNull();
    expect((withOutline(rect(), null) as ShapeAnnotation).noOutline).toBe(true);
  });

  it('several shapes: one color, all without an outline, or mixed', () => {
    expect(outlineOf([rect(), rect()])).toEqual({ value: RED, mixed: false });
    expect(outlineOf([rect({ noOutline: true }), rect({ noOutline: true })])).toEqual({ value: null, mixed: false });
    expect(outlineOf([rect(), rect({ noOutline: true })])).toEqual({ value: null, mixed: true });
    expect(outlineOf([rect(), rect({ color: BLUE })])).toEqual({ value: null, mixed: true });
  });

  it('without an outline the bounds are the shape itself; with one they include half its width', () => {
    expect(bounds(rect())).toEqual([98, 98, 202, 162]);
    expect(bounds(rect({ noOutline: true }))).toEqual([100, 100, 200, 160]);
  });

  it('drawing: no outline, nothing around the shape; neither fill nor outline (an older file) stays clickable but invisible', () => {
    const id = (p: [number, number]): [number, number] => p;
    expect(toPrimitives(rect({ noOutline: true }), id, 1).map((p) => p.kind)).toEqual(['polygon']);
    const ell = toPrimitives(rect({ shape: 'ellipse', noOutline: true }), id, 1)[0];
    expect(ell).toMatchObject({ kind: 'ellipse', stroke: null });
    const ghost = toPrimitives(rect({ fill: null, noOutline: true }), id, 1);
    expect(ghost).toEqual([expect.objectContaining({ kind: 'polygon', opacity: 0 })]);
  });
});
