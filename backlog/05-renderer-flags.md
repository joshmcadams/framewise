# 05 — Renderer flag expansion (JPEG capture, `--scale`, frame ranges, `--muted`)

**Status:** ready
**Effort:** M · **Depends on:** nothing (easier after 00b, not blocked by it)
**Unblocks:** faster renders; preview-sized variants; partial re-renders; item
13 (alpha) reuses the plumbing and the even-dimension fix

## Audit verdict

Good item, correctly scoped, and the "bugs live in the crossings" framing is
right. Four concrete corrections and one bonus bug found while auditing:

1. **`--frames a-b` needs `-start_number`, which is hard-coded to `'0'`**
   (`render-lib.mjs:159`). Encoding a subset starting at frame 30 with
   `-start_number 0` makes ffmpeg find nothing and fail with an unhelpful
   pattern error. Same for the distributed path, which already passes the chunk
   start correctly (`render-lib.mjs:346-348`) — copy that.
2. **The integrity gate hard-codes the expected frame count**
   (`render.mjs:634-640`) as `durationInFrames` or 1. A subset render trips it.
3. **`--scale` cannot be implemented by "encode dims = config dims × f".**
   `planEncode` never sets dimensions at all — ffmpeg infers them from the PNGs.
   Scaling happens by changing `deviceScaleFactor` in `applyViewport`
   (`render.mjs:367-370`), and the encoder then sees whatever pixel size that
   produced.
4. **Pre-existing bug worth fixing here:** odd output dimensions already break
   `yuv420p` today, at scale 1. A composition declared `1281×721` fails at
   encode with a raw ffmpeg error (`render-lib.mjs:181-182` /`:355-356` both
   force `yuv420p`). `--scale 0.5` makes odd dimensions far more likely
   (`1280×720 → 640×360` is fine, `1290×726 → 645×363` is not). Fix it properly
   for both cases with a named warning + auto even-align, and add the
   regression test for the scale-1 case too — it is a real user-facing bug that
   this item happens to be in the right place to fix.

## The flags

| Flag                 | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| `--jpeg-quality <n>` | JPEG capture instead of PNG — faster screenshots, much less IO |
| `--scale <f>`        | `deviceScaleFactor` for preview-size or supersampled output    |
| `--frames <a-b>`     | Render an inclusive subset only                                |
| `--muted`            | Skip the audio mux entirely                                    |

(`--every-nth-frame` remains deferred; it interacts with audio placement in a
way none of these do, and has no clear consumer yet.)

## Design

### `--jpeg-quality <1..100>`

- Capture: `rootHandle.screenshot({type:'jpeg', quality:n, path: …jpg})`
  (`render.mjs:409-411`). Default stays PNG when the flag is absent.
- ffmpeg input pattern switches to `frame-%05d.jpg`
  (`render-lib.mjs:159`, `render.mjs:693`, `:741`) — thread the extension
  through `planEncode`/`planChunkVideoEncode` as a parameter rather than
  branching at three call sites.
- The integrity gate filters `.png` (`render.mjs:635`) — must filter the active
  extension.
- **Stills stay PNG regardless** (`--still` writes a PNG by contract,
  `render-lib.mjs:265-271`). Passing `--jpeg-quality` with `--still` is a
  mistake worth a named error, not a silent ignore.
- **Alpha:** JPEG has none. `--jpeg-quality` + item 13's `--alpha` is a hard
  error naming why.
- Document: the sha256 gate still works, but hashes are only comparable between
  runs with **identical capture settings**. A JPEG hash and a PNG hash of the
  same composition are both correct and different.

### `--scale <f>` (0 < f ≤ 4)

- One place: `applyViewport` (`render.mjs:367-370`) sets
  `deviceScaleFactor: scale`. Every worker must get the same value, including
  the adopted primary (`render.mjs:596`) — a mismatch produces mixed-size PNGs
  and an ffmpeg failure late in the run.
- **Even-dimension handling (also fixes the scale-1 bug above):** compute
  `outW = round(width * f)`, `outH = round(height * f)`. If either is odd and
  the pixel format is `yuv420p`/`yuva420p`, emit a named warning in repo style
  and add `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2` to the encode:

  ```
  ⚠ output is 645×363 (odd dimensions); yuv420p requires even —
    encoding at 644×362. Pass --scale, or change the composition
    dimensions, to control this yourself.
  ```

  Put the decision in a pure helper `planDimensions({width, height, scale,
pixFmt})` in `render-lib.mjs` so it is unit-tested and shared with item 13.

- `--scale` must **not** change `<OffthreadVideo>` extraction: the extract URL
  is keyed by `(src, fps)` (`offthread-server.mjs:44`) and produces a
  native-resolution PNG that CSS fits into the box
  (`OffthreadVideo.tsx:76-80`). Scaling the page scales the display, which is
  correct. Assert the extract cache key is unchanged by `--scale`, or a scaled
  render will silently re-extract every frame.

