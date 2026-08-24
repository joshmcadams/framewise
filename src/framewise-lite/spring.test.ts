import {describe, expect, it} from 'vitest';
import {measureSpring, spring, springCacheKeysForTest} from './spring';

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

describe('measureSpring', () => {
  it('pins the default config at 30 fps (characterization)', () => {
    // 33 frames ≈ 1.1 s until consecutive positions differ by < 0.0005.
    expect(measureSpring({fps})).toEqual({maxFrameDuration: 33});
  });

  it('is deterministic regardless of which chains the cache already holds', () => {
    const first = measureSpring({fps});
    // Extend a different config's chain, then re-measure.
    spring({frame: 200, fps, config: {damping: 5}});
    expect(measureSpring({fps})).toEqual(first);
  });

  it('stiffer springs settle sooner', () => {
    expect(measureSpring({fps, config: {stiffness: 200}}).maxFrameDuration).toBeLessThan(
      measureSpring({fps}).maxFrameDuration,
    );
  });

  it('more damping settles sooner', () => {
    expect(measureSpring({fps, config: {damping: 20}}).maxFrameDuration).toBeLessThan(
      measureSpring({fps}).maxFrameDuration,
    );
  });

  it('ignores overshootClamping (it clamps output, not the normalized chain)', () => {
    expect(measureSpring({fps, config: {overshootClamping: true}})).toEqual(measureSpring({fps}));
  });

  it('a smaller threshold measures longer', () => {
    expect(measureSpring({fps, threshold: 0.00005}).maxFrameDuration).toBeGreaterThanOrEqual(
      measureSpring({fps}).maxFrameDuration,
    );
  });

  it('needs more frames at higher fps — but sublinearly', () => {
    // Measurement stops at the first frame whose consecutive-sample delta
    // drops under the threshold. Smaller steps sample a smoother curve, so
    // the delta shrinks faster than the frame count grows: 60 fps needs more
    // frames than 30 fps, but less than twice as many.
    const at60 = measureSpring({fps: 60}).maxFrameDuration;
    const at30 = measureSpring({fps: 30}).maxFrameDuration;
    expect(at60).toBeGreaterThan(at30);
    expect(at60 / at30).toBeLessThan(2);
  });

  it('throws on invalid fps or threshold', () => {
    expect(() => measureSpring({fps: 0})).toThrow(/fps/);
    expect(() => measureSpring({fps, threshold: -1})).toThrow(/threshold/);
  });
});

describe('spring — durationInFrames', () => {
  it('settles at `to` around the requested frame', () => {
    const duration = 45;
    expect(spring({frame: duration, fps, durationInFrames: duration})).toBeCloseTo(1, 2);
  });

  it('advances toward `to` across the requested window', () => {
    const duration = 40;
    // Starts exactly at `from`…
    expect(spring({frame: 0, fps, durationInFrames: duration})).toBe(0);
    // …is further along late in the window than early (critically damped so
    // the rise is monotonic — an underdamped spring legitimately overshoots
    // mid-window)…
    const early = spring({frame: 10, fps, durationInFrames: duration, config: {damping: 20}});
    const late = spring({frame: 36, fps, durationInFrames: duration, config: {damping: 20}});
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThan(1);
    // …and has settled by the end.
    expect(spring({frame: duration, fps, durationInFrames: duration})).toBeCloseTo(1, 2);
  });

  it('stretches slower as durationInFrames grows', () => {
    const quick = spring({frame: 15, fps, durationInFrames: 30});
    const slow = spring({frame: 15, fps, durationInFrames: 90});
    expect(slow).toBeLessThan(quick);
    expect(slow).toBeGreaterThan(0);
  });

  it('compresses into fewer frames than the natural run', () => {
    const natural = measureSpring({fps}).maxFrameDuration;
    const compressed = 10;
    expect(compressed).toBeLessThan(natural);
    expect(spring({frame: compressed, fps, durationInFrames: compressed})).toBeCloseTo(1, 1);
  });

  it('works for descending ranges (from > to)', () => {
    // Without clamping the underdamped spring legitimately overshoots just
    // past `to`; with clamping it lands on it.
    const value = spring({
      frame: 40,
      fps,
      from: 100,
      to: 0,
      durationInFrames: 40,
      config: {overshootClamping: true},
    });
    expect(value).toBeCloseTo(0, 2);
  });

  it('honors delay inside the warped window', () => {
    // Delay shifts the outer timeline before the warp: frame 10 with delay 10
    // is still the very start of the animation.
    expect(spring({frame: 10, fps, delay: 10, durationInFrames: 20})).toBe(0);
  });

  it('throws on invalid durationInFrames', () => {
    for (const bad of [0, -3, 2.5]) {
      expect(() => spring({frame: 5, fps, durationInFrames: bad})).toThrow(/positive whole number/);
    }
  });
});

describe('spring — reverse', () => {
  const natural = measureSpring({fps}).maxFrameDuration;

  it('starts near `to` and ends near `from`', () => {
    expect(spring({frame: 0, fps, reverse: true})).toBeCloseTo(1, 2);
    expect(spring({frame: natural, fps, reverse: true})).toBeCloseTo(0, 2);
  });

  it('exactly mirrors the forward curve played backward', () => {
    // Implementation property: reversing evaluates forward(total - frame).
    for (const f of [0, 7, 13, natural - 1, natural + 50]) {
      expect(spring({frame: f, fps, reverse: true})).toBe(
        spring({frame: Math.max(0, natural - f), fps}),
      );
    }
  });

  it('respects durationInFrames as its window', () => {
    const duration = 60;
    expect(spring({frame: 0, fps, durationInFrames: duration, reverse: true})).toBeCloseTo(1, 2);
    expect(spring({frame: duration, fps, durationInFrames: duration, reverse: true})).toBeCloseTo(
      0,
      2,
    );
    // Halfway through the reversed window mirrors halfway through the forward one.
    expect(spring({frame: 30, fps, durationInFrames: 60, reverse: true})).toBeCloseTo(
      spring({frame: 30, fps, durationInFrames: 60}),
      6,
    );
  });

  it('stays within [from, to] when overshootClamping is on', () => {
    const values = Array.from({length: 120}, (_, f) =>
      spring({frame: f, fps, reverse: true, config: {overshootClamping: true}}),
    );
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
  });
});

describe('spring — bounded integer-chain cache (plan 041 / backlog #21)', () => {
  it('never retains more than the key cap while an ANIMATED config mints keys', () => {
    // 600 frames of animated damping = 600 distinct cache keys in the old
    // unbounded map. The LRU cap must hold throughout.
    for (let f = 0; f < 600; f++) {
      spring({frame: f, fps, config: {damping: 10 + f * 0.01}});
      expect(springCacheKeysForTest()).toBeLessThanOrEqual(8);
    }
    expect(springCacheKeysForTest()).toBe(8);
  });

  it('an evicted-then-recomputed chain returns identical values', () => {
    // Walk a config deep enough to matter, flood the cache with enough other
    // configs to force its eviction, then walk it again: eviction must only
    // ever cost recompute, never change output.
    const walk = () =>
      Array.from({length: 120}, (_, f) =>
        spring({frame: f, fps, config: {stiffness: 137, mass: 1.5}}),
      );
    const before = walk();
    for (let i = 0; i < 24; i++) {
      // Distinct keys, walked deep so each eviction victim is fully populated.
      Array.from({length: 130}, (_, f) =>
        spring({frame: f, fps, config: {stiffness: 200 + i * 3, damping: 12}}),
      );
    }
    expect(walk()).toEqual(before);
  });
});
