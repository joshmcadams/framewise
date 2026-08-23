# 11 — `--distributed --format webm` fails at the concat step

**Type:** Bug (correctness) · **Severity:** High · **Introduced by:** plan 030 (`444c54f`)
**Status:** DONE — fixed by plan 032 (backlog option 1: chunk codec/container derived from `format`; mp4 concat also gained `+faststart`).

## Problem

`planChunkVideoEncode` (`scripts/render-lib.mjs:250-282`) hardcodes
`codec ?? 'libx264'`, and `render.mjs:672` hardcodes the chunk filename as
`chunk-${i}.mp4`. But the `canDistribute` guard (`render.mjs:656`) only excludes
`gif`:

```js
const canDistribute = distributed && segments.length === 0 && format !== 'gif';
```

So `--distributed --format webm` renders every frame, encodes H.264 chunks, then
stream-copies them into `out/video.webm`:

```
[webm @ …] Only VP8 or VP9 or AV1 video and Vorbis or Opus audio and WebVTT
          subtitles are supported for WebM.
[out#0/webm @ …] Could not write header (incorrect codec parameters ?)
Conversion failed!
```

Reproduced directly with ffmpeg 8.0 against two libx264 `.mp4` chunks and a
`-f concat -safe 0 -c copy` into `.webm`.

Note also `render.mjs:522` preflights the *webm* default encoder
(`libvpx-vp9`) — the codec the distributed path then never uses — so the
preflight cannot catch this either.

## Fix

Either:

1. Derive the chunk codec and container from `format` (webm chunks → `.webm` +
   `libvpx-vp9`), passing `format` into `planChunkVideoEncode`; or
2. Add `format === 'webm'` to the fallback branch alongside `gif`, with a
   matching `console.warn`, and document the mp4-only limitation.

(1) is the better teaching outcome; (2) is the honest minimum.

## Related: the determinism claim is weaker than it reads

Plan 030 records `--distributed` as "hash-identical to local". That is the
**frame-set** sha256 (`render.mjs:614-623`), computed *before* any encoding, from
the same PNGs both paths screenshot — it is identical by construction and says
nothing about the concatenated output. Add a smoke step that actually probes the
produced file (`ffprobe` stream count, codec, duration, frame count) so the
distributed path has real end-to-end verification.

## Acceptance

- `npm run render -- --comp HelloWorld --distributed --concurrency 2 --format webm --out out/v.webm`
  either produces a playable VP9 webm or fails fast *before* rendering frames.
- A regression test in `render-lib.test.mjs` pins the chunk container/codec
  chosen per format.
