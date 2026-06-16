# framewise-lite — Code Walkthrough

This is a guided tour of the codebase, written to be read top-to-bottom as a
way of *understanding how Framewise works*, not just how this clone is wired.
Each chapter takes one module, explains the idea it implements, then walks the
code and calls out the parts that are subtle or easy to get wrong.

> **What this is:** a complete, working, verified educational reimplementation of
> Framewise's *core* — the frame-as-state engine, the animation primitives
> (`interpolate`, `spring`, `<Sequence>`), a `<Player>`, a headless-Chrome +
> ffmpeg renderer, deterministic async assets (`delayRender`), audio, embedded
> video, and parallel rendering. All eleven chapters below are implemented and
> tested.
>
> **What it deliberately isn't:** production Framewise. It keeps the *numeric* path
> of `interpolate`, *constant* per-segment volume, *best-effort* preview A/V sync,
> a *live-element* `<Video>` (not ffmpeg frame-extraction), and *single-machine*
> parallelism (not cross-machine encode+concat). Each chapter names its own
> simplifications and points at the production-grade version.

## The single idea everything hangs off

> **A video is a pure function of the frame number.**

A composition is an ordinary React component. It asks "what frame are we on?"
and renders accordingly. Nothing in a composition knows whether it's being
*played* (frames advanced by a clock) or *rendered* (frames advanced by an
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

The arrow only points **down**. The composition *reads* the frame; it never
sets it. The `Player` is just one thing that writes it. Swap the `Player` for a
"render driver" that sets frame 0 → screenshot → frame 1 → screenshot, and the
exact same composition becomes an exporter. That seam is the most important
line in the codebase, and it lives in `VideoConfig.tsx`.

## Reading order

| # | Chapter | File covered | What you'll learn |
|---|---|---|---|
| 1 | [The frame engine](01-frame-engine.md) | `src/framewise-lite/VideoConfig.tsx` | The contexts, `useCurrentFrame`/`useVideoConfig`, why the seam matters |
| 2 | [interpolate](02-interpolate.md) | `src/framewise-lite/interpolate.ts` | Range mapping, the surprising `extend` default, multi-segment keyframes, easing |
| 3 | [spring](03-spring.md) | `src/framewise-lite/spring.ts` | The damped-oscillator physics, why it's iterated, the public wrapper |
| 4 | [Sequence](04-sequence.md) | `src/framewise-lite/Sequence.tsx` | Time-shifting via context, how 20 lines power timelines |
| 5 | [The Player](05-player.md) | `src/framewise-lite/Player.tsx` | The wall-clock loop, seeking, the #1 playback bug, responsive scaling |
| 6 | [Demo & wiring](06-demo-and-wiring.md) | `HelloWorld.tsx`, `App.tsx`, `main.tsx` | How the primitives combine into a real animation |
| 7 | [The Renderer](07-renderer.md) | `scripts/render.mjs`, `render.html`, `src/render/*` | Stage 2: Puppeteer screenshots + ffmpeg → mp4, and why it's naive |
| 8 | [delayRender](08-delay-render.md) | `delay-render.ts`, `Img.tsx`, `AsyncImage.tsx` | Stage 3: making async assets block the capture, proved with a before/after experiment |
| 9 | [Audio](09-audio.md) | `audio-registry.ts`, `playback.ts`, `Audio.tsx`, `WithAudio.tsx` | Stage 4: collecting audio per frame and mixing/muxing it with ffmpeg |
| 10 | [Embedded Video](10-video.md) | `Video.tsx`, `WithVideo.tsx` | Stage 5: frame-accurate `<Video>` via delayRender-gated seeking + audio mux |
| 11 | [Parallel Rendering](11-parallel-rendering.md) | `scripts/render.mjs` | Stage 6: render chunks across browsers concurrently, deterministically |

## Map of the source tree

```
src/
├── framewise-lite/          ← the "library" (what you'd publish)
│   ├── VideoConfig.tsx      contexts + hooks + AbsoluteFill   (ch. 1)
│   ├── interpolate.ts       value range mapping               (ch. 2)
│   ├── spring.ts            physics-based animation           (ch. 3)
│   ├── Sequence.tsx         the time-shifter                  (ch. 4)
│   ├── Player.tsx           the playback clock + UI + badge   (ch. 5, 8)
│   ├── delay-render.ts      delayRender/continueRender registry (ch. 8)
│   ├── Img.tsx              delayRender-aware <img>           (ch. 8)
│   ├── audio-registry.ts    per-frame audio collection sink   (ch. 9)
│   ├── playback.ts          preview-only playback context     (ch. 9)
│   ├── Audio.tsx            <Audio> primitive                 (ch. 9)
│   ├── Video.tsx            <Video> primitive (seek + mux)    (ch. 10)
│   ├── index.ts             public barrel export
│   ├── interpolate.test.ts  exact-output unit tests
│   └── spring.test.ts       structural physics tests
├── compositions/
│   ├── HelloWorld.tsx       the demo video                    (ch. 6)
│   ├── AsyncImage.tsx       async demo (<Img> + simulated fetch) (ch. 8)
│   ├── WithAudio.tsx        audio demo (bg tone + offset blip) (ch. 9)
│   └── WithVideo.tsx        embedded-video demo               (ch. 10)
├── render/                 ← Stage 2 renderer (ch. 7)
│   ├── registry.ts          the composition registry
│   └── main-render.tsx      chrome-less render entry (window.framewiseLite)
├── App.tsx                  host page that embeds the Player   (ch. 6)
└── main.tsx                 React entry point                 (ch. 6)

render.html                 render entry HTML (served to headless Chrome)  (ch. 7)
scripts/render.mjs          the renderer: Vite + Puppeteer + ffmpeg        (ch. 7, 11)
public/                     static assets (photo.png, bg/blip.wav, clip.mp4)
```

## How this maps to real Framewise

Everything here is a faithful (if reduced) version of a real Framewise API. The
[top-level README](../../README.md#whats-here-and-how-it-maps-to-real-framewise)
has the full mapping table and the list of deliberate omissions. The short
version: this is Framewise's *core* (`framewise` + `@framewise/player`). The hard
half — the headless-browser **renderer** that turns frames into an mp4 — is not
here; see the [Roadmap](../../README.md#roadmap).
