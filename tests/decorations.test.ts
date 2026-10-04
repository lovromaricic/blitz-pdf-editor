import { describe, expect, it } from 'vitest';
import { displayedToPdf, layoutDecoration } from '../src/lib/decorations';
import { pageNumberLabels } from '../src/lib/settings';

const widthAt1 = (t: string) => t.length * 0.5;

describe('page number labels', () => {
  it('numbers from a chosen page, following the current order', () => {
    const labels = pageNumberLabels(['a', 'b', 'c', 'd'], { position: 'bottom-center', format: 'page-n-of-total', firstNumber: 1, fromPage: 2, size: 10 });
    expect([...labels.entries()]).toEqual([
      ['b', 'Page 1 of 3'],
      ['c', 'Page 2 of 3'],
      ['d', 'Page 3 of 3'],
    ]);
  });
});

describe('layoutDecoration', () => {
  it('centers a horizontal watermark and keeps it within a quarter of the height', () => {
    const [w] = layoutDecoration(600, 800, { watermark: { text: 'DRAFT', size: 'medium', color: [0, 0, 0], opacity: 0.2, angle: 0 } }, widthAt1);
    const textW = 2.5 * w.size;
    expect(w.x + textW / 2).toBeCloseTo(300);
    expect(w.size).toBeLessThanOrEqual(200);
  });

  it('places bottom-right numbers inside the margin', () => {
    const [n] = layoutDecoration(600, 800, { number: { text: '12', size: 10, position: 'bottom-right' } }, widthAt1);
    expect(n.x + 10).toBeCloseTo(600 - 24);
    expect(n.y).toBe(800 - 24);
  });
});

describe('displayedToPdf', () => {
  const box: [number, number, number, number] = [10, 20, 610, 820];
  it('maps the displayed top-left corner at every rotation', () => {
    expect(displayedToPdf(0, 0, box, 0)).toEqual([10, 820]);
    expect(displayedToPdf(0, 0, box, 90)).toEqual([10, 20]);
    expect(displayedToPdf(0, 0, box, 180)).toEqual([610, 20]);
    expect(displayedToPdf(0, 0, box, 270)).toEqual([610, 820]);
  });
});
