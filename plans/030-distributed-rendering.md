# Plan 030 — Distributed rendering (Lambda-style: chunk-encode + concat)

**Status:** DONE — 2026-08-23 — `--distributed` flag: each chunk encodes to a video via `planChunkVideoEncode` then concat demuxer (`buildConcatList`) stream-copy; video-only distributed (audio falls back to single-stitch with warning); HelloWorld c4 hash identical to local (3203283d…), 16.4s distributed vs 20.5s local on this machine; pure helpers tested.
**Priority:** P3 · **Effort:** M · **Risk:** MEDIUM (renderer change; must keep local mode byte-identical)
**Depends on:** none open (builds on Stage 6 parallel chunking)
**Category:** direction (Phase 5 in `docs/OVERVIEW.md` §14)

## Why

Stage 6 parallelizes on one machine via a shared frames dir + single ffmpeg stitch. Real Framewise Lambda cannot share a filesystem — workers are separate machines that each encode their chunk to a partial video and upload it; a final function concatenates them. This plan simulates that on one machine: chunk-encode + concat, keeping the "pure function of frame" determinism guarantee.

## Design

New flag `--distributed` (requires `--concurrency >1`; incompatible with `--still`/`--format png-seq` which bypass stitching). When set:

1. Workers render frames as before (shared `framesDir` keyed by absolute frame number — no need for per-worker dirs at educational scale, the teaching is the split-encode-concat pattern, not NFS vs S3).
2. Each chunk's frames are encoded to a temporary video `chunk-N.mp4` (video-only, same codec/crf/pix_fmt as final) via ffmpeg.
3. Final step concatenates chunk videos via the concat demuxer (`-f concat -safe 0 -i list.txt -c:v copy` when possible, falling back to re-encode if needed) and muxes the globally-aggregated audio in the same command.

`planEncode` already knows how to build single-stitch args; new pure helper `planDistributedEncode` in `render-lib.mjs` builds per-chunk and concat args for tests. Existing local mode is untouched — the flag is the only branch, and determinism (frame-set hash) is checked before either stitch path.

## Steps

1. Pure helper + tests (`planDistributedEncode` builds chunk video args and concat list).
2. Wire `--distributed` through `render.mjs` (flag parsing, validation, per-chunk encode loop, concat step, cleanup of chunk videos).
3. Registry/demo: no new composition needed; `HelloWorld` at c4 is the determinism proof.
4. Docs: extend chapter 11 with distributed section; README flag docs; OVERVIEW Phase 5 row ✅.
5. Live verification: `HelloWorld` c4 local vs distributed produce identical decoded pixels (frame hash identical; final mp4s may differ due to encoder threading, so check frames, not bitstream). Also verify `--distributed` rejects incompatible flags with clear message.
6. Gate: `npm run verify`.

## STOP conditions

- Local-mode hashes changing → stop.
- Chunk-encode + concat producing visually different frames vs local single-stitch → stop.

## Done means

`--distributed` renders HelloWorld identically (pixel hash) to local mode, with tests and docs, at acceptable overhead (chunk encode + concat); plan header + row DONE. Phase 5 complete.
