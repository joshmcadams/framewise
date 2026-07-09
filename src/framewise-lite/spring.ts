// Ported verbatim (math-wise) from Framewise's spring/spring-utils.ts and
// spring/index.ts. The analytical damped-harmonic-oscillator solution is exact;
// reconstructing it from scratch is the classic "almost right" trap, so this is
// a faithful copy. Like Framewise we memoize the integer-frame chain (pure perf,
// byte-identical output — see integerChainCache below); we drop the
// `reverse`/`durationInFrames` options (which need measureSpring) to keep the
// educational core small. `from`, `to`, and `delay` behave exactly like
// Framewise.
//
// Deliberate deviation from upstream: `overshootClamping`. Upstream clamps
// `spr.current` (normalized 0..1 space) directly against `to` (output space),
// which silently does nothing when `to !== 1`. We clamp in output space after
// mapping with `interpolate()`, so it works correctly for any `from`/`to` pair.
// (see the note at the clamp site).

import {interpolate} from './interpolate';

export type SpringConfig = {
  damping: number;
  mass: number;
  stiffness: number;
  overshootClamping: boolean;
};

const defaultSpringConfig: SpringConfig = {
  damping: 10,
  mass: 1,
  stiffness: 100,
  overshootClamping: false,
};

type AnimationNode = {
  lastTimestamp: number;
  toValue: number;
  current: number;
  velocity: number;
  prevPosition?: number;
};

function advance({
  animation,
  now,
  config,
}: {
  animation: AnimationNode;
  now: number;
  config: SpringConfig;
}): AnimationNode {
  const {toValue, lastTimestamp, current, velocity} = animation;

  const deltaTime = Math.min(now - lastTimestamp, 64);

  if (config.damping <= 0) {
    throw new Error(
      'Spring damping must be greater than 0, otherwise the spring() animation will never end, causing an infinite loop.',
    );
  }

  const c = config.damping;
  const m = config.mass;
  const k = config.stiffness;

  const v0 = -velocity;
  const x0 = toValue - current;

  const zeta = c / (2 * Math.sqrt(k * m)); // damping ratio
  const omega0 = Math.sqrt(k / m); // undamped angular frequency
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2); // damped angular frequency

  const t = deltaTime / 1000;

  const sin1 = Math.sin(omega1 * t);
  const cos1 = Math.cos(omega1 * t);

  // Under-damped (zeta < 1): oscillates while decaying.
  const underDampedEnvelope = Math.exp(-zeta * omega0 * t);
  const underDampedFrag1 =
    underDampedEnvelope * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);

  const underDampedPosition = toValue - underDampedFrag1;
  const underDampedVelocity =
    zeta * omega0 * underDampedFrag1 -
    underDampedEnvelope * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);

  // Critically damped (zeta >= 1): approaches without oscillating.
  const criticallyDampedEnvelope = Math.exp(-omega0 * t);
  const criticallyDampedPosition =
    toValue - criticallyDampedEnvelope * (x0 + (v0 + omega0 * x0) * t);

  const criticallyDampedVelocity =
    criticallyDampedEnvelope * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);

  return {
    toValue,
    prevPosition: current,
    lastTimestamp: now,
    current: zeta < 1 ? underDampedPosition : criticallyDampedPosition,
    velocity: zeta < 1 ? underDampedVelocity : criticallyDampedVelocity,
  };
}

// The animation at the start (frame "before 0"). advance() at now=0 is an
// identity step, so the integer chain is A_0 = advance(INIT, 0), A_k =
// advance(A_{k-1}, k/fps).
const INIT_NODE: AnimationNode = {
  lastTimestamp: 0,
  current: 0,
  toValue: 1,
  velocity: 0,
  prevPosition: 0,
};

// Memoize the integer-frame chain per (fps, config). The naive version
// re-integrated from frame 0 on every call — O(frames) per call, O(frames^2)
// across a render. This keeps a growing array of integer nodes per spring and
// advances only as far as needed, making repeated calls amortized O(1). It is
// byte-identical to the naive loop because it issues the exact same sequence of
// advance() calls in the same order. (Framewise memoizes the same way; the
// cache is keyed by static config, so animated configs simply get more keys.)
const integerChainCache = new Map<string, AnimationNode[]>();

function getIntegerNode(
  upto: number,
  fps: number,
  resolvedConfig: SpringConfig,
  key: string,
): AnimationNode {
  if (upto < 0) {
    return INIT_NODE;
  }
  let nodes = integerChainCache.get(key);
  if (!nodes) {
    nodes = [];
    integerChainCache.set(key, nodes);
  }
  for (let k = nodes.length; k <= upto; k++) {
    const prev = k === 0 ? INIT_NODE : nodes[k - 1];
    nodes[k] = advance({animation: prev, now: (k / fps) * 1000, config: resolvedConfig});
  }
  return nodes[upto];
}

function springCalculation({
  frame,
  fps,
  config = {},
}: {
  frame: number;
  fps: number;
  config?: Partial<SpringConfig>;
}): AnimationNode {
  const resolvedConfig: SpringConfig = {...defaultSpringConfig, ...config};
  const key = `${fps}|${resolvedConfig.damping}|${resolvedConfig.mass}|${resolvedConfig.stiffness}`;

  const frameClamped = Math.max(0, frame);
  const floor = Math.floor(frameClamped);
  const unevenRest = frameClamped % 1;

  if (unevenRest === 0) {
    return getIntegerNode(floor, fps, resolvedConfig, key);
  }

  // Fractional frame: branch off the integer node just before it (A_{floor-1})
  // and take one extra step straight to the exact time — exactly what the naive
  // loop's `f += unevenRest` did on its final iteration.
  const base = getIntegerNode(floor - 1, fps, resolvedConfig, key);
  return advance({animation: base, now: (frameClamped / fps) * 1000, config: resolvedConfig});
}

/**
 * Physics-based animation value. At frame 0 it equals `from`; over time it
 * springs toward `to`, possibly overshooting (unless `overshootClamping`).
 *
 * @example
 * const scale = spring({frame, fps, config: {damping: 12}});
 */
export function spring({
  frame: passedFrame,
  fps,
  config = {},
  from = 0,
  to = 1,
  delay = 0,
}: {
  frame: number;
  fps: number;
  config?: Partial<SpringConfig>;
  from?: number;
  to?: number;
  delay?: number;
}): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`fps must be a positive number, but got ${fps}`);
  }

  const delayProcessed = passedFrame - delay;

  const spr = springCalculation({fps, frame: delayProcessed, config});

  // springCalculation always animates in normalized [0, 1] space, so map to the
  // requested [from, to] range first, THEN clamp against `to`. Clamping
  // spr.current against `to` directly (as upstream's snippet appears to) only
  // works when to === 1; for any other target it compares a 0..1 quantity to an
  // output-space value and never clamps.
  const mapped =
    from === 0 && to === 1 ? spr.current : interpolate(spr.current, [0, 1], [from, to]);

  if (!config.overshootClamping) {
    return mapped;
  }

  return to >= from ? Math.min(mapped, to) : Math.max(mapped, to);
}
