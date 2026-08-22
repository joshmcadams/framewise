# Plan 021 — `<OffthreadVideo>`: ffmpeg-extracted frames through the `<Img>` path

**Status:** DONE (2026-08-23) — implemented as designed. `<OffthreadVideo>`
previews as a live `<Video>` and renders as an ffmpeg-extracted PNG through
`<Img>`; the extraction endpoint (`scripts/offthread-server.mjs`, Vite
middleware with disk cache + in-flight dedupe) seeks to exactly `frame / fps`.
14 new tests (9 server, 5 component); repo at 263. Live verification: comp
stills 30/75/120 read back "30"/"75"/"120" — matching chapter 10's live-seek
verification. One real bug caught during verification: the first draft reused
`<Video>`'s half-frame nudge for `-ss`, but ffmpeg selects by PTS ≥ target,
so every frame landed one late — fixed and pinned by a regression test.
Also: `render.mjs`'s `mkdtemp` moved above `createServer` so the extraction
cache lives under the existing temp dir (cleanup unchanged).
**Priority:** P1 · **Effort:** L · **Risk:** MEDIUM (new renderer surface; must not perturb existing renders)
**Depends on:** none open (builds on Stage 3 `<Img>`/delayRender and Stage 4 audio mux; plan 017 validated ffmpeg end-to-end)
**Category:** direction (Phase 2 item 1 in `docs/OVERVIEW.md` §14 — "biggest correctness win available")

## Why

Chapter 10 names it explicitly: relying on a live `<video>` element's seek +
compositor paint is the fragile part of embedded video, and "the more robust
production approach extracts each frame via ffmpeg and renders it through
`<Img>`". This plan builds that as `<OffthreadVideo>` — frame-accurate by
construction, no compositor dependency, reusing Stages 3+4 directly.

## Design

### Component (`src/framewise-lite/OffthreadVideo.tsx`)

- Props identical to `VideoProps` (src, volume, startFrom, muted, style).
- **PREVIEW** (playback ≠ null): renders a real `<Video>` unchanged — live
  element sync is exactly right for interactive scrubbing.
- **RENDER** (playback === null):
  - Audio: reports `{id, src, mediaTime, volume}` to the audio-registry unless
    `muted`, byte-for-byte like `<Video>` (Stage 4 needs no changes).
  - Visual: an `<Img>` whose src points at the extraction endpoint:
    `/__framewise_extract/<base64url(src)>/<videoFrame>.png?fps=<fps>`.
    `videoFrame = compositionFrame + startFrom`; `fps` comes from
    `useVideoConfig()`. The half-frame nudge lives on the server side so the
    URL stays cache-stable per frame. `<Img>`'s existing delayRender gating
    blocks capture until extraction + transfer completes.

### Extraction endpoint (`scripts/offthread-server.mjs`, imported by render.mjs)

- Vite plugin `framewiseExtract({publicDir, cacheDir})` → middleware on
  `/__framewise_extract`.
  - Request path decodes to `{src, videoFrame}`; `fps` from query.
  - Cache file: `<cacheDir>/<sha1(src)>/<frame padded>.png` — hit ⇒ serve,
    miss ⇒ extract then serve.
  - Extract command: `ffmpeg -y -ss <time> -i <absFile> -frames:v 1 -q:v 2 <out>`
    with `time = (videoFrame + 0.5) / fps` — the same half-frame nudge chapter
    10 verified (`-ss` before `-i` for speed).
  - Concurrent duplicate requests dedupe on one in-flight promise.
  - Errors (missing file, bad fps, ffmpeg failure) ⇒ 500 with actionable text.
- Pure pieces exported for unit tests: `parseExtractUrl(url)`,
  `buildFfmpegArgs(seconds, input, output)`.
- `render.mjs`: move `mkdtemp(framesDir)` above `createServer`, pass
  `plugins:[framewiseExtract({publicDir, cacheDir: join(framesDir, 'offthread')})]`
  — cleanup already removes `framesDir`, so nothing new leaks.

### Demo

New `src/compositions/WithOffthread.tsx` mirroring `WithVideo` (clip full-frame
+ overlay banner) so output is directly comparable; registered as id
`WithOffthread`.

## Steps

1. Implement the component; export from `index.ts`.
2. Implement `offthread-server.mjs` (+ wire into `render.mjs`); unit-test
   pure helpers + middleware happy/duplicate/error paths with an injected
   runner and temp dirs.
3. Component tests following `Video.test.tsx` conventions: render mode emits
   the exact `<img src>`, reports audio (and skips when muted), preview mode
   renders a `<video>` instead; delayRender pending while image not loaded.
4. Demo composition + registry entry; `--list` picks it up.
5. Docs: extend chapter 10 ("The honest alternative, realized" section);
   source map tree + chapter row; top-level README table row + example;
   OVERVIEW §5 row and Phase 2 progress note.
6. Gate: `npm run verify`. Live check (this machine has ffmpeg): render
   `WithOffthread --still 75` and confirm the extracted frame shows the
   expected content.

## STOP conditions

- Any previously-rendering composition regressing (hash-relevant code paths
  untouched by design) → stop.
- If wiring requires touching `Video.tsx`, `Img.tsx`, or the audio mux → stop
  and report; this plan assumed zero edits there.

## Done means

Component + endpoint + demo + tests + docs landed in one commit series;
verify green; live still-render sanity-checked; plan Status header and
`plans/README.md` row flipped to DONE.
