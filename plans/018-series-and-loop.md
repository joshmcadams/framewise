# Plan 018 — `<Series>` and `<Loop>`: timeline helpers on top of `<Sequence>`

**Status:** DONE (2026-08-23) — implemented as designed; 19 new tests
(12 Series, 7 Loop), `WithSeries` demo registered, chapter 4 extended with
`<Series>`/`<Loop>` sections, source map + README table updated. One design
refinement during execution: the child list is laid out with a pure `reduce`
instead of a mutable offset accumulator, because eslint-plugin-react-hooks v7's
compiler-powered `react-hooks/immutability` rule rejects render-phase variable
reassignment. `npm run verify` green at 204 tests. Commits: feat/test/demo/docs
series on top of `5a59fb2`.
**Priority:** P2 · **Effort:** M · **Risk:** LOW (purely additive; no existing module changes except barrels/registry/docs)
**Depends on:** none open (builds on shipped `<Sequence>`; ordering-only: after 006/010-style docs-map edits to avoid conflicts)
**Category:** direction (backlog item D, surfaced again in `docs/OVERVIEW.md` §14 Phase 1)

## Why

Backlog item D deferred `<Series>` (play clips back-to-back) and `<Loop>`
(repeat a clip) as "one PR each". Chapter 4 already teaches the punchline —
both are thin arithmetic over `Sequence`'s shift-and-clip trick — so they are
the highest-value remaining primitives: small, independent, and they complete
the timing story the chapters tell. This plan implements both with the house
discipline: colocated characterization-grade tests, barrel exports, a demo
composition wired into the shared registry, same-commit docs updates, and the
verify gate.

## API design (minimal, upstream-shaped)

### `<Series>`

```tsx
<Series spacing={0} layout="absolute-fill" defaultDurationInFrames={30}>
  <Series.Sequence durationInFrames={30}><TitleCard /></Series.Sequence>
  <Series.Sequence><SecondCard /></Series.Sequence>   {/* uses the default */}
</Series>
```

- Children must be `<Series.Sequence>` elements (anything else throws with a
  clear message — teaching-first errors).
- The parent computes each child's `from` as the running sum of the previous
  children's durations plus `spacing` gaps, and wraps each child in a real
  `<Sequence from={offset} durationInFrames={duration} layout>`.
- `Series.Sequence` validates via context that it lives inside a `<Series>`
  (throws otherwise) and renders its children bare — the parent does the work.
- Validation: durations must be positive integers (`NaN`/`<=0`/fractional
  throw); a child without `durationInFrames` uses the Series'
  `defaultDurationInFrames`, and missing both throws.
- Nested `<Series>` inside a `Series.Sequence` works for free: offsets are
  computed against the nearest `FrameProvider`, which `Sequence` may already
  have shifted.

### `<Loop>`

```tsx
<Loop durationInFrames={30} times={3} layout="absolute-fill">
  <PulsingDot />
</Loop>
```

- During iteration `i = floor(frame / durationInFrames)`, children see
  `frame - i * durationInFrames` (rebased to the iteration start).
- `times` defaults to `Infinity` (loop until the composition ends); with
  `times`, the loop unmounts once `frame >= times * durationInFrames`.
- Implemented by delegating to `<Sequence from={i * durationInFrames}
  durationInFrames={durationInFrames}>` — one line of arithmetic on top of the
  shift trick.
- Validation: `durationInFrames` must be a positive integer; `times` must be a
  positive number (or omitted).

## Steps

1. **Implement** `src/framewise-lite/Series.tsx` and
   `src/framewise-lite/Loop.tsx` exactly per the design above; export both
   (and the `Series` namespace object with `.Sequence`) from
   `src/framewise-lite/index.ts`. Match `Sequence.tsx`'s comment style: explain
   the idea in the JSDoc, no inline narration.
2. **Test** in colocated `Series.test.tsx` / `Loop.test.tsx`, jsdom suites
   following `Sequence.test.tsx` conventions (act environment, Probe pattern,
   root lifecycle). Required cases —
   Series: first child mounts at 0 rebased; cumulative offsets; strict
   hand-off (A unmounts the frame B mounts); spacing gaps mount nothing;
   `defaultDurationInFrames` fallback; missing-both-durations throws; invalid
   duration throws; non-`Series.Sequence` child throws; orphan
   `Series.Sequence` throws; nested Series re-bases offsets; `layout="none"`
   removes the wrapper.
   Loop: iteration 0 rebase; iteration 1 restart; half-open window boundary;
   unmount after `times`; endless without `times`; invalid `durationInFrames`
   throws; nested Loop composes.
3. **Demo**: new `src/compositions/WithSeries.tsx` (three sequential cards via
   `<Series>`, one containing a `<Loop>`ed pulse), registered in
   `src/render/registry.ts` as id `WithSeries` (1280×720, 30 fps, ~150 frames,
   empty `defaultProps`). Confirm `npm run render -- --list` picks it up
   (no Chrome needed).
4. **Docs (same commit as the code)**: extend `docs/code/04-sequence.md` with
   `<Series>` and `<Loop>` sections (walk the implementations, show how each
   reduces to `Sequence`); add both files to the source map in
   `docs/code/README.md` (tree + chapter 4 row); add rows to the top-level
   `README.md` "What's here" table mapping to Framewise's `<Series>`/`<Loop>`.
5. **Gate**: `npm run verify` must pass (typecheck, lint, prettier, all tests,
   build).

## STOP conditions

- Any verify failure that isn't a typo-level fix in the new files → stop and
  report before touching other modules.
- If a required change leaks outside `Series.tsx`, `Loop.tsx`,
  `index.ts`, the new composition, `registry.ts`, and docs → stop; the design
  assumed zero changes to existing primitives.

## Done means

Both components land with their tests, demo, registry entry, docs sections and
source-map entries; `npm run verify` green; this file's Status header and the
row in `plans/README.md` updated to DONE with commit references.