### `--frames <a-b>` (inclusive, `0 ≤ a ≤ b < durationInFrames`)

- `planChunks` must partition **the subset**, not `[0, durationInFrames)`
  (`render-lib.mjs:292-300`, called at `render.mjs:583-585`). Give it a start
  offset or pass an explicit range; unit-test that chunk unions equal the
  requested range exactly.
- Integrity gate expects `b - a + 1` frames.
- Encode passes `-start_number a` (correction #1).
- Mutually exclusive with `--still` — hard error, matching the existing
  exclusivity style (`render.mjs:109-123`).
- **Audio semantics v1 — be loud about this.** If any audio segment intersects
  the range, drop **all** audio and warn in the same voice as the gif warning
  (`render.mjs:753`):

  ```
  ⚠ --frames 30-59 drops audio: partial-range audio stitching is not
    supported. The output is silent. Render the full range, or use --muted
    to make the omission explicit.
  ```

  Full sub-range audio stitching (re-basing `adelay` and re-trimming) is
  explicitly out of scope; say so in the chapter so it does not get
  half-implemented later.

### `--muted`

- Skip aggregation and the audio branch of `planEncode` entirely
  (`render.mjs:662-675`, `render-lib.mjs:184-244`).
- Makes `--distributed` work with audio-bearing compositions instead of falling
  back to single-stitch (`render.mjs:679-688`) — a genuine, testable win worth
  calling out in the docs.

## The crossings that will actually break

Ship these as tests, per the repo rule:

| Crossing                           | What breaks if wrong                             |
| ---------------------------------- | ------------------------------------------------ |
| `--jpeg-quality` × each `--format` | wrong input pattern / gate counts zero frames    |
| `--jpeg-quality` × `--still`       | contract says PNG → must be a named error        |
| `--scale` × `--distributed`        | chunk containers disagree on dims → concat fails |
| `--scale` × `--concurrency 4`      | adopted worker keeps scale 1 → mixed-size PNGs   |
| `--frames` × `--concurrency`       | chunk planner partitions the wrong interval      |
| `--frames` × `--still`             | must be a hard error                             |
| `--frames` × audio                 | silent-drop warning must fire                    |
| `--muted` × `--distributed`        | should now _enable_ the distributed path         |
| `--scale` × `<OffthreadVideo>`     | extract cache key must not change                |

## Files touched

`scripts/render-lib.mjs` (`planEncode`, `planOutput`, `planChunks`,
`planChunkVideoEncode`, new `planDimensions`), `scripts/render.mjs` (arg
parsing, capture loop, viewport, integrity gate), tests in
`scripts/render-lib.test.mjs`.

## STOP — decisions the executor must not make alone

1. **Do not implement partial-range audio.** It is a semantic trap; v1 drops
   loudly.
2. **Do not make JPEG the default**, however much faster it is. Lossy capture as
   a default silently changes every user's output.
3. **Do not `-vf scale` a render that already has even dimensions** — adding a
   filter to the default path changes bytes for everyone.

## Verification

- **Measured claim, in the PR:** HelloWorld PNG vs `--jpeg-quality 90` — capture
  wall time, total wall time, frames-dir size. If JPEG is not meaningfully
  faster here, say so; the flag may still be worth it for IO but the claim must
  match the measurement.
- Byte-hash identity: PNG run vs PNG run (unchanged); JPEG run vs JPEG run at the
  same quality (stable); explicitly **not** across settings.
- `--frames 30-59 -c 4` output file is byte-identical to `--frames 30-59 -c 1`.
- `ffprobe` a `--scale 0.5` output: dimensions are exactly half (or the
  even-aligned value, matching the warning that was printed).
- **Odd-dimension regression:** a temporary 1281×721 composition at scale 1
  encodes successfully with the warning — this is the pre-existing bug; prove it
  fails before the fix and passes after.
- `--muted` + `--distributed` on `WithAudio`: takes the distributed path (no
  fallback warning) and `ffprobe` shows **no audio stream**.

**Does not cover:** frame-set hashes say nothing about perceived JPEG quality.
Extract one still from a `--jpeg-quality 90` render and eyeball it against the
PNG before recommending a default quality in the docs.

## Docs

Chapter 7 flag table + a short "Capture format and the hash gate" note
explaining why hashes are per-settings. README render-flags blockquote. The
audio-drop policy gets its own callout — it is the surprising part.

## Definition of done

- [ ] four flags implemented, each with a named error for its invalid inputs
- [ ] all nine crossings in the table above have tests
- [ ] odd-dimension bug fixed with a regression test at scale 1
- [ ] JPEG speed measurement reported with real numbers
- [ ] `ffprobe` confirms scaled dims and `--muted`'s missing audio stream
- [ ] chapter 7 + README updated; hash-scope note added
