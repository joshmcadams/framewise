# 032 — Distributed chunks follow the output format (`--distributed --format webm`)

**Status:** DONE — 2026-08-24 — `planChunkVideoEncode` takes `format` (webm →
libvpx-vp9 + `-b:v 0`), new pure `chunkContainerFor(format)` names chunks,
mp4 concat gained `-movflags +faststart`; 8 new tests; live: distributed webm
probes vp9 · 150 frames · 5.000 s, mp4 hash identical (`3203283d21148710`) with
moov-before-mdat, gif still falls back with warning.

**Backlog item:** Round 2 #11 (`backlog/11-distributed-webm-codec-container-mismatch.md`)

## Problem

`canDistribute` only excludes `gif`, but `planChunkVideoEncode` hardcodes
`codec ?? 'libx264'` and render.mjs names every chunk `chunk-${i}.mp4`. So
`--distributed --format webm` encodes H.264 `.mp4` chunks and stream-copies them
into a `.webm` — ffmpeg refuses at the concat step ("Only VP8 or VP9 or AV1…")
after all frames were already rendered. The preflight checks the *webm* encoder,
so it cannot catch this either.

## Fix (backlog option 1 — derive codec/container from format)

1. `render-lib.mjs`
   - `planChunkVideoEncode` gains `format = 'mp4'`; codec defaults per format
     (`mp4 → libx264`, `webm → libvpx-vp9`), mirroring `planEncode`'s table.
     Webm chunks get `-b:v 0` alongside `-crf` (true constant-quality VP9,
     same args planEncode uses). Unknown format throws.
   - New export `chunkContainerFor(format)` → `'.mp4' | '.webm'`; throws for
     formats the distributed path cannot stitch (gif/png-seq never reach it).
2. `render.mjs`
   - Chunk filename becomes `chunk-${i}${chunkContainerFor(format)}`.
   - mp4 concat gains `-movflags +faststart` so the distributed output matches
     local single-stitch (local has had it since plan 017's wave; the concat
     step silently dropped it — found while here, same family of gap).
3. Tests in `render-lib.test.mjs`: webm chunks pin `libvpx-vp9` + `-b:v 0`;
   default stays `libx264`; explicit `--codec` override wins; unknown format
   throws from both helpers; container map pinned.

## Acceptance

1. `npm run render -- --comp HelloWorld --distributed --concurrency 2 --format
   webm --out out/v.webm` completes and `ffprobe` shows one vp9 video stream,
   correct duration/frame count (real end-to-end probe, per backlog note).
2. `--distributed` mp4 (default) still works and its final file carries
   `+faststart`.
3. Full suite green; new regression tests pass.
