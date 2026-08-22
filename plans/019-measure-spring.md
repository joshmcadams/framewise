# Plan 019 — The `measureSpring` family: `measureSpring`, spring `durationInFrames`, `reverse`

**Status:** DONE (2026-08-23) — `measureSpring` + `durationInFrames` + `reverse`
landed in `spring.ts` with 19 new tests (35 total in the suite; repo at 223).
Execution notes: (1) `measureSpring` omits `from`/`to` parameters entirely —
measurement runs in normalized space by design, so they would be dead inputs;
span-invariance is documented and the fps-sublinearity of delta-threshold
measurement is characterized by test instead. (2) The 10 000-frame cap stays as
a code-level safety net but is not reachable via tiny thresholds (float
saturation converges first); no test pins it. (3) Testing caught a real bug in
the first reversal draft (`total − f·stretch` mixed requested and natural
space, so reversed springs never reached `from` under a custom duration);
corrected to `natural − f·stretch`, with an exact-mirror property test.
**Priority:** P2 · **Effort:** M · **Risk:** LOW-MEDIUM (touches `spring.ts`, whose output is pinned by characterization tests; new options must be purely additive)
**Depends on:** none open (plan 013 already pinned the fractional-frame branch this builds on)
**Category:** direction (backlog item E, surfaced again in `docs/OVERVIEW.md` §14 Phase 1)

## Why

`spring.ts`'s header says it outright: "we drop the `reverse`/`durationInFrames`
options (which need measureSpring) to keep the educational core small." This
plan adds them. Authors shouldn't have to tune physics constants to make a
spring take a known number of frames (`durationInFrames`), can't easily answer
"how long does my spring actually run?" (`measureSpring`), and can't play a
spring backward without re-deriving math (`reverse`). All three share one
primitive underneath: measuring where the normalized spring chain comes to
rest.

## API design

### `measureSpring({fps, config?, from?, to?, threshold?}) → {maxFrameDuration}`

- Walks the **normalized** integer chain (reusing `getIntegerNode`, so the
  existing cache pays for it) and returns `{maxFrameDuration}`: the first frame
  count at which consecutive positions differ by less than `threshold`.
- `threshold` defaults to `0.0005` and is expressed as a **fraction of the
  `[from → to]` span** (measurement happens in normalized space by design, so
  `from`/`to` cannot affect the result — pin that with a test).
- Validates `fps` like `spring()` does; caps the walk (10 000 frames) so a
  pathological config fails fast instead of hanging.

### `spring({…, durationInFrames?})`

- Time-warp: internal frame becomes `frame * naturalDuration /
  durationInFrames`, so the animation settles exactly around the requested
  length. Fractional evaluation is already supported (plan 013).
- Must be a positive whole number ≥ 1 (validate; throw otherwise).
- Purely additive: omitting it preserves today's byte-for-byte behavior.

### `spring({…, reverse: true})`

- Plays `to → from` over the same window: evaluate the forward path at
  `total - frame`, where `total = durationInFrames ?? measuredNaturalDuration`
  (measured lazily only when reversing without an explicit duration).
- At frame 0 the value is ≈ `to`; at frame `total` it is ≈ `from`. Composes
  with `overshootClamping` (clamping is in output space already) and with
  `delay` (delay applies to the outer timeline before reversal).

### Non-goals

- No demo composition: pure numeric API, no new visual concept to teach beyond
  chapter 3's sections.
- `interpolateColors` / string outputs remain backlog B (untouched).

## Steps

1. **Implement** in `src/framewise-lite/spring.ts`: export `measureSpring`,
   add optional `durationInFrames` / `reverse` inputs, rewrite the header
   comment (the "we drop…" sentence no longer holds). Update the JSDoc.
2. **Test** in `spring.test.ts` (new describes): measurement pins (exact
   characterization numbers for the default config at 30 fps), stiffness/damping/
   clamping/threshold monotonicity, span-invariance, fps scaling sanity,
   durationInFrames landing accuracy + stretch direction + descending range +
   validation throws, reverse endpoints + composition with durationInFrames,
   delay, and overshootClamping. Also assert the no-new-options call path is
   unchanged (existing tests already do).
3. **Docs**: extend `docs/code/03-spring.md` with the family (why measuring
   needs the same chain, how time-warps and reversal reduce to one line each);
   update the top-level README table row for `spring.ts`; update
   `docs/code/README.md` chapter 3 row if needed.
4. **Gate**: `npm run verify`.

## STOP conditions

- Any existing spring test failing after the change → stop; additive means
  additive.
- If implementing `reverse` requires touching anything outside `spring.ts` and
  its tests/docs → stop and report.

## Done means

`measureSpring` + both options land with tests and docs in the same commit
series; `npm run verify` green; plan file Status header and `plans/README.md`
row updated to DONE with commit references.
