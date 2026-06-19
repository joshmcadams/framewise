import {describe, expect, it} from 'vitest';
import {random} from './random';

describe('random', () => {
  it('is deterministic: same seed always returns the same value', () => {
    expect(random(42)).toBe(random(42));
    expect(random(0)).toBe(random(0));
  });

  it('returns different values for different seeds', () => {
    expect(random(0)).not.toBe(random(1));
    expect(random(100)).not.toBe(random(101));
  });

  it('returns a value in [0, 1)', () => {
    for (const seed of [0, 1, 42, 999, -1, -100]) {
      const v = random(seed);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('string seeds are deterministic', () => {
    expect(random('frame-0')).toBe(random('frame-0'));
    expect(random('particle:42')).toBe(random('particle:42'));
  });

  it('string seeds produce different values for different strings', () => {
    expect(random('a')).not.toBe(random('b'));
    expect(random('frame-0')).not.toBe(random('frame-1'));
  });

  it('string and number seeds with the same numeric value may differ (no collision guarantee needed)', () => {
    // This is a property test, not a requirement — just documents the behavior.
    const numResult = random(0);
    expect(typeof numResult).toBe('number');
    expect(typeof random('0')).toBe('number');
  });

  it('negative number seeds are supported', () => {
    expect(random(-1)).toBeGreaterThanOrEqual(0);
    expect(random(-1)).toBeLessThan(1);
    expect(random(-1)).toBe(random(-1));
  });
});
