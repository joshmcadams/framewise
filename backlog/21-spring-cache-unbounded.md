# 21 — `spring`'s integer-chain cache is unbounded

**Type:** Bug (memory) · **Priority:** P2 · **Effort:** S

## Problem

`src/framewise-lite/spring.ts:121` memoizes the integer-frame chain in a
module-level `Map` that is never bounded or cleared:

```ts
const integerChainCache = new Map<string, AnimationNode[]>();
```

The key is `fps|damping|mass|stiffness` — static config, one entry, exactly as
intended (this is plan/backlog item 06's O(n²) → O(n) fix, and it works). But
an **animated** config mints a new key per distinct value, and each key retains
its own chain of up to N nodes. That is O(n²) node retention, and nothing ever
evicts it.

Measured — a 600-frame comp whose spring damping is itself animated:

```
animated config: heapUsed 11 MB -> 33 MB   (delta 22 MB)
static config:   delta 0 MB
```

The comment at `spring.ts:114-120` acknowledges the mechanism ("animated
configs simply get more keys") without treating it as a cost.

## Why it matters here

Narrow trigger — animating a spring's physics rather than its input is
unusual — but the failure mode is bad: a long render with an animated config
grows unboundedly across the whole run, and parallel workers each pay it.

## Fix

Bound the cache. An LRU capped at a small number of keys preserves the entire
benefit (the hot path is one static config per spring, and a render walks
frames in order) while making the pathological case flat. Cap the retained
chain length too, or evict whole keys — either is fine, they trade the same way.

Keep the determinism guarantee intact: eviction must never change output, only
recompute. The existing "byte-identical to the naive loop" property is the
thing to protect, and there is already a test asserting it.

## Acceptance

- The 600-frame animated-config measurement above stays flat (< 1 MB delta).
- Existing spring tests unchanged and passing — especially the byte-identical
  characterization.
- A test pinning that an evicted-then-recomputed chain returns identical values.
