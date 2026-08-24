# 038 — Pin the gain envelope's evaluation grid to the video frame

**Status:** DONE — 2026-08-24 — automated segments insert
`aresample=48000,asetnsamples=n=round(48000/fps)` before the envelope
(constant segments skip both); ordering pinned by test (grid → volume →
adelay); measured through real ffmpeg: worst per-video-frame deviation
0.1001 → 0.0335 on a 30-frame linear fade, buffer-grid hold of 2–3 frames
gone; WithAudio renders end-to-end (2 segments).

**Backlog item:** Round 3 #19 (`backlog/19-volume-envelope-audio-frame-resolution.md`)

## Problem

`eval=frame` evaluates once per **audio** frame (decoder buffer, ~4096 samples
≈ 85 ms at 48 kHz), not per video frame (33.3 ms). The intended curve is
resampled onto buffer boundaries — measured worst deviation 0.104 linear gain
on a 30-frame fade, with the gain holding 2–3 video frames at a time. Inaudible
for monotone fades; fast automation (3-frame duck, tremolo) smears away.

## Fix (backlog option 1)

Automated segments insert `aresample=48000,asetnsamples=n=<round(48000/fps)>`
before the volume filter: rate pinned so the audio frame size follows from it.
Constant segments skip both filters (no needless resample). `planEncode`
already knows `fps`.

1. `render-lib.mjs` planEncode chain:
   `atrim → asetpts [, aresample=48000, asetnsamples=n=N] → volume token → adelay`.
2. Tests: automated chain pins ORDER (`asetnsamples` before `volume`, volume
   before `adelay`) and N = round(48000/fps); constant chain has neither
   resample nor repacketizer.
3. Chapter 9: state the ACHIEVED resolution with the measurement (0.104 smear
   → ≤0.035 = one frame's step), and why option 2 (ffprobe probing) was
   rejected.

## Acceptance

1. Standalone measurement through real ffmpeg: per-video-frame peak of a faded
   1 kHz tone tracks the intended curve within ≤ ~0.035.
2. WithAudio renders end-to-end; segment log unchanged (2 segments).
3. Suite green; ordering pinned by test.
