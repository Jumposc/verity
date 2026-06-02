import { describe, expect, test } from 'vitest';
import { deltaE, figmaColor, parseColor, toHex } from './color';

describe('parseColor', () => {
  test('parses hex to 0-255 channels', () => {
    expect(parseColor('#1473E6')).toEqual({ r: 20, g: 115, b: 230, a: 1 });
  });

  test('parses rgba with alpha', () => {
    expect(parseColor('rgba(255, 255, 255, 0.5)')).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.5,
    });
  });

  test('parses transparent to alpha 0', () => {
    expect(parseColor('transparent')?.a).toBe(0);
  });

  test('returns null for non-color', () => {
    expect(parseColor('not-a-color')).toBeNull();
  });
});

describe('figmaColor', () => {
  test('scales 0-1 floats to 0-255 channels', () => {
    expect(figmaColor({ r: 1, g: 0, b: 0, a: 1 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  test('defaults alpha to 1 when omitted', () => {
    expect(figmaColor({ r: 0, g: 0, b: 0 }).a).toBe(1);
  });
});

describe('toHex', () => {
  test('formats opaque color as 6-digit uppercase hex', () => {
    expect(toHex({ r: 20, g: 115, b: 230, a: 1 })).toBe('#1473E6');
  });

  test('pads single-digit channels', () => {
    expect(toHex({ r: 0, g: 0, b: 0, a: 1 })).toBe('#000000');
  });

  test('appends alpha as 8-digit hex when translucent', () => {
    expect(toHex({ r: 0, g: 0, b: 0, a: 0 })).toBe('#00000000');
  });
});

describe('deltaE (CIEDE2000)', () => {
  test('is 0 for identical colors', () => {
    const c = { r: 20, g: 115, b: 230, a: 1 };
    expect(deltaE(c, c)).toBe(0);
  });

  test('is large for white vs black', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(deltaE(white, black)).toBeGreaterThan(95);
  });

  test('is small for two close blues', () => {
    const d = deltaE(
      { r: 20, g: 115, b: 230, a: 1 }, // #1473E6
      { r: 26, g: 123, b: 240, a: 1 }, // #1A7BF0
    );
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(5);
  });
});
