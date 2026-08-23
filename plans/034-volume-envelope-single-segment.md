# 034 — Volume automation: one segment, gain envelope inside ffmpeg

**Status:** DONE — 2026-08-24 — aggregation merges across volume changes
(`volumes` array per segment); `volumeFilterToken` emits a telescoped step-sum
envelope (`v0 + Σ Δvₖ·gte(t,Bₖ):eval=frame`) — flat depth, because ffmpeg's
expression parser rejects nested if() past ~90 levels (measured, caught live);
WithAudio: 2 segments (was 31), fade maxΔ 1043→115 vs reference 49, RMS ramp
−14 dB; A/B against pre-fix worktree render.

**Backlog item:** Round 2 #13 (`backlog/13-volume-automation-splices-audio-per-frame.md`)

## Problem

`aggregateAudioSegments` splits on every distinct volume value, so a volume
callback returning per-frame values yields **one ffmpeg input + adelay per
frame**. Integer-millisecond `adelay` quantization (33.333 ms frames) makes
each splice land ±0.33 ms early/late; `amix` sums overlaps → ~30
discontinuities/s in an automated region. Input count also grows unbounded
(10 s fade @ 60 fps → 600 `-i`s).

## Fix (per backlog: express automation inside ffmpeg)

1. `aggregateAudioSegments`: merge contiguous frames regardless of volume;
   split only on gaps (src/id keying unchanged). Each segment carries
   `volumes: number[]` (one entry per frame) replacing the scalar `volume`.
2. `planEncode`: constant runs keep `volume=<v>`; varying runs emit
   `volume=volume='if(lt(t,B1),V0,if(lt(t,B2),V1,…,Vn))':eval=frame` where
   `Bk=(k+1)/fps` — piecewise-exact per-frame gains evaluated per audio frame,
   O(1) inputs, no splices. Filtergraph commas protected by quoting.
3. `render.mjs` segment log prints `vol a→b` when automating.
4. Tests: aggregate suite moves to the `volumes` shape; the two tests pinning
   split-on-change are rewritten (one-segment merge, gap-still-splits);
   planEncode pins scalar-vs-expression emission and boundary math.
5. Docs same-commit: ch. 9 volume-automation section + OVERVIEW Phase 2 row.

## Acceptance

1. A 30-frame fade aggregates to **one** segment (WithAudio log).
2. Rendered WithAudio shows no splice discontinuities: max adjacent-sample
   delta inside the fade window comparable to outside it — and strictly better
   than a pre-fix render (A/B via git worktree), which should show isolated
   spikes at ~33 ms spacing.
