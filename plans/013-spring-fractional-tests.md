# Plan 013: Test spring()'s fractional-frame branch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/framewise-lite/spring.ts src/framewise-lite/spring.test.ts`
> If spring.ts changed, compare the excerpt below before proceeding; a changed
> fractional branch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (tests only)
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

`spring.ts` is the highest-churn source file (4 commits) and recently gained a
memoized integer-frame chain whose header claims byte-identity with the naive
loop. Its trickiest, newest logic — the fractional-frame reconstruction — has
**zero coverage**: every existing test calls `spring` with integer frames only.
A regression there (e.g. in a future cache change) would ship silently. This
plan adds tests only; no source changes.

## Current state

- `src/framewise-lite/spring.ts:158-171` — the branch under test:

  ```ts
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
  ```

  Key subtleties: (a) the fractional step branches from `A_{floor-1}` (NOT
  `A_floor`) and advances to the exact sub-frame time; (b) `advance()` clamps
  `deltaTime` to 64ms (`spring.ts:51`) — at 30fps one frame is 33.3ms, so a
  1.x-frame fractional step stays under the clamp; (c) the module-global cache
  (`spring.ts:123`) persists across tests in one process, so *cache-order*
  effects need fresh config keys per scenario (vary `stiffness` slightly to
  mint a fresh key, e.g. `stiffness: 100.001`).
- `spring()`'s public mapping (`spring.ts:180+`): result =
  `interpolate(spr.current, [0, 1], [from, to])` with optional
  `overshootClamping` in output space; `delay` subtracts from `frame` before
  calculation.
- Existing test conventions: `src/framewise-lite/spring.test.ts` — plain
  vitest, `const fps = 30`, `toBeCloseTo` with explicit digits, one behavior
  per `it`. Extend THIS file; don't create a new one.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| This file | `npx vitest run src/framewise-lite/spring.test.ts` | all pass (9 existing + new) |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope**: `src/framewise-lite/spring.test.ts`, `plans/README.md` (status row).

**Out of scope**: `spring.ts` (NO source changes — if a test exposes a real
discrepancy, that's a STOP), any other file. Do not export `advance` or the
cache to make testing easier.

## Git workflow

- Branch: `advisor/013-spring-fractional-tests`
- One commit: `Test spring's fractional-frame branch`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `describe('spring — fractional frames')` block

Cases (each with a distinct config key where cache-order matters):

1. **Bracketing (early rise)**: on the initial monotonic rise (frames 0-8 per
   the existing monotonicity test), `spring({frame: 5.5, fps})` lies strictly
   between `spring({frame: 5, fps})` and `spring({frame: 6, fps})`.
2. **Continuity at the integer boundary**: the fractional step branches from
   `A_{floor-1}` and takes one big step, while the integer path takes two
   smaller steps (`floor-1 → floor`, `floor → floor+1`). The spring's
   nonlinear ODE means these diverge slightly — this is expected physics, not
   a bug. Assert: `spring({frame: 5.999999, fps})` is close to
   `spring({frame: 6, fps})` (`toBeCloseTo(..., 1)`, tolerance 0.1), and
   `spring({frame: 5.000001, fps})` close to frame 5's value (same tolerance).
3. **Order independence (fractional-first)**: with a fresh config (e.g.
   `{stiffness: 100.001}`), call `spring({frame: 5.5, ...})` BEFORE any
   integer call, save the value; with a second fresh config
   (`{stiffness: 100.002}`) — mathematically distinct but the assertion is
   within-config — call integers 0..10 first, THEN 5.5. For the *same* config
   you cannot reset the cache; so instead assert: calling 5.5 twice (before
   and after filling integers 0..10) returns the identical value both times
   (`toBe`, exact equality — the cached chain must not change the fractional
   reconstruction).
4. **Fractional + delay**: `spring({frame: 10.5, fps, delay: 10})` equals
   `spring({frame: 0.5, fps})` exactly (`toBe`) — delay shifts frames before
   the calculation (same default config → same key → same chain).
5. **Fractional + from/to mapping**: `spring({frame: 5.5, fps, from: 10, to: 20})`
   equals `10 + spring({frame: 5.5, fps}) * 10` (`toBeCloseTo(..., 10)`) —
   the output mapping is linear over the same normalized value.
6. **Fractional + overshootClamping**: near the overshoot peak (the existing
   suite shows overshoot within frames 0-90; probe e.g. frame 14.5 with the
   default config), the clamped variant `≤ to` while the unclamped exceeds it
   — pick the exact fractional frame by first finding
   `argmax` over `f + 0.5` for `f in 0..30` of the unclamped value, then
   asserting at that point.
7. **Negative frame clamps to 0**: `spring({frame: -0.5, fps})` equals
   `spring({frame: 0, fps})` (i.e. `from`), pinning the `Math.max(0, frame)` clamp.

**Verify**: `npx vitest run src/framewise-lite/spring.test.ts` → 16 tests pass.

### Step 2: Full gate

**Verify**: `npm run verify` → exit 0.

## Test plan

This plan IS the test plan (7 new cases). Machine gate: `npm run verify`.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `spring.test.ts` has a fractional-frames describe block with ≥ 7 cases, all passing
- [ ] `grep -c "\.5" src/framewise-lite/spring.test.ts` ≥ 5 (fractional inputs actually exercised)
- [ ] `git diff --name-only` → only `spring.test.ts` and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any case fails against the CURRENT implementation — that is a real finding
  about the fractional branch or the cache; report the failing input and both
  values instead of loosening the assertion.
- You feel the need to export `advance`/`integerChainCache` for testability —
  the black-box cases above are sufficient by design.

## Maintenance notes

- These tests pin the cache's byte-identity claim at its weakest point; any
  future cache change (e.g. an eviction policy — a rejected-for-now finding)
  must keep them green.
- Reviewers: case 3 (same-config before/after `toBe` equality) is the one that
  actually guards the memoization; check it uses exact equality, not closeTo.
