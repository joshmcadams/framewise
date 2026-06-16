import {describe, expect, it} from 'vitest';
import {spring} from './spring';

const fps = 30;

describe('spring', () => {
  it('starts at the `from` value at frame 0', () => {
    expect(spring({frame: 0, fps})).toBe(0);
    expect(spring({frame: 0, fps, from: 10, to: 20})).toBe(10);
  });

  it('settles at the `to` value after enough time', () => {
    expect(spring({frame: 300, fps})).toBeCloseTo(1, 4);
    expect(spring({frame: 300, fps, from: 10, to: 20})).toBeCloseTo(20, 3);
  });

  it('overshoots past `to` with the default (underdamped) config', () => {
    const values = Array.from({length: 90}, (_, f) => spring({frame: f, fps}));
    const max = Math.max(...values);
    expect(max).toBeGreaterThan(1);
  });

  it('never exceeds `to` when overshootClamping is on', () => {
    const values = Array.from({length: 90}, (_, f) =>
      spring({frame: f, fps, config: {overshootClamping: true}}),
    );
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });

  it('rises monotonically before the first overshoot peak', () => {
    let prev = -Infinity;
    for (let f = 0; f <= 8; f++) {
      const v = spring({frame: f, fps});
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('delays the animation by `delay` frames', () => {
    // With delay=10, frame 10 should equal frame 0 without delay (both 0).
    expect(spring({frame: 10, fps, delay: 10})).toBe(0);
    // And frame 5 (before the delay elapses) is also clamped to the start.
    expect(spring({frame: 5, fps, delay: 10})).toBe(0);
  });

  it('throws on non-positive damping', () => {
    expect(() => spring({frame: 5, fps, config: {damping: 0}})).toThrow(/damping/);
  });
});
