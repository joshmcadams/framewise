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

  it('wraps on the left edge too', () => {
    // -5 wraps to 5 within [0,10] -> 50
    expect(interpolate(-5, [0, 10], [0, 100], {extrapolateLeft: 'wrap'})).toBe(50);
  });

  it('snaps the input to the step with posterize', () => {
    // floor(7/5)*5 = 5 -> 50; floor(9/5)*5 = 5 -> 50; floor(12/5)*5 = 10 -> 100
    expect(interpolate(7, [0, 10], [0, 100], {posterize: 5})).toBe(50);
    expect(interpolate(9, [0, 10], [0, 100], {posterize: 5})).toBe(50);
    expect(interpolate(12, [0, 20], [0, 200], {posterize: 5})).toBe(100);
  });

  it('throws on a non-positive posterize step', () => {
    expect(() => interpolate(5, [0, 10], [0, 100], {posterize: 0})).toThrow(/posterize/);
    expect(() => interpolate(5, [0, 10], [0, 100], {posterize: -1})).toThrow(/posterize/);
  });

  it('throws when an easing array has the wrong number of segments', () => {
    // 3-point range = 2 segments, but only one easing function supplied.
    expect(() => interpolate(5, [0, 10, 20], [0, 1, 2], {easing: [(t) => t]})).toThrow(
      /one entry per segment/,
    );
  });
});

describe('interpolate — tuple outputs', () => {
  it('maps each lane independently', () => {
    expect(
      interpolate(
        5,
        [0, 10],
        [
          [0, -100],
          [100, -200],
        ],
      ),
    ).toEqual([50, -150]);
  });

  it('supports multiple segments and easing per segment', () => {
    const square = (t: number) => t * t;
    // Input 12.5 sits in the SECOND segment ([10, 20]); normalized 0.25,
    // eased to 0.0625, mapped between the second pair of lane tuples.
    expect(
      interpolate(
        12.5,
        [0, 10, 20],
        [
          [0, 0],
          [100, 200],
          [200, 400],
        ],
        {easing: square},
      ),
    ).toEqual([106.25, 212.5]);
    // And the first segment still eases with its own entry (t=0.5 → 0.25).
    expect(
      interpolate(
        5,
        [0, 10, 20],
        [
          [0, 0],
          [100, 200],
          [200, 400],
        ],
        {easing: square},
      ),
    ).toEqual([25, 50]);
  });

  it('extrapolates and clamps like the scalar path', () => {
    expect(
      interpolate(
        15,
        [0, 10],
        [
          [0, 0],
          [10, 20],
        ],
      ),
    ).toEqual([15, 30]);
    expect(
      interpolate(
        15,
        [0, 10],
        [
          [0, 0],
          [10, 20],
        ],
        {extrapolateRight: 'clamp'},
      ),
    ).toEqual([10, 20]);
  });

  it('wraps on the input side', () => {
    // 15 wraps to 5 within [0,10] -> half of each lane
    expect(
      interpolate(
        15,
        [0, 10],
        [
          [0, 0],
          [100, -40],
        ],
        {extrapolateRight: 'wrap'},
      ),
    ).toEqual([50, -20]);
  });

  it('keeps constant lanes constant while others animate', () => {
    expect(
      interpolate(
        5,
        [0, 10],
        [
          [7, 0, -3],
          [7, 100, -3],
        ],
      ),
    ).toEqual([7, 50, -3]);
  });

  it('copies the tuple for a single-element range', () => {
    expect(interpolate(99, [5], [[1, 2]])).toEqual([1, 2]);
  });

  it('rejects identity extrapolation', () => {
    expect(() => interpolate(15, [0, 10], [[0], [10]], {extrapolateRight: 'identity'})).toThrow(
      /identity/,
    );
  });

  it('throws on mismatched lane lengths, mixed shapes, and empty lanes', () => {
    expect(() => interpolate(5, [0, 10], [[0, 1], [2]])).toThrow(/same length/);
    // Deliberately ill-typed: mixing plain numbers into a tuple range.
    const mixed = [[0, 1], 5] as unknown as readonly (readonly number[])[];
    expect(() => interpolate(5, [0, 10], mixed)).toThrow(/must all be arrays/);
    expect(() => interpolate(5, [0, 10], [[], []])).toThrow(/non-empty/);
  });
});

describe('interpolate — string template outputs', () => {
  it('substitutes interpolated numbers into the template', () => {
    expect(interpolate(5, [0, 10], ['scale(0)', 'scale(2)'])).toBe('scale(1)');
    expect(interpolate(2.5, [0, 10], ['scale(0)', 'scale(2)'])).toBe('scale(0.5)');
  });

  it('interpolates every embedded value in multi-slot patterns', () => {
    expect(interpolate(0.5, [0, 1], ['translate(0px, 0deg)', 'translate(10px, -90deg)'])).toBe(
      'translate(5px, -45deg)',
    );
  });

  it('formats slots without floating-point noise', () => {
    // 1/3 through: 0 + (1-0)*1/3 = 0.333333... -> "0.3333"
    expect(interpolate(1 / 3, [0, 1], ['a(0)', 'a(1)'])).toBe('a(0.3333)');
  });

  it('clamps and eases like every other mode', () => {
    const square = (t: number) => t * t;
    expect(interpolate(5, [0, 10], ['x(0)', 'x(100)'], {easing: square})).toBe('x(25)');
    expect(interpolate(15, [0, 10], ['x(0)', 'x(100)'], {extrapolateRight: 'clamp'})).toBe(
      'x(100)',
    );
  });

  it('returns a zero-slot template as a constant', () => {
    expect(interpolate(42, [0, 10], ['none', 'none'])).toBe('none');
  });

  it('throws when templates disagree on slot count or constants differ', () => {
    expect(() => interpolate(5, [0, 10], ['scale(1)', 'translate(0px, 0px)'])).toThrow(
      /same number of embedded values/,
    );
    expect(() => interpolate(5, [0, 10], ['none', 'hidden'])).toThrow(/must be identical/);
  });
});
