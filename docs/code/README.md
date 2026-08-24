# framewise-lite — Code Walkthrough

> **Author, not reader?** If you want to _make videos_ rather than study the
> engine, start with the [step-by-step tutorial](../tutorial.md) — this
> walkthrough explains how the machinery under it works.

This is a guided tour of the codebase, written to be read top-to-bottom as a
way of _understanding how Framewise works_, not just how this clone is wired.
Each chapter takes one module, explains the idea it implements, then walks the
code and calls out the parts that are subtle or easy to get wrong.

> **What this is:** a complete, working, verified educational reimplementation of
> Framewise's _core_ — the frame-as-state engine, the animation primitives
> (`interpolate`, `spring`, `<Sequence>`), a `<Player>`, a headless-Chrome +
> ffmpeg renderer, deterministic async assets (`delayRender`), audio, embedded
> video, and parallel rendering. All eleven chapters below are implemented and
> tested.
>
> **What it deliberately isn't:** production Framewise. It keeps the _numeric_ path
> of `interpolate`, _constant_ per-segment volume, _best-effort_ preview A/V sync,
> a _live-element_ `<Video>` (not ffmpeg frame-extraction), and _single-machine_
> parallelism (not cross-machine encode+concat). Each chapter names its own
> simplifications and points at the production-grade version.

## The single idea everything hangs off

> **A video is a pure function of the frame number.**

A composition is an ordinary React component. It asks "what frame are we on?"
and renders accordingly. Nothing in a composition knows whether it's being
_played_ (frames advanced by a clock) or _rendered_ (frames advanced by an
exporter taking screenshots). That indifference is the whole point — the
preview and the final export run the identical code. Every design choice in
this repo exists to protect that property.

## Architecture at a glance

```
                     ┌──────────────────────────────────────────┐
                     │  Player  (the frame SOURCE — owns a clock) │
                     │                                            │
   wall clock  ──▶   │   frame = floor(elapsedMs * fps / 1000)    │
                     │                                            │
                     │   <VideoConfigProvider value={config}>     │
                     │     <FrameProvider value={frame}>          │
                     └───────────────┬────────────────────────────┘
                                     │  (frame + config via React context)
                                     ▼
                     ┌──────────────────────────────────────────┐
                     │  Your composition  (a React component)     │
                     │                                            │
                     │   const frame = useCurrentFrame()  ◀── READ│ only
                     │   const {fps} = useVideoConfig()           │
                     │                                            │
                     │   spring({frame, fps})      ── animate     │
                     │   interpolate(frame, …)     ── animate     │
                     │   <Sequence from={25}>      ── re-time     │
                     └──────────────────────────────────────────┘
```

The arrow only points **down**. The composition _reads_ the frame; it never
sets it. The `Player` is just one thing that writes it. Swap the `Player` for a
"render driver" that sets frame 0 → screenshot → frame 1 → screenshot, and the
exact same composition becomes an exporter. That seam is the most important
line in the codebase, and it lives in `VideoConfig.tsx`.

## Reading order

| #   | Chapter                                        | File covered                                                                  | What you'll learn                                                                                                |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | [The frame engine](01-frame-engine.md)         | `src/framewise-lite/VideoConfig.tsx`                                          | The contexts, `useCurrentFrame`/`useVideoConfig`, why the seam matters                                           |
| 2   | [interpolate](02-interpolate.md)               | `src/framewise-lite/interpolate.ts`, `interpolate-colors.ts`                  | Range mapping, the surprising `extend` default, multi-segment keyframes, easing, tuples/string templates, colors |
| 3   | [spring](03-spring.md)                         | `src/framewise-lite/spring.ts`                                                | The damped-oscillator physics, why it's iterated, the public wrapper                                             |
| 4   | [Sequence](04-sequence.md)                     | `src/framewise-lite/Sequence.tsx`, `Series.tsx`, `Loop.tsx`                   | Time-shifting via context, how 20 lines power timelines; `<Series>` and `<Loop>` build on it                     |
| 5   | [The Player](05-player.md)                     | `src/framewise-lite/Player.tsx`                                               | The wall-clock loop, seeking, the #1 playback bug, responsive scaling                                            |
| 6   | [Demo & wiring](06-demo-and-wiring.md)         | `HelloWorld.tsx`, `App.tsx`, `main.tsx`                                       | How the primitives combine into a real animation                                                                 |
| 7   | [The Renderer](07-renderer.md)                 | `scripts/render.mjs`, `scripts/render-lib.mjs`, `render.html`, `src/render/*` | Stage 2: Puppeteer screenshots + ffmpeg → mp4, why it's naive, output formats + stills                           |
| 8   | [delayRender](08-delay-render.md)              | `delay-render.ts`, `Img.tsx`, `AsyncImage.tsx`                                | Stage 3: making async assets block the capture, proved with a before/after experiment                            |
| 9   | [Audio](09-audio.md)                           | `audio-registry.ts`, `playback.ts`, `Audio.tsx`, `WithAudio.tsx`              | Stage 4: collecting audio per frame and mixing/muxing it with ffmpeg                                             |
| 10  | [Embedded Video](10-video.md)                  | `Video.tsx`, `OffthreadVideo.tsx`, `WithVideo.tsx`, `WithOffthread.tsx`       | Stage 5: frame-accurate `<Video>` via seek-gating, and `<OffthreadVideo>` via ffmpeg extraction + `<Img>`        |
| 11  | [Parallel Rendering](11-parallel-rendering.md) | `scripts/render.mjs`                                                          | Stage 6: render chunks across browsers concurrently, deterministically                                           |

