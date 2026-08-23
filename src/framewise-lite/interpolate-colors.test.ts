import {describe, expect, it} from 'vitest';
import {Easing} from './easing';
import {interpolateColors} from './interpolate-colors';

describe('interpolateColors', () => {
  it('blends two colors at the midpoint', () => {
    // Red → blue at halfway: channels meet in the middle.
    expect(interpolateColors(0.5, [0, 1], ['#ff0000', '#0000ff'])).toBe('rgba(128, 0, 128, 1)');
  });

  it('parses every supported format and mixes them freely', () => {
    // Same endpoints in different notations produce identical results.
    const expected = interpolateColors(0.25, [0, 1], ['#ff0000', 'rgb(0, 0, 255)']);
    expect(interpolateColors(0.25, [0, 1], ['rgba(255, 0, 0, 1)', '#0000ffff'])).toBe(expected);
  });

  it('expands short hex notation', () => {
    expect(interpolateColors(0, [0, 1], ['#f00', '#f00'])).toBe('rgba(255, 0, 0, 1)');
  });

  it('interpolates alpha separately from color', () => {
    expect(interpolateColors(0.5, [0, 1], ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 1)'])).toBe(
      'rgba(0, 0, 0, 0.5)',
    );
  });

  it('converts hsl to rgb before mixing', () => {
    // hsl(0, 100%, 50%) is pure red; hsl(240, 100%, 50%) is pure blue.
    expect(interpolateColors(0, [0, 1], ['hsl(0, 100%, 50%)', 'hsl(240, 100%, 50%)'])).toBe(
      'rgba(255, 0, 0, 1)',
    );
    expect(interpolateColors(1, [0, 1], ['hsl(0, 100%, 50%)', 'hsl(240, 100%, 50%)'])).toBe(
      'rgba(0, 0, 255, 1)',
    );
  });

  it('supports multiple segments (keyframes)', () => {
    const out = interpolateColors(0.75, [0, 0.5, 1], ['#000000', '#ffffff', '#000000']);
    // Second segment [0.5 → 1] at t=0.5: white back to black halfway = grey.
    expect(out).toBe('rgba(128, 128, 128, 1)');
  });

  it('applies easing within the segment', () => {
    // Easing.out(cubic) at input 0.5: 1-(1-0.5)^3 = 0.875 → 87.5% toward blue.
    expect(
      interpolateColors(0.5, [0, 1], ['#ff0000', '#0000ff'], {easing: Easing.out(Easing.cubic)}),
    ).toBe('rgba(32, 0, 223, 1)');
  });

  it('defaults to extend past the range and clamps when asked', () => {
    // Extend: the mix continues linearly beyond the range, but formatColor
    // clamps the RESULT into gamut — the string is always valid CSS (browsers
    // would silently clamp anyway; canvas/CSS-in-JS/downstream parsers
    // reject it), while the underlying math stays extend.
    expect(interpolateColors(-1, [0, 1], ['#ff0000', '#0000ff'])).toBe('rgba(255, 0, 0, 1)');
    expect(interpolateColors(2, [0, 1], ['#ff0000', '#0000ff'])).toBe('rgba(0, 0, 255, 1)');
    expect(interpolateColors(2, [0, 1], ['#ff0000', '#0000ff'], {extrapolateRight: 'clamp'})).toBe(
      'rgba(0, 0, 255, 1)',
    );
  });

  it('clamps alpha so extended fades stay valid CSS', () => {
    // alpha extrapolates to 2 at input 2 — invalid everywhere if emitted.
    expect(interpolateColors(2, [0, 1], ['rgba(0,0,0,0)', 'rgba(0,0,0,1)'])).toBe(
      'rgba(0, 0, 0, 1)',
    );
  });

  it.each([
    ['hsl(240, 100%, 50%)'],
    ['HSL(240, 100%, 50%)'],
    ['rgb(0, 0, 255)'],
    ['RGB(0, 0, 255)'],
  ])('parses %s identically regardless of case', (color) => {
    expect(interpolateColors(0.5, [0, 1], [color, '#fff'])).toBe('rgba(128, 128, 255, 1)');
  });

  it('rejects empty rgb components instead of parsing them as 0', () => {
    expect(() => interpolateColors(0, [0, 1], ['rgb(, , )', '#fff'])).toThrow(/Invalid rgb/);
    expect(() => interpolateColors(0, [0, 1], ['rgb(255,, 0)', '#fff'])).toThrow(/Invalid rgb/);
  });

  it('returns a single-element range as-is', () => {
    expect(interpolateColors(99, [5], ['#123456'])).toBe('rgba(18, 52, 86, 1)');
  });

  it('throws on unsupported colors and malformed ranges', () => {
    expect(() => interpolateColors(0, [0, 1], ['rebeccapurple', '#0000ff'])).toThrow(/Supported/);
    expect(() => interpolateColors(0, [0, 1], ['hsl(0, 100%, 50%)', '#gggggg'])).toThrow(
      /Supported/,
    );
    expect(() => interpolateColors(0, [0, 0], ['#000000', '#ffffff'])).toThrow(/monotonically/);
    expect(() => interpolateColors(0, [0, 1], ['#000000'])).toThrow(/same length/);
  });

  it('rejects extrapolation modes that make no sense for colors', () => {
    // The type system already forbids these; cast to exercise the runtime
    // guard (relevant for JS callers).
    const identity = 'identity' as unknown as 'extend';
    const wrap = 'wrap' as unknown as 'extend';
    expect(() =>
      interpolateColors(5, [0, 1], ['#000000', '#ffffff'], {extrapolateRight: identity}),
    ).toThrow(/only 'extend' and 'clamp'/);
    expect(() =>
      interpolateColors(5, [0, 1], ['#000000', '#ffffff'], {extrapolateRight: wrap}),
    ).toThrow(/only 'extend' and 'clamp'/);
  });
});
