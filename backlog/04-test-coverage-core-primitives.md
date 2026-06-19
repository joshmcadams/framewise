# 04 — Test the untested core: `<Sequence>`, the Player clock, and `delayRender`

> **✅ Done.** Added `jsdom` and per-file `// @vitest-environment jsdom`
> docblocks (pure-math tests stay on `node`). New suites: `Sequence.test.tsx`
> (frame rebasing, half-open mount window, layout wrapper), `Player.test.tsx`
> (wall-clock → frame derivation independent of rAF tick count, loop/stop),
> `delay-render.test.tsx` (pending tracking, idempotent clear, subscription,
> timeout logging, `useDelayRenderPending` hook). Extended `interpolate.test.ts`
> with `posterize`, left-edge `wrap`, and easing-array validation. Suite is
> 23 → 42 tests, all green; typecheck clean.

## Problem

The suite covers the two pure-math modules well (`interpolate.test.ts`,
`spring.test.ts`) and the audio sink (`audio-registry.test.ts`), but the
primitives the README calls the most important are **untested**:

- `<Sequence>` — "the single most important compositional primitive"
  (`Sequence.tsx:6`): frame shifting and the `[from, from+duration)` mount window
  have zero tests.
- The Player clock — the README's "#1 thing naive players get wrong"
  (`Player.tsx:94-114`): the wall-clock → frame derivation has no test.
- `delayRender` / `continueRender` — the mechanism separating the toy from a real
  renderer (`delay-render.ts`): pending-count tracking, idempotent
  `continueRender`, and timeout behavior are untested.

There are also gaps in the pure modules: `interpolate`'s `posterize` option
(interpolate.ts:164-185) and left-side `wrap`/`identity` extrapolation are
uncovered.

A practical blocker: `vite.config.ts:8` sets `environment: 'node'`, so any
DOM/React test can't run as-is.

## Goal

1. **Enable DOM tests.** Add `jsdom` (devDependency) and either switch the
   default `test.environment` to `'jsdom'` or use per-file
   `// @vitest-environment jsdom` docblocks for the component tests so the pure
   math tests keep running under `node`.

2. **`<Sequence>` tests** (render with a known `FrameProvider` value, assert on
   `useCurrentFrame()` read by a probe child):
   - Child sees `0` when outer frame == `from`.
   - Child sees `outer - from` inside the window.
   - Returns `null` (child unmounted) before `from` and at/after
     `from + durationInFrames`.
   - `layout="none"` renders children without the `AbsoluteFill` wrapper.

3. **Player clock test** (fake timers + mocked `performance.now` /
   `requestAnimationFrame`): advancing wall-clock by `1000ms` at 30fps advances
   the frame by ~30, **not** by the number of rAF ticks — the exact refresh-rate
   decoupling the README claims.

4. **`delayRender` tests**: `getPendingDelayRenders()` reflects outstanding
   handles; `continueRender` clears and is idempotent (double-call is a no-op);
   `useDelayRenderPending` updates via the subscription; timeout path fires the
   `console.error` after the configured ms (use fake timers).

5. **`interpolate` gaps**: `posterize` snaps input to the step; left-edge `wrap`
   and `identity`; per-segment easing array length validation.

## Acceptance criteria

- `npm test` runs both node and jsdom suites green.
- Sequence, Player clock, and delayRender each have at least the cases above.
- Coverage of `interpolate` includes `posterize` and left-edge extrapolation.