## Map of the source tree

```
src/
├── framewise-lite/          ← the "library" (what you'd publish)
│   ├── VideoConfig.tsx      contexts + hooks + AbsoluteFill   (ch. 1)
│   ├── interpolate.ts       value range mapping               (ch. 2)
│   ├── interpolate-colors.ts  color mixing → rgba() strings    (ch. 2)
│   ├── spring.ts            physics-based animation           (ch. 3)
│   ├── Sequence.tsx         the time-shifter                  (ch. 4)
│   ├── Series.tsx           back-to-back clips on one timeline (ch. 4)
│   ├── Loop.tsx             repeat with a re-based clock      (ch. 4)
│   ├── Player.tsx           the playback clock + UI + badge   (ch. 5, 8)
│   ├── CompositionHost.tsx  shared provider stack — both frame sources
│   │                         render through it               (ch. 5, 7)
│   ├── delay-render.ts      delayRender/continueRender registry (ch. 8)
│   ├── delay-render-defaults.mjs + .d.mts  shared timeout constants
│   │                         for TS and render.mjs
│   ├── Img.tsx              delayRender-aware <img>           (ch. 8)
│   ├── audio-registry.ts    per-frame audio collection sink   (ch. 9)
│   ├── playback.ts          preview-only playback context     (ch. 9)
│   ├── Audio.tsx            <Audio> primitive                 (ch. 9)
│   ├── Video.tsx            <Video> primitive (seek + mux)    (ch. 10)
│   ├── OffthreadVideo.tsx   <OffthreadVideo>: ffmpeg frames via <Img> (ch. 10)
│   ├── staticFile.ts        asset-path utility                 (ch. 6, 11)
│   ├── random.ts            seeded random (deterministic render) (ch. 6, 11)
│   ├── easing.ts            easing curves and combinators       (ch. 2)
│   ├── index.ts             public barrel export
│   └── *.test.ts(x)         each core module has a colocated test suite
├── compositions/
│   ├── HelloWorld.tsx       the demo video                    (ch. 6)
│   ├── AsyncImage.tsx       async demo (<Img> + simulated fetch) (ch. 8)
│   ├── WithAudio.tsx        audio demo (bg tone + offset blip) (ch. 9)
│   ├── WithVideo.tsx        embedded-video demo               (ch. 10)
│   ├── WithSeries.tsx       <Series>/<Loop> timeline demo     (ch. 4)
│   ├── WithOffthread.tsx    <OffthreadVideo> demo             (ch. 10)
│   ├── Countdown.tsx        calculateMetadata demo            (ch. 6, 7)
│   └── MediaSized.tsx       async calculateMetadata demo (probed duration) (ch. 6, 7)
├── render/                 ← Stage 2 renderer (ch. 7)
│   ├── registry.ts          composition registry + calculateMetadata resolver
│   ├── probe-media.ts       in-page media duration probe for async hooks (ch. 6, 7)
│   └── main-render.tsx      chrome-less render entry (window.framewiseLite)
├── App.tsx                  host page that embeds the Player   (ch. 6)
└── main.tsx                 React entry point                 (ch. 6)

render.html                 render entry HTML (served to headless Chrome)  (ch. 7)
scripts/render.mjs          the renderer: Vite + Puppeteer + ffmpeg        (ch. 7, 11)
scripts/offthread-server.mjs  on-demand ffmpeg frame extraction for <OffthreadVideo> (ch. 10)
scripts/render-lib.mjs      pure renderer helpers (planEncode, planChunks…) (ch. 7, 11)
public/                     static assets (photo.png, bg/blip.wav, clip.mp4)
```

## How this maps to real Framewise

Everything here is a faithful (if reduced) version of a real Framewise API. The
[top-level README](../../README.md#whats-here-and-how-it-maps-to-real-framewise)
has the full mapping table and the list of deliberate omissions. The short
version: this is Framewise's _core_ (`framewise` + `@framewise/player`). The hard
half — the headless-browser **renderer** that turns frames into an mp4 — is not
here; see the [Roadmap](../../README.md#roadmap).
