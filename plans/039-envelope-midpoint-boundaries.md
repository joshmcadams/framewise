# 039 — Gain envelope: place each step at the frame midpoint

**Status:** DONE — 2026-08-24 — `volumeFilterToken` emits `gte(t,(k−0.5)/fps)`
instead of `gte(t,k/fps)`; worst per-video-frame deviation on a 30-frame fade
drops 0.0346 → 0.0001 measured through real ffmpeg with the exact emitted
chain; boundary-placement invariant pinned by test; ch. 9 gains the
"where the step sits" note.

**Follows:** plan 038 / backlog round 3 #19 (review follow-up)

## Problem

Plan 038 pinned the evaluation grid (`aresample=48000,asetnsamples=n=48000/fps`)
and took the worst deviation from 0.100 to 0.034 — but the residual was not
noise, it was systematic. Boundaries were emitted as `(k/fps).toFixed(6)`,
which **rounds to nearest**:

```
k=1: true PTS 0.033333333  emitted 0.033333  → on time
k=2: true PTS 0.066666667  emitted 0.066667  → ONE FRAME LATE
k=5: true PTS 0.166666667  emitted 0.166667  → ONE FRAME LATE
```

Where the rounded boundary lands past the real audio-frame PTS, `gte` is false
and the step fires late. Flooring instead does not help: the remaining failures
are the exactly-representable cases (`3/30` → 0.1, `6/30` → 0.2, `12/30` → 0.4,
`24/30` → 0.8), where the comparison is an exact-equality coin flip. Measured:
4 of 30 frames lagging, worst deviation 0.0346.

## Fix

`asetnsamples` guarantees the only timestamps reaching the expression are
exactly `k/fps`, so any boundary strictly inside `((k−1)/fps, k/fps]` selects
the same frames. Place it at the midpoint `(k − 0.5)/fps` — identical frame
selection, no near-equal float comparison anywhere.

One line in `volumeFilterToken`. Measured through real ffmpeg on the exact
chain `planEncode` emits (1 kHz tone, per-video-frame peak normalized against
the unprocessed source):

```
no grid (pre-038)      0.1036
grid, boundary k/fps   0.0346   ← plan 038
grid, floored          0.0346
grid, midpoint         0.0001   ← this plan
```

## Also in this commit

- Test `places every step strictly inside the frame it belongs to` asserts the
  invariant (`(k−1)/fps < B_k < k/fps`) rather than re-pinning literals, so the
  property survives a future precision change.
- Constant-segment fixtures corrected to one `volumes` entry per frame — the
  shape `aggregateAudioSegments` actually emits. The old `volumes: [0.5]` on a
  30-frame span exercised the right branch but taught the contract wrong.
- Comment at `samplesPerVideoFrame` notes that every integer fps in play
  divides 48000 exactly (30→1600, 25→1920, 24→2000, 60→800).

## Acceptance

1. Worst per-video-frame deviation ≤ 0.001 on a 30-frame linear fade. ✔ 0.0001
2. `npm run verify` green. ✔ 317 tests
