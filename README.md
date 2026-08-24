# framewise-lite

A minimal, educational reimplementation of [Framewise](https://www.framewise.dev/)'s
**core** — the part that makes "a video is a function of the frame number" real.
It implements the frame-as-state engine, `interpolate`, `spring`, `<Sequence>`,
a `<Player>` clock, a **Puppeteer + ffmpeg renderer** that turns a composition
into an `.mp4`, **`delayRender`** so async assets render deterministically,
**`<Audio>`** mixed/muxed with ffmpeg, frame-accurate embedded **`<Video>`**,
**parallel chunked rendering**, and **distributed chunk-encode + concat**
(`--distributed`, all stages — see [Roadmap](#roadmap)).

> **New here?** [docs/tutorial.md](docs/tutorial.md) walks you through building
> a promo video step by step — animation, springs, scenes, media, audio, props,
> and export.

```bash
npm install
npm run dev     # open http://localhost:5173  (Space = play/pause, ←/→ = step)
npm test        # unit tests for interpolate, spring, audio-registry, Sequence, Player, delayRender, staticFile, random
npm run build   # typecheck + production build
npm run render -- --list                 # list available composition IDs (no Chrome needed)
npm run render -- --out out/hello.mp4    # render the demo to an mp4 (needs ffmpeg + Chrome)

# See delayRender in action — render an async composition broken vs fixed:
npm run render -- --comp AsyncImage --no-wait --out out/broken.mp4   # captures too early
npm run render -- --comp AsyncImage           --out out/fixed.mp4    # waits for the asset

# Render a composition with a soundtrack (mixed + muxed by ffmpeg):
npm run render -- --comp WithAudio --out out/withaudio.mp4

# Render a composition with frame-accurate embedded video + its audio:
npm run render -- --comp WithVideo --out out/withvideo.mp4

# Same idea via ffmpeg frame extraction instead of live-element seeking:
npm run render -- --comp WithOffthread --out out/offthread.mp4

# Render in parallel across 4 browsers (identical output, ~2.6x faster):
npm run render -- --comp HelloWorld --concurrency 4 --out out/hello.mp4

# Distributed chunk-encode + concat (same pixels, HelloWorld hash identical):
npm run render -- --comp HelloWorld --concurrency 4 --distributed --out out/hello-dist.mp4

# Parametrize a composition from the CLI and tune the encode:
npm run render -- --comp HelloWorld --props '{"title":"Hi"}' --crf 28 --codec libx265 --out out/hi.mp4

# Output formats: webm (VP9 + Opus), gif (palette filter, drops audio), PNG sequence:
npm run render -- --comp WithAudio --format webm --out out/withaudio.webm
npm run render -- --comp HelloWorld --format gif --out out/hello.gif
npm run render -- --comp HelloWorld --format png-seq --out out/frames

# Render a single frame as a still PNG:
npm run render -- --comp WithVideo --still 75 --out out/still-75.png
```

> Render flags: `--props <json>` (merged over the comp's defaultProps),
> `--format mp4|webm|gif|png-seq` (output format, default mp4),
> `--crf <n>` (quality, default 18), `--codec <name>` (overrides the format
> default codec), `--audio-bitrate <k>` (default 192k),
> `--public-dir <path>` (asset base dir, default `public`),
> `--still <frame>` (single-frame PNG still; mutually exclusive with `--format`/`--concurrency`),
> `--distributed` (Lambda-style chunk-encode + concat; video-only, requires `--concurrency` ≥2).
> The renderer fails fast with a clear message if `ffmpeg` or
> Chrome is missing. GIF output drops audio (a warning is printed if the comp
> has audio segments). `--format png-seq` treats `--out` as a directory and
> copies the raw PNG frames there — no ffmpeg is invoked.

> **Rendering requires `ffmpeg` on your PATH and Google Chrome (or Chromium)
> installed** (the renderer uses `puppeteer-core` pointed at the system browser).
> It auto-detects Chrome/Chromium on macOS, Linux, and Windows; for a
> non-standard install set `CHROME_PATH` (or `PUPPETEER_EXECUTABLE_PATH`) or pass
> `--chrome <path>`. Chrome's sandbox is on by default; pass `--no-sandbox` when
> running as root or in a container where it cannot start. See
> [chapter 7](docs/code/07-renderer.md) (renderer) and
> [chapter 8](docs/code/08-delay-render.md) (delayRender) for how it works.

## The one idea

A composition is a normal React component that calls `useCurrentFrame()` and
renders differently per frame. To _play_ it, something advances the frame and
re-renders. To _export_ it, something would set frame 0 → screenshot → frame 1 →
screenshot → … The component is identical in both cases. That equivalence is
Framewise's whole value proposition, and the architecture here protects it:
**`useCurrentFrame()` only ever reads the frame from context. It knows nothing
about clocks.** The `<Player>` is just one possible frame source.

## What's here, and how it maps to real Framewise

| File                                       | What it is                                                                                                                  | Real Framewise equivalent                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/framewise-lite/VideoConfig.tsx`       | Frame + config contexts, `useCurrentFrame`, `useVideoConfig`, `AbsoluteFill`                                                | Same hooks; `framewise` core                                                                          |
| `src/framewise-lite/interpolate.ts`        | Map a value between ranges (extend/clamp/identity/wrap, easing, multi-segment, tuple & string-template outputs, posterize¹) | Faithful port of `interpolate`; `posterize` and template/tuple outputs are extensions not in upstream |
| `src/framewise-lite/interpolate-colors.ts` | Blend hex/rgb()/hsl() colors into an `rgba()` string                                                                        | `interpolateColors` from `framewise`                                                                  |
| `src/framewise-lite/spring.ts`             | Damped-harmonic-oscillator animation + `measureSpring` / `durationInFrames` / `reverse`                                     | Verbatim math from `spring/spring-utils.ts`; same time-control options                                |
| `src/framewise-lite/Sequence.tsx`          | Shifts the frame so children start at 0; clips outside the window                                                           | `<Sequence>` (Series/transitions build on it)                                                         |
| `src/framewise-lite/Series.tsx`            | Plays `<Series.Sequence>` clips back-to-back via auto-computed offsets                                                      | `<Series>` from `framewise`                                                                           |
| `src/framewise-lite/Loop.tsx`              | Repeats children on a fixed beat, clock re-based every cycle                                                                | `<Loop>` from `framewise`                                                                             |
| `src/framewise-lite/Player.tsx`            | A wall-clock frame source with controls + scrubber + pending badge                                                          | `@framewise/player`'s `<Player>`                                                                      |
| `src/framewise-lite/delay-render.ts`       | `delayRender`/`continueRender` handle registry                                                                              | Same API; `framewise` core                                                                            |
| `src/framewise-lite/easing.ts`             | Standard easing curves and combinators (incl. back/bounce/elastic)                                                          | `Easing` module from `framewise`                                                                      |
| `src/framewise-lite/Img.tsx`               | `<img>` that blocks the render until loaded                                                                                 | `<Img>` from `framewise`                                                                              |
| `src/framewise-lite/Audio.tsx`             | `<Audio>` — collected for the mix in render, played in preview                                                              | `<Audio>` from `framewise`                                                                            |
| `src/framewise-lite/Video.tsx`             | `<Video>` — frame-accurate seek gated by delayRender + audio mux                                                            | `<Video>` from `framewise`                                                                            |
| `src/framewise-lite/OffthreadVideo.tsx`    | `<OffthreadVideo>` — ffmpeg-extracted frames rendered through `<Img>`                                                       | `<OffthreadVideo>` from `framewise`                                                                   |
| `src/framewise-lite/audio-registry.ts`     | Per-frame audio collection sink                                                                                             | Framewise's render-time asset collection                                                              |
| `src/framewise-lite/staticFile.ts`         | `staticFile('photo.png')` → `'/photo.png'`; keeps public-dir convention explicit                                            | `staticFile()` from `framewise`                                                                       |
| `src/framewise-lite/random.ts`             | Seeded PRNG (FNV-1a + mulberry32) — identical in preview and all render workers                                             | `random(seed)` from `framewise`                                                                       |
| `src/framewise-lite/playback.ts`           | Preview-only playback context                                                                                               | Player playback state                                                                                 |
| `src/compositions/HelloWorld.tsx`          | Demo composition exercising every primitive                                                                                 | A composition registered in `Root.tsx`                                                                |
| `src/compositions/AsyncImage.tsx`          | Async demo: `<Img>` + a delayRender-gated fetch                                                                             | A composition that loads assets                                                                       |
| `src/compositions/WithAudio.tsx`           | Audio demo: bg tone + an offset blip in a `<Sequence>`                                                                      | A composition with a soundtrack                                                                       |
| `src/compositions/WithVideo.tsx`           | Embedded-video demo: clip + a React overlay                                                                                 | A composition embedding footage                                                                       |
| `src/compositions/WithOffthread.tsx`       | `<OffthreadVideo>` demo — same layout as WithVideo for A/B comparison                                                       | A composition using `<OffthreadVideo>`                                                                |
| `src/compositions/Countdown.tsx`           | `calculateMetadata` demo: duration derived from `props.seconds`                                                             | A composition with dynamic metadata                                                                   |
| `src/compositions/WithSeries.tsx`          | Timeline demo: `<Series>` cards, a nested `<Series>`, a `<Loop>` pulse                                                      | A composition using `<Series>`/`<Loop>`                                                               |
| `src/render/registry.ts`                   | Composition registry (id → component + metadata) + `calculateMetadata` resolver                                             | `<Composition>` declarations in `Root.tsx`                                                            |
| `src/render/main-render.tsx`               | Chrome-less render entry exposing `window.framewiseLite.renderFrame`                                                        | Framewise's `window.framewise_setFrame` seam                                                          |
| `scripts/render.mjs`                       | Vite + Puppeteer + ffmpeg → mp4; waits on delayRender; parallel chunks                                                      | `@framewise/renderer` + `@framewise/lambda` (concurrency)                                             |

### Notes on fidelity (the parts that are easy to get subtly wrong)

- **`interpolate` defaults to `extend`, not `clamp`.** `interpolate(15, [0,10],
[0,100])` is `150`, not `100`. People expect clamping; Framewise extrapolates.
  Ported exactly, with the same validation errors (non-monotonic input range
  throws).
- **`spring` is copied math, not reconstructed.** The analytical underdamped /
  critically-damped solution is the classic "almost right" trap, so it's a
  verbatim copy of Framewise's `advance()` / `springCalculation()`. Defaults:
  `mass 1, damping 10, stiffness 100`. At frame 0 it equals `from`; with the
  default underdamped config it overshoots before settling. One deliberate
  deviation: `overshootClamping` clamps in output space (after mapping to
  `[from, to]`) so it works correctly for any range, not just `to === 1`. Upstream
  clamps in normalized space, which silently does nothing when `to !== 1`.
- **The Player clock derives frame from elapsed wall-clock time**
  (`floor(elapsedMs * fps / 1000)`), never `frame++` per animation frame.
  Incrementing per tick would couple playback speed to the monitor refresh rate
  (a 30fps comp would run 2× on a 120Hz display). This is the #1 thing naive
  players get wrong.

## Deliberately omitted (and why)

These are real, but they're not the _core idea_ — adding them is the next stage:

- **Frame-accurate A/V sync in preview.** The preview sync is best-effort by
  design (0.3 s drift-snap policy); render-path audio placement is measured at
  ±0.5 ms — see the "How sample-accurate is it?" section in
  [chapter 9](docs/code/09-audio.md). (`<OffthreadVideo>` frame extraction has since landed — see
  [chapter 10](docs/code/10-video.md) for both embedded-video paths.)
- **Distributed rendering.** Stage 6 parallelizes across local browsers into a
  shared frames dir. Framewise Lambda goes further — workers on _separate machines_
  encode chunk videos and concatenate them, because they can't share a filesystem.
  Same idea, plus a network. See [chapter 11](docs/code/11-parallel-rendering.md).
- **Transitions** — overlapping `<Sequence>`s with interpolated cross-fades.
  Buildable on what's here.

## Roadmap

1. ✅ **Player + core API** — the conceptual core at ~10% of the effort.
2. ✅ **Naive renderer** (`npm run render`) — Puppeteer + headless Chrome
   screenshotting each frame, ffmpeg to mp4. Works for synchronous visual comps;
   breaks on async assets — which teaches you exactly why `delayRender()` exists.
   Verified by extracting frame 45 from the output and confirming it shows the
   identical scene/animation state as the Player's frame 45 — same component,
   two frame sources. See [chapter 7](docs/code/07-renderer.md).
3. ✅ **delayRender** (`delayRender`/`continueRender` + `<Img>`) — async assets
   now block the capture. Proved with a controlled before/after experiment
   (`--comp AsyncImage --no-wait` vs not): frame 0 shows `Loading…` vs the
   resolved content, and the pending-at-capture logs differ decisively. See
   [chapter 8](docs/code/08-delay-render.md).
4. ✅ **Audio** (`<Audio>`) — audio isn't screenshotted; the renderer collects
   each frame's active audio, aggregates it into segments, and mixes/muxes them
   with ffmpeg. Verified that an offset blip lands at 2.0s and sums with the
   background (`volumedetect` windows differ by ~8 dB). See
   [chapter 9](docs/code/09-audio.md).
5. ✅ **Embedded `<Video>`** — frame-accurate: each frame seeks the `<video>` and
   gates the capture on `delayRender` (reusing Stage 3), while its audio track is
   muxed via the Stage 4 path. Verified that comp frames 30/75/120 show the
   embedded video's matching frame number, with a React overlay composited on
   top. See [chapter 10](docs/code/10-video.md).
6. ✅ **Parallel chunked rendering** (`--concurrency N`) — split the frame range
   across separate browsers and render concurrently into a shared frames dir.
   Because a frame is a pure function of its number, the output is identical
   regardless of concurrency: verified that HelloWorld renders to a byte-identical
   frame hash at concurrency 1 and 4, ~2.6× faster. See
   [chapter 11](docs/code/11-parallel-rendering.md).
7. ✅ **Distributed chunk-encode + concat** (`--distributed`) — each chunk encodes
   to a video, then concat demuxer stream-copies them (video-only; audio falls
   back to single-stitch with a warning). HelloWorld c4 hash identical to local
   single-stitch. See [chapter 11](docs/code/11-parallel-rendering.md).
