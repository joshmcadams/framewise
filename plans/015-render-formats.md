# Plan 015: Output formats — `--format mp4|webm|gif|png-seq` and `--still <frame>`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- scripts/`
> Plans 002 AND 003 must have landed (render-lib.mjs with tests; strict
> readFlag; cleanup()). If not, STOP. Line numbers below are from `985ca38`
> and will have shifted — anchor on the quoted code, not the numbers.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches the encode path the audio mux feeds)
- **Depends on**: plans/002-extract-render-lib.md, plans/003-renderer-robustness.md
- **Category**: direction
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

The renderer produces mp4 only, yet the two things people most often want from
a frame-based renderer — a shareable gif/webm and a single-frame PNG still
(Framewise's `renderStill`) — are already sitting on disk as the intermediate
PNG sequence. This is the broadest-appeal gap with near-zero new architecture:
new ffmpeg arg branches over an existing PNG dir, plus a one-frame render path.
(Direction finding; the maintainer selected it for a build plan.)

## Current state

All in `scripts/render.mjs` at `985ca38` (post-002/003 the pure parts live in
`scripts/render-lib.mjs`):

- Frames are written per-chunk as `frame-%05d.png` into a shared temp dir
  (`rootHandle.screenshot(...)`, line 272), then a single ffmpeg pass stitches:

  ```js
  const videoInput = ['-framerate', String(fps), '-start_number', '0', '-i', join(framesDir, 'frame-%05d.png')];
  // Shared encode settings so the two ffmpeg branches stay in sync.
  const videoEncodeArgs = ['-c:v', codec, '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  ```

  No-audio branch: `ffmpeg -y ...videoInput ...videoEncodeArgs out` (line 365).
  Audio branch (lines 366-392): per-segment `-i assetPath(seg.src)` inputs, an
  `atrim/asetpts/volume/adelay` filter per segment, optional `amix`, then
  `-map 0:v -map <outLabel> ...videoEncodeArgs -c:a aac -b:a <audioBitrate> out`.
- Defaults: `out = 'out/video.mp4'`, `codec = 'libx264'`, `crf = '18'`,
  `audioBitrate = '192k'` (lines 50-59).
- `probeConfig(url)` (lines 229-239) launches one browser to read
  `{width, height, fps, durationInFrames}`; `renderChunk(url, startFrame, endFrame, ...)`
  (lines 243-290) renders an arbitrary `[start, end)` range — a still is just
  `renderChunk(url, N, N + 1, ...)` reusing all the delayRender gating.
- The usage header (lines 9-22) documents every flag; README.md's fenced
  examples (lines 11-34) and flag blockquote (lines 36-40) mirror it.
- Conventions: pure decision logic belongs in `render-lib.mjs` with unit tests
  (plan 002); flags are strict (plan 003); `run('ffmpeg', argsArray)` is the
  spawn helper.

Format decisions (made for you — encode these):

- `--format mp4` (default): current behavior, unchanged.
- `--format webm`: default codec becomes `libvpx-vp9` with
  `['-c:v', codec, '-crf', String(crf), '-b:v', '0', '-pix_fmt', 'yuv420p']`
  (vp9 constant-quality mode needs `-b:v 0`; a webm-appropriate default crf is
  the user's problem — keep 18 unless they pass `--crf`); audio codec
  `libopus` instead of aac.
- `--format gif`: single-pass palette filter. No audio (if segments exist,
  print a warning that gif drops audio and skip the mux). Video-only filter:
  `fps=<fps>,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse` via
  `-filter_complex`, no `-pix_fmt yuv420p`, no `-c:v`.
- `--format png-seq`: skip ffmpeg entirely; treat `--out` as a DIRECTORY, copy
  the PNGs there (`frame-00000.png`...). ffmpeg preflight is skipped for this
  format.
- `--still <frame>`: render exactly frame N (delayRender-gated), write ONE png
  to `--out` (default `out/still-<N>.png`); mutually exclusive with
  `--format`/`--concurrency`; no ffmpeg needed.
- An explicit `--codec` always overrides the format default. If `--out`'s
  extension contradicts `--format`, the format wins but print a warning.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Unit      | `npm test` | all pass incl. new render-lib tests |
| Full gate | `npm run verify` | exit 0 |
| mp4 regression (needs Chrome+ffmpeg) | `npm run render -- --comp WithAudio --out out/p015.mp4` | unchanged behavior |
| webm | `npm run render -- --comp WithAudio --format webm --out out/p015.webm` | plays; has audio |
| gif  | `npm run render -- --comp HelloWorld --format gif --out out/p015.gif` | animated gif |
| png-seq | `npm run render -- --comp HelloWorld --format png-seq --out out/p015-frames` | 150 PNGs in the dir |
| still | `npm run render -- --comp WithVideo --still 75 --out out/p015-75.png` | one PNG; embedded clip shows "75" |

## Scope

**In scope**:
- `scripts/render-lib.mjs` + `scripts/render-lib.test.mjs` (new pure function
  `planEncode(...)`, tested)
- `scripts/render.mjs` (flag wiring, still path, format branches, usage header)
- `README.md` (document the new flags in the examples + blockquote)
- `plans/README.md` (status row)

**Out of scope**:
- `src/**` — the browser side needs zero changes (a still reuses `renderFrame`).
- Audio-in-gif workarounds, two-pass palette optimization, apng/webp formats.
- A docs/code chapter (nice follow-up; note it in the report, don't write it).

## Git workflow

- Branch: `advisor/015-render-formats`
- Commits: (1) planEncode + tests, (2) render.mjs wiring, (3) README.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pure encode planner in render-lib.mjs

Add and unit-test:

```js
/**
 * Decide the ffmpeg invocation for a format. Returns null for formats that
 * don't invoke ffmpeg (png-seq). Pure: no fs, no spawning.
 * @returns {null | {args: string[], dropsAudio: boolean}}
 */
export function planEncode({format, codec, crf, audioBitrate, fps, framesPattern, segments, segmentInputs, filterGraph, out}) { ... }
```

Design freedom on the exact signature, but it must be pure and cover: mp4
(today's two branches verbatim), webm (vp9/opus defaults, `-b:v 0`), gif
(palette filter, audio dropped → `dropsAudio: true` when segments exist),
explicit `--codec` override, and png-seq → `null`. Port the existing
audio-filter assembly (the `atrim/asetpts/volume/adelay` + `amix` block,
lines 367-383) into the planner or keep it as a separate pure helper it calls
— either way it becomes unit-testable.

Tests (in `render-lib.test.mjs`): mp4-no-audio args equal today's exactly
(pin them: `['-y', ...videoInput, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', out]`);
mp4-with-2-segments includes the amix graph; webm defaults to
`libvpx-vp9`+`libopus`+`-b:v 0`; webm with `--codec libx264` honors the
override; gif has palettegen/paletteuse and `dropsAudio` true with segments;
png-seq returns null.

**Verify**: `npm test` → all pass.

### Step 2: Wire the flags and branches in render.mjs

- Parse `--format` (default `'mp4'`; validate against the four values, throw
  on anything else) and `--still` (integer, validated `0 <= N < durationInFrames`
  after probeConfig; mutually exclusive with `--format` ≠ mp4 and
  `--concurrency` — throw with a clear message).
- Default `out` becomes format-aware when the user didn't pass `--out`:
  `out/video.<mp4|webm|gif>`, `out/frames` for png-seq, `out/still-<N>.png`.
- Still path: after probeConfig, `renderChunk(url, N, N + 1, ...)` into the
  temp frames dir, then copy the single PNG to `out` — skip ffmpeg preflight
  and audio entirely.
- png-seq path: after the frame-hash log, `mkdir` the out dir and copy the
  PNGs (`cp` via `node:fs/promises` `copyFile` loop) — skip ffmpeg.
- Otherwise call `planEncode(...)` and `run('ffmpeg', plan.args)`; print the
  gif audio-drop warning when `plan.dropsAudio`.
- Codec preflight (plan 003's `assertFfmpeg(codec)`): pass the *effective*
  codec (format default or override); skip preflight entirely for
  png-seq/still.
- Update the usage header comment with the two new flags.

**Verify**: `node --check scripts/render.mjs` → exit 0; `npm run verify` → exit 0.
**Verify**: `npm run render -- --format avi` → exits non-zero naming the valid formats.
**Verify**: `npm run render -- --still 5 --concurrency 4` → exits non-zero (mutually exclusive).

### Step 3: End-to-end matrix (needs Chrome+ffmpeg)

Run the five render commands from the table. For png-seq:
`ls out/p015-frames | wc -l` → 150. For the still: open/inspect
`out/p015-75.png` — the embedded clip's counter must read 75 (the
frame-accuracy proof reused). If Chrome/ffmpeg are unavailable, the unit tests
+ arg pinning are the gate; report the gap.

### Step 4: README

Add one example per new capability to the fenced block (README.md:11-34 style)
and extend the flag blockquote: `--format`, `--still`, the gif-drops-audio
caveat, and png-seq's out-is-a-directory semantics.

**Verify**: `grep -n "\-\-format" README.md` → ≥ 2 hits; `grep -n "\-\-still" README.md` → ≥ 1.

## Test plan

Step 1's planner tests are the core (pinned mp4 args = regression proof that
the default path is unchanged). Step 3 is the integration matrix. Everything
else rides `npm run verify`.

## Done criteria

- [ ] `npm run verify` exits 0
- [ ] `planEncode` unit tests pin today's mp4 args exactly (no-audio AND audio branches)
- [ ] `--format avi` and `--still N --concurrency 4` fail fast with clear messages
- [ ] Default invocation (`npm run render -- --comp X --out y.mp4`) produces identical ffmpeg args to before (the pinned test proves it)
- [ ] README documents both flags
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 002/003 haven't landed.
- Your ffmpeg build lacks `libvpx-vp9`/`libopus` (preflight will catch it) —
  webm can't be e2e-verified; unit tests still gate; note it and continue,
  but STOP if you're tempted to swap default codecs to compensate.
- The still path seems to require changes in `main-render.tsx` — it should
  not (renderFrame already takes any frame); report if reality disagrees.
- gif palette filter interacts with the audio mux in a way that forces
  restructuring beyond planEncode — report.

## Maintenance notes

- A `docs/code/12-...` chapter on output formats is the natural follow-up
  (the chapter-per-feature pattern) — deliberately out of scope here.
- If distributed rendering ever lands (README "deliberately omitted"), the
  per-chunk-encode model will subsume planEncode's single-pass assumption —
  the planner is the seam to revisit.
- Reviewers: scrutinize the pinned-args test first; it is the proof the
  default path didn't move.
