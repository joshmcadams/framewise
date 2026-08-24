// PROVENANCE: derived from React Native's `Easing`
//   https://github.com/facebook/react-native/blob/0b9ea60b4fee8cacc36e7160e31b91fc114dbc0d/Libraries/Animated/src/Easing.js
//   MIT License, Copyright (c) Meta Platforms, Inc. and affiliates.
// Reached here by way of Remotion's `easing`, whose own file credits the same
// React Native source. See THIRD-PARTY-NOTICES.md and docs/PROVENANCE.md.
// Wraps the classic bezier-easing Newton-Raphson/bisection solver.

import type {EasingFunction} from './interpolate';

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const kSplineTableSize = 11;
const kSampleStepSize = 1.0 / (kSplineTableSize - 1.0);

function bezierA(aA1: number, aA2: number): number {
  return 1.0 - 3.0 * aA2 + 3.0 * aA1;
}

function bezierB(aA1: number, aA2: number): number {
  return 3.0 * aA2 - 6.0 * aA1;
}

function bezierC(aA1: number): number {
  return 3.0 * aA1;
}

function calcBezier(aT: number, aA1: number, aA2: number): number {
  return ((bezierA(aA1, aA2) * aT + bezierB(aA1, aA2)) * aT + bezierC(aA1)) * aT;
}

function getSlope(aT: number, aA1: number, aA2: number): number {
  return 3.0 * bezierA(aA1, aA2) * aT * aT + 2.0 * bezierB(aA1, aA2) * aT + bezierC(aA1);
}

function bezier(mX1: number, mY1: number, mX2: number, mY2: number): EasingFunction {
  if (mX1 < 0 || mX1 > 1 || mX2 < 0 || mX2 > 1) {
    throw new Error(`bezier: x1 and x2 must be between 0 and 1, but got x1=${mX1}, x2=${mX2}`);
  }

  const sampleValues: number[] = new Array(kSplineTableSize);
  for (let i = 0; i < kSplineTableSize; i++) {
    sampleValues[i] = calcBezier(i * kSampleStepSize, mX1, mX2);
  }

  function getTForX(aX: number): number {
    let intervalStart = 0.0;
    let currentSample = 1;
    const lastSample = kSplineTableSize - 1;

    while (currentSample !== lastSample && sampleValues[currentSample] <= aX) {
      intervalStart += kSampleStepSize;
      currentSample++;
    }
    currentSample--;

    const dist =
      (aX - sampleValues[currentSample]) /
      (sampleValues[currentSample + 1] - sampleValues[currentSample]);
    let guessForT = intervalStart + dist * kSampleStepSize;

    const initialSlope = getSlope(guessForT, mX1, mX2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      for (let i = 0; i < NEWTON_ITERATIONS; i++) {
        const currentSlope = getSlope(guessForT, mX1, mX2);
        if (currentSlope === 0.0) {
          return guessForT;
        }
        const currentX = calcBezier(guessForT, mX1, mX2) - aX;
        guessForT -= currentX / currentSlope;
      }
      return guessForT;
    } else if (initialSlope === 0.0) {
      return guessForT;
    } else {
      let aB = intervalStart;
      let bB = intervalStart + kSampleStepSize;
      let currentT = guessForT;
      for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i++) {
        currentT = aB + (bB - aB) / 2;
        const currentX = calcBezier(currentT, mX1, mX2) - aX;
        if (currentX > 0.0) {
          bB = currentT;
        } else {
          aB = currentT;
        }
        if (Math.abs(currentX) < SUBDIVISION_PRECISION) {
          return currentT;
        }
      }
      return currentT;
    }
  }

  return (t: number): number => {
    if (t === 0.0 || t === 1.0) {
      return t;
    }
    return calcBezier(getTForX(t), mY1, mY2);
  };
}

/**
 * Linear easing — identity function. No acceleration or deceleration.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 100], {easing: Easing.linear})
 */
const linear: EasingFunction = (t) => t;

/**
 * Quadratic ease-in: t^2. Starts slow, ends fast.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.quad})
 */
const quad: EasingFunction = (t) => t * t;

/**
 * Cubic ease-in: t^3. More pronounced acceleration than quad.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.cubic})
 */
const cubic: EasingFunction = (t) => t * t * t;

