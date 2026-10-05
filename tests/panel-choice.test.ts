import { describe, expect, it } from 'vitest';
import type { Annotation } from '../src/lib/annotations';
import { markupPanelFor } from '../src/lib/panel-choice';

const text = { id: 't', type: 'text', text: 'Hi', font: 'roboto', size: 12, color: [0, 0, 0], opacity: 1, rotate: 0, rect: [0, 0, 10, 10] } as Annotation;
const stamp = { id: 's', type: 'stamp', label: 'OK', color: [1, 0, 0], opacity: 1, rotate: 0, rect: [0, 0, 10, 10] } as Annotation;

describe('properties panel choice', () => {
  it('a text box selected and being edited: the Text panel', () => {
    expect(markupPanelFor(text, 'select', true)).toBe('text');
  });

  it('being edited shows Text even if the selection were lost (it never depends on focus)', () => {
    expect(markupPanelFor(null, 'select', true)).toBe('text');
  });

  it('a selected object shows its own panel; with the Select tool and nothing selected, none (the Document panel)', () => {
    expect(markupPanelFor(text, 'select', false)).toBe('text');
    expect(markupPanelFor(stamp, 'select', false)).toBe('stamp');
    expect(markupPanelFor(null, 'select', false)).toBeNull();
  });

  it('with nothing selected, the active tool decides', () => {
    expect(markupPanelFor(null, 'text', false)).toBe('text');
    expect(markupPanelFor(null, 'highlight', false)).toBe('vector');
  });
});
