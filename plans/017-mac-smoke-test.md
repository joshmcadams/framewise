# Plan 017 — Manual smoke test: output formats on a machine with Chrome + ffmpeg

**Status:** TODO
**Priority:** P2 · **Effort:** S · **Depends on:** 015 (merged)

## Why

The `--format`/`--still` output paths in `scripts/render.mjs` were reviewed and
bug-fixed on 2026-07-10 (png-seq output-dir creation, still/format warning
crosstalk, gif audio log, mp4 `+faststart`), but the dev machine had neither
Chrome nor ffmpeg, so only the pure planners (`planEncode`, `planOutput`) are
covered by tests. The end-to-end paths need one real run each — this is a
manual checklist for the Mac.

## Steps

Run from the repo root. Each command should exit 0 and produce the stated
output; watch for the noted log lines.

1. **png-seq into a fresh directory** (the fixed ENOENT bug — the important one):

   ```bash
   rm -rf out/frames
   npm run render -- --comp HelloWorld --format png-seq
   ls out/frames | head -3   # expect frame-00000.png …
   ```

2. **Still frame** (no bogus extension warning, PNG written):

   ```bash
   npm run render -- --comp WithVideo --still 75 --out out/still-75.png
   file out/still-75.png     # expect PNG image data
   ```

3. **webm**:

   ```bash
   npm run render -- --comp WithAudio --format webm
   ffprobe -hide_banner out/video.webm 2>&1 | grep -E 'vp9|opus'
   ```

4. **gif with audio comp** (expect the "drops audio" warning, NO "· audio" in
   the encode log, and a warning if you add `--crf`):

   ```bash
   npm run render -- --comp WithAudio --format gif --crf 20
   ```

5. **mp4 faststart** (moov atom at the front):

   ```bash
   npm run render -- --comp HelloWorld --out out/hello.mp4
   ffprobe -v trace out/hello.mp4 2>&1 | grep -m1 -o 'moov\|mdat'   # expect moov first
   ```

6. **Determinism spot-check** (unchanged behaviour, cheap to confirm):

   ```bash
   npm run render -- --comp HelloWorld --concurrency 1 --out out/c1.mp4
   npm run render -- --comp HelloWorld --concurrency 4 --out out/c4.mp4
   # compare the two "sha256 …" log lines — must be identical
   ```

## STOP conditions

- Any command exits non-zero → capture the full output, file the failure
  against the 2026-07-10 fixes before changing anything.

## Done means

All six steps pass; update this plan's row in `plans/README.md` to DONE with a
one-line note of the machine/Chrome/ffmpeg versions used.
