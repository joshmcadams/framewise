# framewise-lite

A minimal, educational reimplementation of [Framewise](https://www.framewise.dev/)'s
**core** — the part that makes "a video is a function of the frame number" real.
It implements the frame-as-state engine, `interpolate`, `spring`, `<Sequence>`,
a `<Player>` clock, a **Puppeteer + ffmpeg renderer** that turns a composition
into an `.mp4`, **`delayRender`** so async assets render deterministically,
**`<Audio>`** mixed/muxed with ffmpeg, frame-accurate embedded **`<Video>`**, and
**parallel chunked rendering** (all six stages — see [Roadmap](#roadmap)).

```bash
npm install
npm run dev     # open http://localhost:5173  (Space = play/pause, ←/→ = step)
npm test        # unit tests for interpolate, spring, audio-registry, Sequence, Player, delayRender
npm run build   # typecheck + production build
npm run render -- --out out/hello.mp4    # render the demo to an mp4 (needs ffmpeg + Chrome)

# See delayRender in action — render an async composition broken vs fixed:
npm run render -- --comp AsyncImage --no-wait --out out/broken.mp4   # captures too early
npm run render -- --comp AsyncImage           --out out/fixed.mp4    # waits for the asset

# Render a composition with a soundtrack (mixed + muxed by ffmpeg):
npm run render -- --comp WithAudio --out out/withaudio.mp4

# Render a composition with frame-accurate embedded video + its audio:
npm run render -- --comp WithVideo --out out/withvideo.mp4

# Render in parallel across 4 browsers (identical output, ~2.6x faster):
npm run render -- --comp HelloWorld --concurrency 4 --out out/hello.mp4

# Parametrize a composition from the CLI and tune the encode:
npm run render -- --comp HelloWorld --props '{"title":"Hi"}' --crf 28 --codec libx265 --out out/hi.mp4
```

> Render flags: `--props <json>` (merged over the comp's defaultProps),
> `--crf <n>` (quality, default 18), `--codec <name>` (default libx264),
> `--audio-bitrate <k>` (default 192k), `--public-dir <path>` (asset base dir,
> default `public`). The renderer fails fast with a clear message if `ffmpeg` or
> Chrome is missing.

> **Rendering requires `ffmpeg` on your PATH and Google Chrome (or Chromium)
> installed** (the renderer uses `puppeteer-core` pointed at the system browser).
> It auto-detects Chrome/Chromium on macOS, Linux, and Windows; for a
> non-standard install set `CHROME_PATH` (or `PUPPETEER_EXECUTABLE_PATH`) or pass
> `--chrome <path>`. See
> [chapter 7](docs/code/07-renderer.md) (renderer) and
> [chapter 8](docs/code/08-delay-render.md) (delayRender) for how it works.

## The one idea

A composition is a normal React component that calls `useCurrentFrame()` and
renders differently per frame. To *play* it, something advances the frame and
re-renders. To *export* it, something would set frame 0 → screenshot → frame 1 →
screenshot → … The component is identical in both cases. That equivalence is
Framewise's whole value proposition, and the architecture here protects it:
**`useCurrentFrame()` only ever reads the frame from context. It knows nothing
about clocks.** The `<Player>` is just one possible frame source.

## What's here, and how it maps to real Framewise

| File | What it is | Real Framewise equivalent |
|---|---|---|
| `src/framewise-lite/VideoConfig.tsx` | Frame + config contexts, `useCurrentFrame`, `useVideoConfig`, `AbsoluteFill` | Same hooks; `framewise` core |
| `src/framewise-lite/interpolate.ts` | Map a value between ranges (extend/clamp/identity/wrap, easing, multi-segment, posterize¹) | Faithful port of `interpolate` (numeric path only); `posterize` is an extension not in upstream |
| `src/framewise-lite/spring.ts` | Damped-harmonic-oscillator animation | Verbatim math from `spring/spring-utils.ts` |
| `src/framewise-lite/Sequence.tsx` | Shifts the frame so children start at 0; clips outside the window | `<Sequence>` (Series/transitions build on it) |
| `src/framewise-lite/Player.tsx` | A wall-clock frame source with controls + scrubber + pending badge | `@framewise/player`'s `<Player>` |
| `src/framewise-lite/delay-render.ts` | `delayRender`/`continueRender` handle registry | Same API; `framewise` core |
| `src/framewise-lite/Img.tsx` | `<img>` that blocks the render until loaded | `<Img>` from `framewise` |
| `src/framewise-lite/Audio.tsx` | `<Audio>` — collected for the mix in render, played in preview | `<Audio>` from `framewise` |
| `src/framewise-lite/Video.tsx` | `<Video>` — frame-accurate seek gated by delayRender + audio mux | `<Video>`/`<OffthreadVideo>` from `framewise` |
| `src/framewise-lite/audio-registry.ts` | Per-frame audio collection sink | Framewise's render-time asset collection |
| `src/framewise-lite/playback.ts` | Preview-only playback context | Player playback state |
| `src/compositions/HelloWorld.tsx` | Demo composition exercising every primitive | A composition registered in `Root.tsx` |
| `src/compositions/AsyncImage.tsx` | Async demo: `<Img>` + a delayRender-gated fetch | A composition that loads assets |
| `src/compositions/WithAudio.tsx` | Audio demo: bg tone + an offset blip in a `<Sequence>` | A composition with a soundtrack |
| `src/compositions/WithVideo.tsx` | Embedded-video demo: clip + a React overlay | A composition embedding footage |
| `src/render/registry.ts` | Composition registry (id → component + metadata) | `<Composition>` declarations in `Root.tsx` |
| `src/render/main-render.tsx` | Chrome-less render entry exposing `window.framewiseLite.renderFrame` | Framewise's `window.framewise_setFrame` seam |
| `scripts/render.mjs` | Vite + Puppeteer + ffmpeg → mp4; waits on delayRender; parallel chunks | `@framewise/renderer` + `@framewise/lambda` (concurrency) |

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

These are real, but they're not the *core idea* — adding them is the next stage:

- **`<OffthreadVideo>`-style frame extraction.** Our `<Video>` seeks a live
  `<video>` element (spike-verified frame-accurate here); the more robust
  production approach extracts each frame via ffmpeg and renders it through
  `<Img>` — see [chapter 10](docs/code/10-video.md).
- **Per-frame volume automation & frame-accurate A/V sync.** Our audio/video use
  constant per-segment volume and best-effort preview sync; sample-accuracy is a
  deeper problem.
- **Distributed rendering.** Stage 6 parallelizes across local browsers into a
  shared frames dir. Framewise Lambda goes further — workers on *separate machines*
  encode chunk videos and concatenate them, because they can't share a filesystem.
  Same idea, plus a network. See [chapter 11](docs/code/11-parallel-rendering.md).
- **`interpolate` string/tuple outputs** (`"scale(2)"`), **`Series`,
  transitions, `Easing` library, `measureSpring`/`reverse`/`durationInFrames`.**
  All buildable on what's here.

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
