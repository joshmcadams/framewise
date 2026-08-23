# 13 — Per-frame volume automation splices the audio once per frame

**Type:** Bug (audio quality) + scalability · **Severity:** Medium
**Introduced by:** plan 022 (`52e320d`)

**Status:** DONE — fixed by plan 034 (segments merge across volume changes; automation expressed as one telescoped `gte()` step-sum `volume=…:eval=frame` envelope. Note: the suggested nested-`if()` encoding hits ffmpeg's ~90-level expression-depth limit on long fades — measured, and replaced with the flat form.)

## Problem

`aggregateAudioSegments` now splits a run whenever the reported volume changes
(`render-lib.mjs:86`), and `planEncode` gives every segment its own ffmpeg input
and an `adelay` in **integer milliseconds** (`render-lib.mjs:153`). A volume
callback returns a new value every frame, so a fade becomes one segment per
frame. For a 6-frame fade at 30 fps the plan is:

```
[1:a]atrim=start=0.000000:duration=0.033333,…,volume=1,  adelay=0  :all=1[s0]
[2:a]atrim=start=0.033333:duration=0.033333,…,volume=0.9,adelay=33 :all=1[s1]   ← wants 33.333
[3:a]atrim=start=0.066667:duration=0.033333,…,volume=0.8,adelay=67 :all=1[s2]   ← wants 66.667
[4:a]atrim=start=0.100000:duration=0.033333,…,volume=0.7,adelay=100:all=1[s3]
…
[s0][s1]…[s5]amix=inputs=6:normalize=0[aout]
```

Two consequences:

1. **Splice artifacts.** Chunk 1 lands 0.33 ms early, overlapping chunk 0's tail
   — `amix` *sums* the overlap, so two unrelated samples add. Chunk 2 lands
   0.33 ms late, leaving a gap. The error alternates for the whole automated
   region: roughly 30 discontinuities per second at 30 fps. The `WithAudio` demo
   fades over its final 30 frames → 32 segments / 33 ffmpeg inputs.
2. **Unbounded input count.** A 10 s fade at 60 fps yields 600 `-i` inputs and
   `amix=inputs=600`, approaching command-line and filtergraph limits.

Plan 022's verification (−32.1 → −41.9 dB across the fade window) confirms the
*envelope* and cannot detect either problem.

## Fix

Keep one contiguous segment per media instance and express automation inside
ffmpeg rather than by splicing:

```
volume=volume='<expr in t>':eval=frame
```

The per-frame values are already known at plan time, so the expression can be
emitted directly (or approximated with `afade` for the common linear case).
This is artifact-free and O(1) in inputs. Keep the split-on-gap behavior; drop
only the split-on-volume-change.

Note `render-lib.test.mjs:152-170` currently *pins* the per-frame split
("keeps equal volumes merged but splits on every distinct value") — those tests
encode the behavior being replaced and must be rewritten with the fix.

## Acceptance

- A 30-frame fade produces **one** audio segment, not 30.
- Rendered `WithAudio` shows no energy spikes at frame boundaries inside the
  fade window (compare a spectrogram / sample-level diff against a reference
  encode built with a single `volume` expression).
