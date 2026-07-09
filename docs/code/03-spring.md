# Chapter 3 — spring

**File:** `src/framewise-lite/spring.ts`

`spring` produces natural, physical motion — the bouncy "pop" of a title
scaling in, the settle of an element sliding to rest. Where `interpolate` is a
straight (or eased) line, `spring` is a simulated mass on a spring: it
accelerates, overshoots the target, and oscillates to a stop.

> **This module's math is copied verbatim from Framewise's source, not
> reconstructed.** The analytical damped-harmonic-oscillator solution is a
> classic "looks right, is subtly wrong" trap — a sign error in the velocity
> term gives motion that's _almost_ correct. So `advance()` and
> `springCalculation()` are a faithful copy of Framewise's `spring/spring-utils.ts`.
> We dropped only its memoization caches (pure performance, no effect on output).

## The mental model

A spring has three physical parameters, which are the defaults:

```ts
const defaultSpringConfig: SpringConfig = {
  damping: 10, // friction — higher = settles faster, less bounce
  mass: 1, // inertia — higher = slower, heavier feel
  stiffness: 100, // spring strength — higher = snappier
  overshootClamping: false,
};
```

With the defaults the spring is **underdamped**: it overshoots its target and
oscillates a little before settling. That's the lively Framewise feel. Crank
`damping` up and it stops overshooting (critically/over-damped).

## Why it's _iterated_, not a single formula

You might expect `spring(frame)` to plug `frame` into one closed-form equation.
It doesn't. Instead it simulates the spring **one frame-step at a time** from
frame 0 up to the requested frame. The reason: a spring's position at time _t_
depends on its position _and velocity_ an instant earlier — it's a stateful
physical system. Each step computes the new position and the new velocity, and
the velocity carries into the next step.

`springCalculation` is the loop:

```ts
let animation: AnimationNode = {
  lastTimestamp: 0,
  current: from /*0*/,
  toValue: to /*1*/,
  velocity: 0,
};
const frameClamped = Math.max(0, frame);
const unevenRest = frameClamped % 1;
for (let f = 0; f <= Math.floor(frameClamped); f++) {
  if (f === Math.floor(frameClamped)) {
    f += unevenRest; // final partial step for fractional frames
  }
  const time = (f / fps) * 1000; // ms
  animation = advance({animation, now: time, config: {...defaults, ...config}});
}
return animation;
```

Each iteration calls `advance()`, threading the returned `animation` (position +
velocity) into the next call. The `unevenRest` trick handles **fractional
frames**: if you ask for frame 12.4 (which happens when `durationInFrames`
stretches the curve, or with sub-frame timing), it integrates the 12 whole steps
then a final 0.4-frame step so the value is smooth rather than stair-stepped.

Note `springCalculation` always runs from `0 → 1`. The public wrapper maps that
unit output onto your actual `from`/`to`. Keeping the physics on a fixed `[0,1]`
makes the caching and the math simpler.

## `advance()` — one physics step

This is the verbatim oscillator solution. The shape of it:

```ts
const deltaTime = Math.min(now - lastTimestamp, 64); // clamp dt for stability
const c = config.damping,
  m = config.mass,
  k = config.stiffness;

const v0 = -velocity; // initial velocity for this step
const x0 = toValue - current; // displacement remaining to target

const zeta = c / (2 * Math.sqrt(k * m)); // damping ratio
const omega0 = Math.sqrt(k / m); // undamped angular frequency
const omega1 = omega0 * Math.sqrt(1 - zeta ** 2); // damped angular frequency
const t = deltaTime / 1000;
```

Then it branches on the damping ratio `zeta`:

- **`zeta < 1` — underdamped:** the solution involves `sin`/`cos` (it
  oscillates) wrapped in a decaying exponential envelope `e^(-zeta·omega0·t)`.
  This is the bouncy case, and it's the default.
- **`zeta >= 1` — critically/over-damped:** no oscillation; a pure exponential
  approach to the target.

```ts
return {
  toValue,
  prevPosition: current,
  lastTimestamp: now,
  current: zeta < 1 ? underDampedPosition : criticallyDampedPosition,
  velocity: zeta < 1 ? underDampedVelocity : criticallyDampedVelocity,
};
```

The two things to take away without re-deriving the calculus:

1. **It returns both `current` and `velocity`.** The velocity is the whole
   reason this is iterative — it's the hidden state that makes frame _N+1_
   depend on frame _N_.
2. **`deltaTime` is clamped to 64ms.** If a step were ever huge (a hitch, a
   tab waking from sleep), an un-clamped exponential could explode. Clamping
   keeps the simulation stable. In our fixed `f/fps` stepping this rarely binds,
   but it's part of the faithful copy.

There's also an explicit guard, because a non-positive damping makes a spring
that never comes to rest:

```ts
if (config.damping <= 0) {
  throw new Error('Spring damping must be greater than 0…');
}
```

## The public `spring()` wrapper

`springCalculation` only knows `0 → 1`. The exported `spring()` adds the
ergonomics:

```ts
export function spring({frame: passedFrame, fps, config = {}, from = 0, to = 1, delay = 0}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps must be positive…`);

  const delayProcessed = passedFrame - delay; // 1. delay
  const spr = springCalculation({fps, frame: delayProcessed, config});

  const inner = config.overshootClamping // 2. clamp overshoot
    ? to >= from
      ? Math.min(spr.current, to)
      : Math.max(spr.current, to)
    : spr.current;

  return from === 0 && to === 1 // 3. remap to from..to
    ? inner
    : interpolate(inner, [0, 1], [from, to]);
}
```

Three jobs:

1. **`delay`** — subtracting from the frame shifts the start. At frames before
   the delay, `delayProcessed` is negative; `springCalculation` clamps that to 0
   (`Math.max(0, frame)`), so the value sits at the start until the delay
   elapses.
2. **`overshootClamping`** — if you don't want the bounce past the target, cap
   the value at `to`. The `to >= from` check makes it work for springs going
   either direction.
3. **`from`/`to` remap** — reuse `interpolate` to scale the `[0,1]` physics onto
   your real values. The `from === 0 && to === 1` fast-path skips that when it's
   a no-op. (Nice detail: chapter 2's module gets reused here — the two math
   primitives compose.)

## What we omitted vs. real Framewise

Framewise's `spring()` also supports `reverse` and `durationInFrames` (stretch
the natural curve to a target length). Both require `measureSpring` — a helper
that runs the simulation until it comes to rest to find the natural duration.
It's buildable on what's here but adds surface area without teaching anything
new, so it's left out. `from`, `to`, `delay`, `overshootClamping`, `config`, and
the core physics all match Framewise exactly.

## The tests

`spring.test.ts` is **structural**, not exact-value — appropriate because the
math is a verbatim port (so the risk is "did I wire it up right," not "is the
formula right"):

```ts
expect(spring({frame: 0, fps})).toBe(0); // starts at `from`
expect(spring({frame: 300, fps})).toBeCloseTo(1, 4); // settles at `to`
// overshoots past 1 with the default underdamped config:
expect(Math.max(...frames.map((f) => spring({frame: f, fps})))).toBeGreaterThan(1);
// …but never exceeds 1 when overshootClamping is on:
expect(maxWithClamping).toBeLessThanOrEqual(1);
```

> A note carried over from the build review: if you ever _touch_ the spring
> math, add one exact numeric assertion pinned against real Framewise output.
> "Starts at 0 / overshoots / settles at 1" would survive a subtle magnitude
> error; an exact value wouldn't.

---

Next: [Chapter 4 — Sequence](04-sequence.md), where the frame engine from
chapter 1 gets used to bend time.
