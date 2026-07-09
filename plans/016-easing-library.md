# Plan 016: Ship the Easing library (backlog item C)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- src/framewise-lite/interpolate.ts src/framewise-lite/index.ts docs/code/README.md`
> If an `easing.ts` already exists in `src/framewise-lite/`, STOP. Plans 006
> and 010 should have landed first (they also edit `docs/code/README.md`).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (purely additive module)
- **Depends on**: plans/001-verification-baseline.md; ordering-only: after plans/006 and 010 (docs-map merge conflicts)
- **Category**: direction
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

`interpolate` already accepts easing functions as a first-class option — typed,
validated per segment, applied in the core — but the repo ships no easing
vocabulary, so every doc example uses the linear default. The maintainer's own
backlog defers this as item C ("Easing library (`bezier`, `in`/`out`/`inOut`,
`linear`) — one PR"). It is the top-ranked deferred primitive because the
consumer seam is already wired: the library is pure additive functions touching
neither the ported numeric core nor the renderer. (Direction finding; the
maintainer selected it for a build plan.)

## Current state

- `src/framewise-lite/interpolate.ts:15-22` — the consumer contract:

  ```ts
  export type EasingFunction = (input: number) => number;

  export type InterpolateOptions = Partial<{
    easing: EasingFunction | readonly EasingFunction[];
    ...
  }>;
  ```

  Applied per segment at lines 194-206 (single function or one-per-segment
  array, validated at lines 161-167). **Do not modify this file.**
- `backlog/README.md:117` — the deferred item this plan implements:
  `**C.** Easing library (bezier, in/out/inOut, linear)`.
- Upstream Framewise's `Easing` API (the fidelity target — this repo ports
  faithfully, see the spring/interpolate precedent) is itself the React Native
  `Easing` module: `linear`, `ease`, `quad`, `cubic`, `poly(n)`, `sin`,
  `circle`, `exp`, `bounce`, `elastic(bounciness)`, `back(s)`, `bezier(x1,y1,x2,y2)`,
  and the combinators `in(fn)`, `out(fn)`, `inOut(fn)`. Scope for this plan
  (backlog C + the cheap adjacent members): `linear`, `quad`, `cubic`,
  `poly(n)`, `sin`, `circle`, `exp`, `ease` (defined as
  `bezier(0.42, 0, 1, 1)`), `bezier`, `in`, `out`, `inOut`. Explicitly
  deferred: `bounce`, `elastic`, `back` (report as follow-ups; keep the module
  small).
- The bezier solver is the only nontrivial math. Port the standard
  `bezier-easing` algorithm (the same one upstream vendors): Newton-Raphson
  iterations with a sampled fallback to bisection. ~90 lines. Follow the
  repo's provenance convention — a header comment stating what is ported
  from where, like `spring.ts:1-8` does.
- Naming constraint: `in` is a reserved word — define it as a quoted key or
  via an object literal (`export const Easing = {linear, ..., in: easeIn, out: easeOut, inOut}`),
  matching upstream's surface (`Easing.in(Easing.quad)`).
- Style/conventions: doc comments with `@example` (see `staticFile.ts`,
  `random.ts`); tests colocated; barrel export from
  `src/framewise-lite/index.ts` (currently exports end at line 24 with
  `random`).
- Demo + docs conventions: each primitive lands with demo usage and
  walkthrough coverage (plans 006/010 established the corrected map;
  `docs/code/02-interpolate.md` is the interpolate chapter this extends).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| This file | `npx vitest run src/framewise-lite/easing.test.ts` | all pass |
| Full gate | `npm run verify` | exit 0 |
| Preview (manual) | `npm run dev` | HelloWorld subtitle eases instead of linear |

## Scope

**In scope**:
- `src/framewise-lite/easing.ts` (create), `src/framewise-lite/easing.test.ts` (create)
- `src/framewise-lite/index.ts` (add `export {Easing} from './easing';`)
- `src/compositions/HelloWorld.tsx` (one-line demo usage; see Step 3)
- `docs/code/02-interpolate.md` (an "Easing" section), `docs/code/README.md`
  (map entry), `README.md` ("What's here" table row)
- `plans/README.md` (status row)

**Out of scope**:
- `interpolate.ts` — zero changes; the contract is already there.
- `bounce`/`elastic`/`back` (deferred), `spring.ts` (different mechanism).
- A full new docs chapter — extend chapter 02 instead (easing belongs with
  interpolate).

## Git workflow

- Branch: `advisor/016-easing-library`
- Commits: (1) easing.ts + tests + barrel, (2) demo + docs.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Implement `easing.ts`

Shape:

