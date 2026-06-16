import {describe, expect, it} from 'vitest';
import {interpolate} from './interpolate';

describe('interpolate', () => {
  it('maps linearly across a single segment', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(0, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(10, [0, 10], [0, 100])).toBe(100);
  });

  it('defaults to "extend" (extrapolates past the range, does NOT clamp)', () => {
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(-50);
    expect(interpolate(15, [0, 10], [0, 100])).toBe(150);
  });

  it('clamps when asked', () => {
    expect(interpolate(15, [0, 10], [0, 100], {extrapolateRight: 'clamp'})).toBe(100);
    expect(interpolate(-5, [0, 10], [0, 100], {extrapolateLeft: 'clamp'})).toBe(0);
  });

  it('returns the raw input with "identity"', () => {
    expect(interpolate(-5, [0, 10], [0, 100], {extrapolateLeft: 'identity'})).toBe(-5);
  });

  it('wraps with "wrap"', () => {
    // 15 wraps to 5 within [0,10] -> 50
    expect(interpolate(15, [0, 10], [0, 100], {extrapolateRight: 'wrap'})).toBe(50);
  });

  it('supports multiple segments (keyframes)', () => {
    const range = [0, 10, 20];
    const output = [0, 100, 0];
    expect(interpolate(5, range, output)).toBe(50);
    expect(interpolate(10, range, output)).toBe(100);
    expect(interpolate(15, range, output)).toBe(50);
  });

  it('applies easing within the normalized segment', () => {
    const square = (t: number) => t * t;
    // normalized 0.5 -> eased 0.25 -> output 25
    expect(interpolate(5, [0, 10], [0, 100], {easing: square})).toBe(25);
  });

  it('returns the only output for a single-element range', () => {
    expect(interpolate(99, [5], [42])).toBe(42);
  });

  it('throws on a non-monotonic input range', () => {
    expect(() => interpolate(5, [0, 0], [0, 100])).toThrow(/strictly monotonically/);
    expect(() => interpolate(5, [10, 0], [0, 100])).toThrow(/strictly monotonically/);
  });

  it('throws on mismatched range lengths', () => {
    expect(() => interpolate(5, [0, 10], [0, 100, 200])).toThrow(/same length/);
  });
});
