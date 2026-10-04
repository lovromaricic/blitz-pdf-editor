import { describe, expect, it } from 'vitest';
import { hsvToRgb, parseHex, quantize, rgbToHsv, toHex } from '../src/lib/color';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

describe('parseHex', () => {
  it('accepts 6 and 3 digits, with or without #, any case', () => {
    expect(toHex(parseHex('#3F6FE0')!)).toBe('#3F6FE0');
    expect(toHex(parseHex('3f6fe0')!)).toBe('#3F6FE0');
    expect(toHex(parseHex('#36e')!)).toBe('#3366EE');
    expect(toHex(parseHex('36E')!)).toBe('#3366EE');
    expect(toHex(parseHex('  #abc  ')!)).toBe('#AABBCC');
    close(parseHex('#ffffff')!, [1, 1, 1]);
    close(parseHex('000')!, [0, 0, 0]);
  });

  it('rejects anything else', () => {
    for (const bad of ['', '#', '#12', '#1234', '#12345', '#1234567', 'ggg', '#3F6FE', 'red', 'rgb(1,2,3)', '##3F6FE0']) {
      expect(parseHex(bad), bad).toBeNull();
    }
  });
});

describe('HSV and RGB', () => {
  it('converts the corners and primary hues', () => {
    close(hsvToRgb({ h: 0, s: 0, v: 0 }), [0, 0, 0]);
    close(hsvToRgb({ h: 0, s: 0, v: 1 }), [1, 1, 1]);
    close(hsvToRgb({ h: 0, s: 1, v: 1 }), [1, 0, 0]);
    close(hsvToRgb({ h: 120, s: 1, v: 1 }), [0, 1, 0]);
    close(hsvToRgb({ h: 240, s: 1, v: 1 }), [0, 0, 1]);
    close(hsvToRgb({ h: 60, s: 1, v: 1 }), [1, 1, 0]);
    close(hsvToRgb({ h: 360, s: 1, v: 1 }), [1, 0, 0]);
    close(hsvToRgb({ h: 0, s: 0, v: 0.5 }), [0.5, 0.5, 0.5]);
  });

  it('matches known values', () => {
    // #3F6FE0 is about hsv(222.11°, 71.875%, 87.84%).
    expect(toHex(quantize(hsvToRgb({ h: 222.11, s: 0.71875, v: 0.8784 })))).toBe('#3F6FE0');
    expect(toHex(hsvToRgb({ h: 30, s: 1, v: 1 }))).toBe('#FF8000');
    expect(toHex(hsvToRgb({ h: 300, s: 0.5, v: 0.5 }))).toBe('#804080');
  });

  it('round-trips through HSV', () => {
    for (const hex of ['#3F6FE0', '#D92D20', '#12A150', '#000000', '#FFFFFF', '#808080', '#FFFF00']) {
      expect(toHex(quantize(hsvToRgb(rgbToHsv(parseHex(hex)!))))).toBe(hex);
    }
  });
});