/**
 * Polynomial ease-in with configurable exponent.
 *
 * @example
 * const eased = interpolate(frame, [0, 30], [0, 1], {easing: Easing.poly(4)});
 */
const poly =
  (n: number): EasingFunction =>
  (t) =>
    t ** n;

/**
 * Sinusoidal ease-in: 1 - cos(t * PI / 2). Smooth start, gentle deceleration.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.sin})
 */
const sin: EasingFunction = (t) => 1 - Math.cos((t * Math.PI) / 2);

/**
 * Circular ease-in: 1 - sqrt(1 - t^2). Curves like an arc accelerating from 0.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.circle})
 */
const circle: EasingFunction = (t) => 1 - Math.sqrt(1 - t * t);

/**
 * Exponential ease-in. Note: f(0) is 2^-10 ≈ 0.00098, not 0 —
 * this matches upstream Framewise/RN behaviour.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.exp})
 */
const exp: EasingFunction = (t) => 2 ** (10 * (t - 1));

/**
 * Back ease-in: pulls slightly backward (below 0) before accelerating
 * forward, like a wind-up. `s` controls the overshoot amount (upstream
 * default 1.70158 ≈ 10% overshoot). Use with Easing.out for the common
 * "overshoot the target then settle" effect.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.out(Easing.back(1.70158))})
 */
const back =
  (s: number = 1.70158): EasingFunction =>
  (t) =>
    t * t * ((s + 1) * t - s);

/**
 * Bounce ease-in: the classic four-bounce piecewise parabola (Robert
 * Penner's easeInBounce, as shipped by RN/Framewise). As an ease-IN it
 * bounces at the start; wrap in Easing.out for a ball-drop landing.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.out(Easing.bounce)})
 */
const bounce: EasingFunction = (t) => {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  }
  if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75;
    return 7.5625 * t2 * t2 + 0.75;
  }
  if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75;
    return 7.5625 * t2 * t2 + 0.9375;
  }
  const t2 = t - 2.625 / 2.75;
  return 7.5625 * t2 * t2 + 0.984375;
};

/**
 * Elastic ease-in: a damped spring-like wiggle into the motion.
 * `bounciness` is the number of half-oscillations (upstream default 1);
 * 0 gives a plain sin-like ease-in with no wiggle at all, higher values
 * overshoot past 1 mid-curve before settling.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.elastic(2)})
 */
const elastic = (bounciness: number = 1): EasingFunction => {
  const p = bounciness * Math.PI;
  return (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
};

/**
 * Cubic bezier easing. Port of the standard bezier-easing Newton-Raphson
 * solver with bisection fallback. x1 and x2 must be in [0, 1]; y1 and y2
 * are unconstrained.
 *
 * @example
 * // CSS "ease-in" curve (upstream RN/Framewise call it Easing.ease)
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.ease});
 * // Equivalent explicit form
 * const myEase = Easing.bezier(0.42, 0, 1, 1);
 */

/**
 * Combinator: returns the function unchanged (the "in" identity).
 * Provided so that Easing.in(Easing.quad) reads consistently with
 * Easing.out(...) and Easing.inOut(...).
 *
 * @example
 * Easing.in(Easing.quad)  // same as just Easing.quad
 */
const easeIn = (fn: EasingFunction): EasingFunction => fn;

/**
 * Combinator: mirrors a function to produce an ease-out curve.
 * Flips the t→progress axis so the curve decelerates instead of accelerating.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.out(Easing.cubic)});
 */
const easeOut =
  (fn: EasingFunction): EasingFunction =>
  (t) =>
    1 - fn(1 - t);

/**
 * Combinator: splices an ease-in on the first half and ease-out on the
 * second half. Symmetric around t=0.5.
 *
 * @example
 * interpolate(frame, [0, 30], [0, 1], {easing: Easing.inOut(Easing.cubic)});
 */
const easeInOut =
  (fn: EasingFunction): EasingFunction =>
  (t) =>
    t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2;

export const Easing = {
  linear,
  quad,
  cubic,
  poly,
  sin,
  circle,
  exp,
  back,
  bounce,
  elastic,
  bezier,
  ease: bezier(0.42, 0, 1, 1),
  in: easeIn,
  out: easeOut,
  inOut: easeInOut,
} as const;
