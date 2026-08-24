# 13 — Alpha-channel export (transparent WebM)

**Status:** ready
**Effort:** M · **Depends on:** 05 (flag plumbing + the even-dimension helper)
**Unblocks:** overlay workflows — lower-thirds, stickers, editor round-trips

## Audit verdict

Genuinely useful, correctly scoped to webm, and right to hard-error on mp4.
Three concrete gaps found while auditing, all of which would produce a file that
_looks_ fine and has no alpha:

1. **The distributed path hard-codes `-pix_fmt yuv420p`**
   (`render-lib.mjs:355-356`), separately from `planEncode`
   (`render-lib.mjs:181-182`). `--alpha --distributed` would encode chunks
   without alpha and then stream-copy them into a container the user believes is
   transparent. The item listed the crossing but not the line — this is the one
   that silently loses the feature.
2. **The page background is opaque black in CSS** — `render.html` sets
   `background: #000` on `html, body`. `omitBackground: true` suppresses
   Puppeteer's _default_ white backdrop; it does not override an authored
   background. The render page needs a transparent background _when alpha is
   requested_, which means the alpha flag has to reach the page (query param,
   like `?props=`) or the CSS must be neutralized before capture.
3. **`libvpx-vp9` + `yuva420p` needs `-auto-alt-ref 0`.** VP9's alt-ref frames
   are incompatible with the alpha channel in many builds and ffmpeg will
   either error or silently drop alpha depending on version. Pin the flag and
   verify against the installed ffmpeg 8.0.

## Design

### Flag

`--format webm --alpha`. `--alpha` with any other format is a hard error naming
the reason:

```
--alpha requires --format webm. mp4/h264 has no practical alpha support in
players; ProRes 4444 and MOV are not implemented. Use --format webm.
```

`--alpha` + `--jpeg-quality` (item 05) is also a hard error — JPEG has no alpha
channel, so the capture would discard it before ffmpeg ever saw it.

### Capture

- `rootHandle.screenshot({omitBackground: true, …})` (`render.mjs:409-411`).
- The **page** must be transparent: pass `?alpha=1` on the render URL
  (`render.mjs:553-557`) and have `main-render.tsx` clear
  `document.documentElement.style.background` /`document.body.style.background`
  when set. Keep the opaque default for normal renders — a transparent
  background on the ordinary path would change what every existing composition
  captures at its edges.
- The demo composition must model correct authoring: **no opaque
  `AbsoluteFill` backdrop**, so the transparency comes from the composition, not
  from a trick.
- Verify **both** capture modes if the pipeline ever uses page screenshots; today
  it is element-only (`render.mjs:409`), so assert that stays true rather than
  testing a path that does not exist.

### Encode

- `planEncode`: `-c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0` plus the
  existing `-crf`/`-b:v 0` (`render-lib.mjs:181`). Audio path is unchanged —
  unlike gif, alpha webm keeps Opus.
- `planChunkVideoEncode` (`render-lib.mjs:324-359`) must take the pixel format
  as a parameter instead of hard-coding it. That is the fix for gap #1, and it is
  a small refactor that item 05's `planDimensions` work touches anyway.
- Reuse item 05's even-dimension helper — `yuva420p` has the same constraint as
  `yuv420p`.
- **Stills keep alpha for free**: PNG screenshots with `omitBackground` are RGBA.
  Assert it rather than assuming.

### Integrity gate

Unchanged — it hashes the PNG bytes, which already include the alpha channel
(`render.mjs:641-643`). Worth one sentence in the docs: transparent renders are
covered by the same determinism guarantee, with no special handling.

## Files touched

`scripts/render-lib.mjs` (`planEncode` alpha branch, `planChunkVideoEncode`
pix-fmt parameter, container validation), `scripts/render.mjs` (flag, screenshot
options, URL param, validation), `src/render/main-render.tsx` (background
neutralization behind `?alpha=1`), demo `WithAlpha` + registry entry + **pinned
id list update in the same commit**, tests.

## STOP — decisions the executor must not make alone

1. **Do not implement MOV/ProRes 4444.** It is a much larger encode-path change
   and mostly matters for NLE round-trips that webm also serves.
2. **Do not make the render page transparent by default.** Changing the default
   background changes every existing composition's captured edges.
3. **Do not "fix" a failing alpha × distributed test by disabling distributed
   for alpha** without first trying the pix-fmt parameter — the crossing is
   supposed to work.

## Risks and crossings

| Crossing / risk              | Why it matters                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--alpha` × `--distributed`  | gap #1 — chunks must also be `yuva420p`, and must remain stream-copy compatible at concat (`render.mjs:712-731`) |
| `--alpha` × audio segments   | must keep Opus, unlike gif (`render-lib.mjs:161-167`)                                                            |
| `--alpha` × `--still`        | PNG keeps alpha — assert                                                                                         |
| `--alpha` × `--jpeg-quality` | hard error                                                                                                       |
| `--alpha` × odd dimensions   | item 05's helper applies to `yuva420p` too                                                                       |
| player support               | many players show alpha webm as black; not our bug, but the docs should say which players honor it               |

## Verification

Declared alpha is not alpha. Prove it three ways:

1. `ffprobe -show_streams` reports `pix_fmt=yuva420p`
2. **Extract a frame and confirm the alpha channel actually varies** —
   `ffmpeg -i out.webm -vf "alphaextract" -frames:v 1 alpha.png` and check the
   result is not uniformly white. A file can declare `yuva420p` with a fully
   opaque alpha plane; that is the failure this catches.
3. **Composite check:** overlay the webm on a solid magenta background with
   ffmpeg and confirm magenta shows through where the composition is
   transparent. This is the test that matches what a user will actually do.

Plus:

- `--alpha --distributed -c 4` passes all three checks (the regression test for
  gap #1) and its output is stream-copy concatenated, not re-encoded
- `--alpha` with audio: `ffprobe` shows both a `yuva420p` video stream and an
  Opus audio stream
- `--still` on the alpha demo produces a PNG whose alpha channel varies
- frame-set hash identical at `-c 1` vs `-c 4`

**Does not cover:** none of this proves a given editor imports the file. Name the
players/editors actually tested (and their versions) in the chapter rather than
claiming general compatibility.

## Docs

Chapter 7 formats section: the alpha flag, why mp4 is refused, the
`-auto-alt-ref 0` reason, and which demo demonstrates it. README flags table.
One line on how to author for transparency (no opaque backdrop) — that is the
part authors get wrong.

## Definition of done

- [ ] `--alpha` implemented; mp4 and JPEG combinations hard-error with reasons
- [ ] `planChunkVideoEncode` takes pix-fmt as a parameter (gap #1 fixed)
- [ ] render page transparent only under `?alpha=1`
- [ ] all three alpha proofs pass, at `-c 1` and `-c 4 --distributed`
- [ ] `--still` alpha asserted; audio stream survives
- [ ] `WithAlpha` demo registered; pinned id list updated same commit
- [ ] chapter 7 + README updated; tested players named
