import {describe, expect, it} from 'vitest';
import {Easing} from './easing';
import {interpolate} from './interpolate';

describe('Easing', () => {
  describe('built-in curves — endpoints', () => {
    it('linear: 0→0, 1→1', () => {
      expect(Easing.linear(0)).toBe(0);
      expect(Easing.linear(1)).toBe(1);
    });

    it('quad: 0→0, 1→1', () => {
      expect(Easing.quad(0)).toBe(0);
      expect(Easing.quad(1)).toBe(1);
    });

    it('cubic: 0→0, 1→1', () => {
      expect(Easing.cubic(0)).toBe(0);
      expect(Easing.cubic(1)).toBe(1);
    });

    it('sin: 0→0, 1→1', () => {
      expect(Easing.sin(0)).toBe(0);
      expect(Easing.sin(1)).toBeCloseTo(1, 12);
    });

    it('circle: 0→0, 1→1', () => {
      expect(Easing.circle(0)).toBe(0);
      expect(Easing.circle(1)).toBe(1);
    });

    it('exp: 0→2^-10 (upstream behaviour), 1→1', () => {
      expect(Easing.exp(0)).toBeCloseTo(0.0009765625, 6);
      expect(Easing.exp(1)).toBe(1);
    });

    it('ease (built-in bezier): 0→0, 1→1', () => {
      expect(Easing.ease(0)).toBe(0);
      expect(Easing.ease(1)).toBe(1);
    });
  });

  describe('monotonicity', () => {
    function assertMonotonic(fn: (t: number) => number): void {
      let prev = -Infinity;
      for (let t = 0; t <= 1; t += 0.01) {
        const v = fn(t);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }

    it('linear', () => assertMonotonic(Easing.linear));
    it('quad', () => assertMonotonic(Easing.quad));
    it('cubic', () => assertMonotonic(Easing.cubic));
    it('sin', () => assertMonotonic(Easing.sin));
    it('circle', () => assertMonotonic(Easing.circle));
    it('ease', () => assertMonotonic(Easing.ease));
  });

  describe('combinators', () => {
    it('out: Easing.out(Easing.quad)(0.25) === 1 - 0.75^2', () => {
      expect(Easing.out(Easing.quad)(0.25)).toBe(1 - 0.75 ** 2);
    });

    it('inOut: midpoint === 0.5', () => {
      expect(Easing.inOut(Easing.quad)(0.5)).toBe(0.5);
    });

    it('inOut: symmetry f(t) + f(1-t) ≈ 1', () => {
      const fn = Easing.inOut(Easing.quad);
      for (let t = 0; t <= 1; t += 0.05) {
        expect(fn(t) + fn(1 - t)).toBeCloseTo(1, 10);
      }
    });

    it('in: identity combinator', () => {
      for (let t = 0; t <= 1; t += 0.1) {
        expect(Easing.in(Easing.quad)(t)).toBe(Easing.quad(t));
      }
    });
  });

  describe('bezier', () => {
    it('CSS "ease" at t=0.5 ≈ 0.8024 — known value from bezier-easing', () => {
      const cssEase = Easing.bezier(0.25, 0.1, 0.25, 1);
      expect(cssEase(0.5)).toBeCloseTo(0.8024, 2);
    });

    it('bezier(0, 0, 1, 1) ≈ identity across samples', () => {
      const id = Easing.bezier(0, 0, 1, 1);
      for (let t = 0; t <= 1; t += 0.05) {
        expect(id(t)).toBeCloseTo(t, 4);
      }
    });

    it('throws on invalid x1', () => {
      expect(() => Easing.bezier(2, 0, 1, 1)).toThrow(/x1 and x2 must be between 0 and 1/);
    });

    it('throws on invalid x2', () => {
      expect(() => Easing.bezier(0.5, 0, -0.1, 1)).toThrow(/x1 and x2 must be between 0 and 1/);
    });
  });

  describe('integration with interpolate', () => {
    it('single easing: quad maps [0,30]→[0,100] at frame 15 to 25', () => {
      expect(interpolate(15, [0, 30], [0, 100], {easing: Easing.quad})).toBe(25);
    });

    it('per-segment easing array applies the right function per segment', () => {
      const inputRange = [0, 30, 60];
      const outputRange = [0, 100, 200];
      // segment 0: linear, segment 1: quad
      const easing = [Easing.linear, Easing.quad];

      // frame 15 — in segment 0, linear: 0.5 → 50
      expect(interpolate(15, inputRange, outputRange, {easing})).toBe(50);
      // frame 45 — in segment 1, quad: normalized 0.5 → 0.25 → 0.25*100+100 = 125
      expect(interpolate(45, inputRange, outputRange, {easing})).toBe(125);
    });
  });

  describe('poly', () => {
    it('poly(4)(0) === 0, poly(4)(1) === 1', () => {
      expect(Easing.poly(4)(0)).toBe(0);
      expect(Easing.poly(4)(1)).toBe(1);
    });

    it('poly(4)(0.5) === 0.0625', () => {
      expect(Easing.poly(4)(0.5)).toBe(0.0625);
    });
  });
});
