import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BoxedView from '../src/editor/BoxedView.svelte';
import type { BoxedAnnotation, Point } from '../src/lib/annotations';

const stamp: BoxedAnnotation = { id: 's', type: 'stamp', label: 'APPROVED', color: [0.08, 0.45, 0.16], opacity: 1, rotate: 0, rect: [100, 100, 220, 130] };

describe('stamp on screen', () => {
  it('has no outline other than its own colored border', () => {
    const { body } = render(BoxedView, { props: { a: stamp, toScreen: (p: Point) => p, scale: 1, pageRotation: 0 } });
    const outer = /<div class="boxed[^"]*"[^>]*>/.exec(body)![0];
    // The container must not carry the "stamp" class: that matched the stamp face's
    // `border-style: solid` and drew a default dark 3px border around every stamp.
    expect(outer).not.toMatch(/class="[^"]*\bstamp\b/);
    expect(outer).toContain('data-kind="stamp"');
    expect(outer).not.toMatch(/border|outline/);
    // The one border: the stamp face, in the stamp's own color.
    const faces = body.match(/class="stamp[ "]/g) ?? [];
    expect(faces).toHaveLength(1);
    expect(body).toMatch(/border-color: rgb\(20 115 41\)/);
  });
});
