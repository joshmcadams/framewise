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

  it('clamps overshoot against a non-default `to` (not just to === 1)', () => {
    // Regression: the default underdamped spring overshoots ~16%, which would
    // map to ~116 without clamping. overshootClamping must hold it to <= 100.
    const values = Array.from({length: 90}, (_, f) =>
      spring({frame: f, fps, from: 0, to: 100, config: {overshootClamping: true}}),
    );
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
    // And it still actually reaches the target.
    expect(
      spring({frame: 300, fps, from: 0, to: 100, config: {overshootClamping: true}}),
    ).toBeCloseTo(100, 3);
  });

  it('clamps undershoot for a descending spring (from > to)', () => {
    const values = Array.from({length: 90}, (_, f) =>
      spring({frame: f, fps, from: 100, to: 0, config: {overshootClamping: true}}),
    );
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
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

describe('spring — fractional frames', () => {
  it('lies between integer neighbors during the initial monotonic rise', () => {
    const v5 = spring({frame: 5, fps});
    const v6 = spring({frame: 6, fps});
    const v5_5 = spring({frame: 5.5, fps});
    expect(v5_5).toBeGreaterThanOrEqual(v5);
    expect(v5_5).toBeLessThanOrEqual(v6);
  });

  it('is continuous near integer boundaries', () => {
    const v6 = spring({frame: 6, fps});
    const v5_999999 = spring({frame: 5.999999, fps});
    expect(v5_999999).toBeCloseTo(v6, 1);

    const v5 = spring({frame: 5, fps});
    const v5_000001 = spring({frame: 5.000001, fps});
    expect(v5_000001).toBeCloseTo(v5, 1);
  });

  it('returns the same value before and after the integer chain is extended (fractional-first)', () => {
    const freshConfig = {stiffness: 100.001};
    const first = spring({frame: 5.5, fps, config: freshConfig});
    for (let f = 0; f <= 10; f++) {
      spring({frame: f, fps, config: freshConfig});
    }
    const second = spring({frame: 5.5, fps, config: freshConfig});
    expect(second).toBe(first);
  });

  it('respects delay on fractional frames', () => {
    expect(spring({frame: 10.5, fps, delay: 10})).toBe(spring({frame: 0.5, fps}));
  });

  it('maps from/to correctly for fractional frames', () => {
    const normalized = spring({frame: 5.5, fps});
    const mapped = spring({frame: 5.5, fps, from: 10, to: 20});
    expect(mapped).toBeCloseTo(10 + normalized * 10, 10);
  });

  it('clamps overshoot at fractional frames when overshootClamping is on', () => {
    let peakFrame = 0.5;
    let peakValue = -Infinity;
    for (let f = 0; f <= 30; f++) {
      const frame = f + 0.5;
      const v = spring({frame, fps});
      if (v > peakValue) {
        peakValue = v;
        peakFrame = frame;
      }
    }
    expect(peakValue).toBeGreaterThan(1);
    const clampedValue = spring({frame: peakFrame, fps, config: {overshootClamping: true}});
    expect(clampedValue).toBeLessThanOrEqual(1);
  });

  it('clamps negative frames to 0', () => {
    expect(spring({frame: -0.5, fps})).toBe(spring({frame: 0, fps}));
  });
});
