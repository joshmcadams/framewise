# Plan 022 — Per-frame volume automation for `<Audio>` / `<Video>` / `<OffthreadVideo>`

**Status:** DONE (2026-08-23) — `volume` accepts a function of the local frame
on `<Audio>`, `<Video>`, and `<OffthreadVideo>`; preview drives `el.volume`
per tick, render reports the evaluated value per frame. Aggregation splits on
volume change (constant-volume behavior byte-identical — existing suites
untouched). 5 new tests across three component suites + aggregation matrix
flipped/extended. WithAudio's background tone now fades out over its final
second; live-verified end-to-end: segment log shows the constant run then ~30
one-frame fade steps, and `volumedetect` reads −32.1 dB → −41.9 dB across the
fade window.
**Priority:** P2 · **Effort:** M · **Risk:** LOW-MEDIUM (touches the shared aggregation; existing constant-volume behavior must stay byte-identical)
**Depends on:** none open (Stage 4 mux already parametrizes volume per segment)
**Category:** direction (Phase 2 item 2 in `docs/OVERVIEW.md` §14)

## Why

README's omitted list says it plainly: audio/video use "constant per-segment
volume". Real soundtracks fade in/out and duck under narration. Upstream accepts
`volume` as a number **or a function of the frame**; this plan adds exactly
that, driven through the existing per-frame report pipeline.

## Design

### Component surface

```ts
type VolumeProp = number | ((frame: number) => number);
<Audio src volume={interpolate-style callback} />
```

- The callback receives the **re-based local frame** (what `useCurrentFrame()`
  returns inside the element's `<Sequence>`), so wrapping in a `<Sequence>`
  shifts the whole curve for free — same rule as every other animation input.
- Components evaluate it once per commit: preview hands the number to
  `useMediaSync` (live element volume follows the curve), render reports the
  number to the audio-registry. No other component changes needed.
- `OffthreadVideo`'s independent report effect evaluates it identically.
- Typical usage composes with chapter 2: `volume={(f) => interpolate(f, [0, 30], [0, 1], {extrapolateRight: 'clamp'})}`.

### Aggregation (`aggregateAudioSegments`)

- Today a run splits only on a frame-gap. Add: **also split when the next
  point's volume differs from the run's volume** (strict inequality).
- Consequence: a smooth fade becomes one segment per distinct volume value.
  At educational scale that's comfortable for ffmpeg (a 90-frame fade = ≤ 90
  tiny trims feeding `amix`); documented honestly rather than hidden behind
  quantization heuristics. Constant volumes behave exactly as before (single
  segment) — byte-identical outputs for all existing compositions without
  callbacks.
- `planEncode` needs zero changes: it already emits `volume=<seg.volume>` per
  segment.

## Steps

1. Components: add `VolumeProp`, evaluate per commit in `<Audio>`, `<Video>`,
   `<OffthreadVideo>`; JSDoc documents the local-frame rule.
2. Aggregation: split-on-volume-change in `aggregateAudioSegments`.
3. Tests: callback evaluation at multiple frames (Audio/Video/OffthreadVideo
   suites); aggregation matrix — constant stays one segment, changing volumes
   split, gap still splits, ordering preserved.
4. Demo: extend `WithAudio` — background tone fades out over the final second
   via an `interpolate`-based callback (chapter 9's demo gains the new feature
   visibly).
5. Docs: chapter 9 section ("Volume automation") + remove the constant-volume
   simplification note; README table prop descriptions; OVERVIEW §5 rows +
   Phase 2 progress; test count.
6. Gate: `npm run verify`; optional live check — render `WithAudio` and confirm
   the segment log shows the fade's stepped volumes and `volumedetect` reads
   declining mean volume near the end vs before.

## STOP conditions

- Any existing audio/aggregation test failing → stop.
- Changes leaking beyond the three components, `audio-registry` docs,
  `render-lib.mjs` aggregation, demo, and docs → stop and report.

## Done means

Callback volume works in preview AND render for all three media components;
aggregation verified; docs updated same-commit; verify green; plan Status
header + `plans/README.md` row flipped to DONE.
