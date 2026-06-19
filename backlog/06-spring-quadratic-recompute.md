# 06 — `spring()` recomputes from frame 0 on every call (O(n²) over a render)

## Problem

`springCalculation` (`src/framewise-lite/spring.ts:98-135`) integrates the
oscillator from frame 0 up to the requested frame **on every call**:

```js
for (let f = 0; f <= Math.floor(frameClamped); f++) { ... advance(...) }
```

Computing `spring()` for every frame of an `N`-frame render is therefore
`O(N²)` per spring. The module comment (lines 4-5) acknowledges that Framewise's
memoization caches were dropped "pure perf, no effect on output" — which is true
for correctness, but the cost is real for long compositions and multiple springs
per frame, and the renderer calls these once per frame across the whole range.

For the bundled demos (90–150 frames) this is negligible; it becomes noticeable
on minute-long timelines or comps with many simultaneous springs.

## Goal

Restore (a simple version of) the upstream optimization without changing output:

- **Option A — memoize per (config, fps, frame).** A module-level `Map` keyed by
  a stable serialization of `{config, fps}` → array of computed positions,
  filled lazily. This matches what the comment says was removed.
- **Option B — incremental cache.** Cache the last `AnimationNode` per
  `(config, fps)` and, when asked for a frame ≥ the cached one, advance forward
  from there instead of from 0. Falls back to a full recompute when asked for an
  earlier frame.

Option A is the most faithful and the simplest to reason about; prefer it unless
memory for very long timelines is a concern.

## Constraints

- Output must be **byte-identical** to today's values — the renderer's
  determinism check (sha256 over all frames) and `spring.test.ts` must both still
  pass unchanged.
- `delay`, `from`, `to`, and `overshootClamping` handling in `spring()` stays
  outside the cache (the cache is for the normalized `springCalculation` only).
- Be careful with the `unevenRest` fractional-frame logic (lines 119-124) — the
  cache key must include the fractional part or only cache integer frames.

## Acceptance criteria

- A microbenchmark (e.g. `spring` for frames 0..3000) shows roughly linear, not
  quadratic, scaling.
- All existing spring tests pass with no numeric changes.
- The renderer prints the same frame sha256 as before for `HelloWorld`.