```ts
// Ported from Framewise's Easing module (itself React Native's Easing), which
// wraps the classic bezier-easing Newton-Raphson/bisection solver. Faithful
// port of the members we ship; bounce/elastic/back are deferred (backlog 09-C).

import type {EasingFunction} from './interpolate';

function bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction { ... }

const linear: EasingFunction = (t) => t;
const quad: EasingFunction = (t) => t * t;
const cubic: EasingFunction = (t) => t * t * t;
const poly = (n: number): EasingFunction => (t) => t ** n;
const sin: EasingFunction = (t) => 1 - Math.cos((t * Math.PI) / 2);
const circle: EasingFunction = (t) => 1 - Math.sqrt(1 - t * t);
const exp: EasingFunction = (t) => 2 ** (10 * (t - 1));
const easeIn = (fn: EasingFunction): EasingFunction => fn;
const easeOut = (fn: EasingFunction): EasingFunction => (t) => 1 - fn(1 - t);
const easeInOut = (fn: EasingFunction): EasingFunction => (t) =>
  t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2;

export const Easing = {
  linear, quad, cubic, poly, sin, circle, exp, bezier,
  ease: bezier(0.42, 0, 1, 1),
  in: easeIn, out: easeOut, inOut: easeInOut,
} as const;
```

For `bezier`, port the standard algorithm: precompute 11 samples, use them to
seed a guess, run up to 4 Newton-Raphson iterations when the derivative is
large enough, else bisection/fallback; validate `x1`/`x2` ∈ [0, 1] with a
thrown error (matching the repo's loud-validation style, cf.
`interpolate.ts:150-178`). Include `@example` doc comments showing
`interpolate(frame, [0, 30], [0, 1], {easing: Easing.out(Easing.cubic)})`.

Add the barrel export in `index.ts`.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: `easing.test.ts`

Property + known-value tests (plain vitest, model on `interpolate.test.ts`):

1. Endpoints: for every non-factory member (`linear`, `quad`, `cubic`, `sin`,
   `circle`, `exp` (note: `exp(0)` is 2^-10 ≈ 0.00098, NOT 0 — pin the actual
   upstream behavior, don't "fix" it), `ease`): `f(1) === 1`; `f(0)` is 0
   (or the documented near-zero for `exp`).
2. Monotonicity on [0, 1] sampled at 0.01 steps for `linear/quad/cubic/sin/circle/ease`.
3. Combinators: `Easing.out(Easing.quad)(0.25) === 1 - 0.75²` exactly;
   `Easing.inOut(Easing.quad)(0.5) === 0.5`; `inOut` symmetry:
   `f(t) + f(1-t) ≈ 1` for sampled t.
4. `bezier` known values: `bezier(0.25, 0.1, 0.25, 1)` (CSS `ease`) at
   t = 0.5 ≈ 0.8024 (tolerance 1e-3); `bezier(0, 0, 1, 1)` ≈ identity across
   samples (tolerance 1e-5); invalid `x1 = 2` throws.
5. Integration with interpolate: `interpolate(15, [0, 30], [0, 100], {easing: Easing.quad})`
   → 25 (0.5² · 100); per-segment array
   `{easing: [Easing.linear, Easing.quad]}` over a 3-point range applies the
   right function per segment (assert one point in each segment).
6. `poly(4)(0.5)` → 0.0625.

**Verify**: `npx vitest run src/framewise-lite/easing.test.ts` → all pass.
**Verify**: `npm run verify` → exit 0.

### Step 3: Demo usage + docs

- `HelloWorld.tsx`: give the `Subtitle` slide-up an ease — change its two
  `interpolate` calls (lines 81-86) to pass
  `{extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}` (import
  `Easing` via the barrel). Visually small; deterministic.
- `docs/code/02-interpolate.md`: add an "Easing" section — the
  `EasingFunction` contract, the combinator idea (`out` mirrors, `inOut`
  splices), one bezier sentence, and the HelloWorld example. Match the
  chapter's voice.
- `docs/code/README.md` map: add `easing.ts` annotated `(ch. 2)`.
- `README.md` "What's here" table: add a row for `easing.ts` mapping to
  Framewise's `Easing` (note bounce/elastic/back deferred).

**Verify**: `grep -n "Easing" docs/code/02-interpolate.md` → ≥ 3 hits;
`grep -n "easing.ts" docs/code/README.md README.md` → 1 hit each.
**Verify**: `npm run verify` → exit 0. Manual: `npm run dev` — subtitle
decelerates into place.

## Test plan

Step 2 (≥ 12 assertions across 6 cases). The interpolate-integration case is
the load-bearing one: it proves the library plugs into the existing seam
without `interpolate.ts` changes.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `Easing` exported from the barrel; `interpolate.ts` untouched (`git diff --name-only` proves it)
- [ ] easing.test.ts passes with the bezier known-value cases
- [ ] HelloWorld demonstrates one eased interpolate
- [ ] Chapter 02 + both maps/tables updated
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Your bezier implementation can't hit the known values within tolerance
  after two attempts — port the reference algorithm exactly rather than
  inventing; if still off, report with your sampled outputs.
- You find yourself editing `interpolate.ts` for any reason.
- An `Easing` symbol already exists anywhere in `src/` (drift).

## Maintenance notes

- `bounce`, `elastic(bounciness)`, `back(s)` are the natural follow-up PR
  (deferred here to keep the module reviewable) — noted in the module header.
- If backlog item B (string/color interpolate outputs) lands later, its
  examples should use `Easing` — cross-reference then.
- Reviewers: check `exp`'s non-zero `f(0)` is documented rather than
  "corrected" (fidelity to upstream), and that `in`/`out`/`inOut` are the
  upstream combinator semantics, not aliases of specific curves.
