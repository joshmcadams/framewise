# 19 — The gain envelope's realized resolution is the audio frame, not the video frame

**Type:** Correctness (residual) / docs precision · **Severity:** Low
**Follows:** round 2 #13, plan 034 (`cd07ad2`)

## Context

Plan 034 fixed the real defect: per-frame volume automation no longer splices
audio into one ffmpeg input per frame. Aggregation merges contiguous frames into
one segment carrying a `volumes` array, and `volumeFilterToken` emits a
telescoped step-sum evaluated inside ffmpeg:

```
volume=volume='v₀ + Σ Δvₖ·gte(t,Bₖ)':eval=frame
```

That is the right shape and it works — no splices, O(1) inputs, and the flat
form clears ffmpeg's ~90-level nested-`if()` parser limit (a 600-frame fade
produces a 16 KB expression that ffmpeg accepts without complaint; verified).

This item is the residual, not a regression.

## Problem

`eval=frame` evaluates the expression once per **audio frame** — a decoder
buffer of ~4096 samples (~85 ms at 48 kHz) — not once per video frame (33.3 ms
at 30 fps). The intended per-frame curve is therefore resampled onto audio-buffer
boundaries: the gain holds for 2–3 video frames at a time and lags behind the
intended value.

Measured through real ffmpeg — a 1 kHz tone, the exact token
`volumeFilterToken` emits for a 30-frame linear fade at 30 fps, per-video-frame
peak normalized against the unprocessed source:

```
 vf | measured gain | expected | delta
  0 |    1.0000     |  1.0000  | +0.0000
  1 |    1.0000     |  0.9655  | +0.0345
  2 |    1.0000     |  0.9310  | +0.0690
  3 |    0.9311     |  0.8966  | +0.0346
  4 |    0.9311     |  0.8621  | +0.0691
  5 |    0.9311     |  0.8276  | +0.1035   ← holds three video frames
 …
```

Worst deviation across the fade: **0.104** in linear gain.

For a monotone fade this is largely inaudible — a coarser staircase is still a
monotone staircase, which is why plan 034's A/B (adjacent-sample jump, 21× →
2×) correctly showed the splices gone and could not see this. It matters for
*fast* automation: a 3-frame duck or a per-frame tremolo lands inside a single
audio buffer and is smeared away almost entirely.

## Fix

Force the audio frame size to one video frame's worth of samples before the
volume filter:

```
atrim=…,asetpts=PTS-STARTPTS,asetnsamples=n=<round(sampleRate/fps)>,volume=…,adelay=…
```

Verified: with `asetnsamples=n=1600` (48 kHz ÷ 30 fps) the worst deviation drops
from **0.104 to 0.035** — one frame's step at a couple of boundaries instead of a
three-frame smear.

The wrinkle is that the segment's sample rate is not known at plan time
(`planEncode` is pure and sees only paths). Options, in order of preference:

1. Insert `aresample=48000,asetnsamples=n=1600` so the rate is pinned and the
   frame size follows from it — costs a resample on non-48 kHz sources.
2. Probe the rate with `ffprobe` in `render.mjs` and pass it into `planEncode`,
   keeping the helper pure.
3. Do nothing to the filter and document the real resolution (below) — the
   honest minimum if 1 and 2 are judged not worth the complexity.

## Docs

Chapter 9 currently says the expression is "evaluated once per audio frame",
which is accurate. But the bullet immediately after —

> **Exact boundaries.** Both edges of a step are inclusive (`gte`), but the
> deltas cancel exactly there, so every timestamp […] has exactly one owning
> value.

— is a true statement about the *expression's math* that reads as a claim about
the *realized gain*. Whichever fix is chosen, state the resolution the render
actually achieves, with the measurement.

## Acceptance

- A 30-frame fade's measured per-video-frame gain tracks the intended curve to
  within one frame's step (≤ ~0.035 for a linear 1→0 fade over 30 frames).
- Chapter 9 names the achieved resolution rather than only the mechanism.
- A test pins the emitted filter chain (whichever form is chosen) so the
  ordering `asetnsamples` → `volume` cannot be reordered by a later edit.
