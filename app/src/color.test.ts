import { describe, expect, it } from 'vitest';
import { cmykToHex, hexToCmyk, tintMaterial } from './color';
import { getMaterial } from './materials';

describe('cmyk', () => {
  it('converts the corners of the gamut', () => {
    expect(cmykToHex([0, 0, 0, 0])).toBe('#ffffff');
    expect(cmykToHex([0, 0, 0, 100])).toBe('#000000');
    expect(cmykToHex([100, 0, 0, 0])).toBe('#00ffff');
    expect(cmykToHex([0, 100, 100, 0])).toBe('#ff0000');
  });

  it('round-trips through hex', () => {
    const cmyk = hexToCmyk('#6e4e37');
    const back = cmykToHex(cmyk);
    expect(back).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToCmyk(back)).toEqual(cmyk);
  });

  it('tints a wood while keeping its grain darker than the base', () => {
    const t = tintMaterial(getMaterial('hinoki'), '#c08040');
    expect(t.id).toBe('hinoki@#c08040');
    expect(t.color).toBe('#c08040');
    expect(parseInt(t.accent.slice(1, 3), 16)).toBeLessThan(0xc0);
    expect(t.density).toBe(getMaterial('hinoki').density);
  });
});
