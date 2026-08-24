# framewise-lite — Repository Guide

This is the orientation document for the repository: what it is, how it fits
together, how to work in it day to day, and where it should go next. It
complements (does not replace) the other documentation:

| Document                                | What it covers                                            |
| --------------------------------------- | --------------------------------------------------------- |
| [`README.md`](../README.md)             | Project intro, quickstart commands, API-to-Framewise map  |
| [`docs/tutorial.md`](tutorial.md)       | **Getting started**: build a promo video step by step     |
| [`CLAUDE.md`](../CLAUDE.md)             | Agent-facing guidance: commands, invariants, conventions  |
| [`docs/code/`](code/README.md)          | The 11-chapter code walkthrough — start here to learn     |
| [`plans/README.md`](../plans/README.md) | Completed executor plans from the July 2026 audit         |
| This document                           | Orientation, workflows, troubleshooting, roadmap proposal |

## 1. What this repository is

**framewise-lite** is a minimal, educational reimplementation of
[Framewise](https://www.framewise.dev/)'s _core_ — the part that makes "a video
is a function of the frame number" real. It is not a product or a fork; it is a
teaching codebase that implements, tests, and documents the essential machinery
of a programmatic video engine:

- The **frame-as-state engine**: compositions are ordinary React components that
  read the current frame from context.
- The **animation primitives**: `interpolate`, `spring`, `<Sequence>`, `Easing`.
- A **`<Player>`** that drives preview playback from a wall clock.
- A **renderer** (`npm run render`) that turns a composition into mp4 / webm /
  gif / PNG sequence / stills using Puppeteer + ffmpeg.
- **`delayRender`** so async assets render deterministically.
- **`<Audio>`** collected per frame and mixed/muxed with ffmpeg, and a
  frame-accurate embedded **`<Video>`**.
- **Parallel chunked rendering** across multiple headless browsers.

Every fidelity gap the original README listed as "deliberately omitted" has
since shipped: ffmpeg frame extraction (`<OffthreadVideo>`, plan 021),
per-frame volume automation (plan 022), the measured sample-accuracy analysis
(plan 023), and distributed chunk-encode + concat (plan 030). What remains
honestly simplified: preview A/V sync is drift-snap best-effort (by design),
and true cross-machine rendering (the `--distributed` flag simulates it on one
box). See [§14](#14-roadmap-status).

### Status snapshot

| Aspect        | Value                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Version       | 0.1.0 (`package.json`)                                                                                 |
| Runtime       | Node ≥ 20, React ^19.2.7                                                                               |
| Toolchain     | TypeScript ^5.6 (strict), Vite ^6, Vitest ^3, ESLint ^10 flat config, Prettier (printWidth 100)        |
| Tests         | 22 files / 291 tests, all passing (`npm test`)                                                         |
| CI            | GitHub Actions: Node 20.x & 22.x matrix, runs `npm ci && npm run verify` (`.github/workflows/ci.yml`)  |
| Renderer deps | System Chrome/Chromium + ffmpeg on PATH (not npm packages — `puppeteer-core` attaches to your browser) |

## 2. The one idea

> **A video is a pure function of the frame number.**

A composition is an ordinary React component. It asks "what frame are we on?"
via `useCurrentFrame()` and renders accordingly. Nothing in a composition knows
whether it's being _played_ (frames advanced by a clock) or _rendered_ (frames
advanced by an exporter taking screenshots). Preview and export run identical
code. Every design choice in this repo exists to protect that property.

Three consequences worth internalizing before you change anything:

1. **`useCurrentFrame()` only reads context.** It knows nothing about clocks,
   rAF, or playback (`src/framewise-lite/VideoConfig.tsx:36-38`). Whoever
   renders the tree decides what the frame is.
2. **A frame may never depend on wall-clock time or true randomness.**
   Compositions use `random(seed)` (`src/framewise-lite/random.ts`), never
   `Math.random()`. The renderer verifies this by hashing all rendered PNGs and
   requiring an identical sha256 at any `--concurrency`
   (`scripts/render.mjs:453-455`).
3. **Async work must be declared, not hoped away.** Anything slow (image load,
   video seek, fetch) wraps itself in `delayRender`; the renderer blocks each
   screenshot until the pending-handle registry drains
   (`src/framewise-lite/delay-render.ts`).

## 3. Architecture: two frame sources, one composition

```
                 PREVIEW                              RENDER
   ┌─────────────────────────────┐      ┌────────────────────────────────────┐
   │ <Player> (owns a clock)     │      │ scripts/render.mjs (Puppeteer)     │
   │                             │      │   vite dev server → render.html    │
   │ frame = floor(              │      │   per frame:                       │
   │   elapsedMs * fps / 1000)   │      │     window.framewiseLite           │
   │                             │      │       .renderFrame(n) → flushSync  │
   └──────────────┬──────────────┘      │     wait pending delayRender == 0  │
                  │                     │     screenshot PNG                 │
                  ▼                     └──────────────┬─────────────────────┘
        ┌─────────────────────────────────────────────┘
        │ both render through the SAME provider stack:
        ▼
   ┌───────────────────────┐
   │ CompositionHost       │  config + frame via context;
   │  VideoConfigProvider  │  preview passes `playback`;
   │  FrameProvider        │  render passes none —
   │  PlaybackProvider?    │  null PlaybackContext = render mode
   └───────────┬───────────┘
               ▼
   ┌───────────────────────────────────────────┐
   │ Your composition                          │
   │   const frame = useCurrentFrame()         │
   │   spring({frame, fps}), interpolate(…)    │
   │   <Sequence from={25}>, <Audio>, <Video>  │
   └───────────────────────────────────────────┘
```

Key mechanics:

- **The Player clock derives frames from elapsed wall-clock time**, never
  `frame++` per animation-frame tick — incrementing per tick would tie playback
  speed to monitor refresh rate (a 30fps comp would run 2× on a 120Hz display).
  Seeking re-baselines the internal clock so playback resumes from the scrub
  point (`src/framewise-lite/Player.tsx:56-99`).
- **The render entry is deliberately chrome-less.**
  `src/render/main-render.tsx` exposes `window.framewiseLite.renderFrame(n)`
  and uses `flushSync` so the DOM reflects frame n _before_ the screenshot.
  This mirrors real Framewise's `window.framewise_setFrame` seam.
- **Render mode detection is implicit:** `<Audio>` and `<Video>` check whether
  the `PlaybackContext` is null. Preview passes a playback object; the renderer
  doesn't — so media components play in preview but only _report_ during
  export.
- **Audio in export is collected, not played.** Each frame's active audio is
  reported into `audio-registry.ts` (armed via `beginAudioFrame()` before the
  React commit), aggregated into segments, and mixed/muxed by ffmpeg at the end.
- **Embedded `<Video>` seeks a live element per frame and gates the capture on
  the `seeked` event through `delayRender`**; its soundtrack rides the same
  mux path as `<Audio>`.
- **Timeout ordering contract:** the in-app labeled `delayRender` timeout error
  fires at `DEFAULT_DELAY_RENDER_TIMEOUT` (30 s); Puppeteer's generic backstop
  fires later, at +`RENDERER_TIMEOUT_MARGIN_MS` (5 s). Both constants live in
  `src/framewise-lite/delay-render-defaults.mjs` — the single source of truth
  shared by TypeScript and `scripts/render.mjs`.

## 4. Repository map

```
src/
├── framewise-lite/            ← the library (the part you'd publish)
│   ├── VideoConfig.tsx        contexts + useCurrentFrame/useVideoConfig + AbsoluteFill   (ch. 1)
│   ├── interpolate.ts         range mapping (extend default, wrap, posterize¹)             (ch. 2)
│   ├── easing.ts              Easing.bezier + in/out/inOut combinators                     (ch. 2)
│   ├── spring.ts              damped-oscillator animation, integer-chain cache             (ch. 3)
│   ├── Sequence.tsx           time-shifter: re-bases frame, clips mount window             (ch. 4)
│   ├── Series.tsx             back-to-back clips via auto-computed offsets                 (ch. 4)
│   ├── Loop.tsx               repeat with a re-based clock                                 (ch. 4)
│   ├── Player.tsx             wall-clock frame source + controls + scrubber + badge       (ch. 5)
│   ├── CompositionHost.tsx    shared provider stack — both frame sources render through it (ch. 5, 7)
│   ├── delay-render.ts        delayRender/continueRender handle registry                   (ch. 8)
│   ├── delay-render-defaults.mjs/.d.mts     shared timeout constants (TS + render.mjs)
│   ├── Img.tsx                <img> that blocks capture until loaded                       (ch. 8)
│   ├── Audio.tsx              <Audio>: plays in preview, reports per frame in render       (ch. 9)
│   ├── audio-registry.ts      per-frame audio collection sink                              (ch. 9)
│   ├── playback.ts            preview-only PlaybackContext                                 (ch. 9)
│   ├── Video.tsx              <Video>: seek-gated capture + audio mux                      (ch. 10)
│   ├── useMediaSync.ts        shared preview A/V sync hook (do not inline back)
│   ├── staticFile.ts          'photo.png' → '/photo.png'
│   ├── random.ts              seeded PRNG (FNV-1a → mulberry32)
│   ├── index.ts               public barrel export
│   └── *.test.ts(x)           colocated suite per module
├── compositions/              demo compositions registered for preview AND render
│   ├── HelloWorld.tsx         exercises every primitive                                    (ch. 6)
│   ├── AsyncImage.tsx         delayRender demo (--no-wait breaks it on purpose)            (ch. 8)
│   ├── WithAudio.tsx          background tone + offset blip + volume fade                  (ch. 9)
│   ├── WithVideo.tsx          embedded clip + React overlay                                (ch. 10)
│   ├── WithSeries.tsx         <Series>/<Loop> timeline demo                                (ch. 4)
│   ├── WithOffthread.tsx      <OffthreadVideo> demo — A/B with WithVideo                   (ch. 10)
│   ├── Countdown.tsx          calculateMetadata demo — duration from props.seconds         (ch. 6, 7)
│   └── MediaSized.tsx         async calculateMetadata demo — duration probed from clip.mp4 (ch. 6, 7)
├── render/
│   ├── registry.ts            composition registry + calculateMetadata resolver
│   ├── probe-media.ts         in-page media duration probe (async hooks)
│   ├── parse-props-input.ts   preview props-editor JSON parser (unit-tested)
│   └── main-render.tsx        chrome-less entry exposing window.framewiseLite
├── App.tsx                    host page: dropdown + props editor + gallery + <Player>
└── main.tsx                   Vite entry

scripts/render.mjs             the renderer: Vite + Puppeteer + ffmpeg, parallel chunks (ch. 7, 11)
scripts/render-lib.mjs         pure helpers extracted from render.mjs (unit-tested)
scripts/offthread-server.mjs   on-demand ffmpeg frame extraction for <OffthreadVideo> (ch. 10)
render.html                    page served to headless Chrome
public/                        static assets (photo.png, bg.wav, blip.wav, clip.mp4)
docs/code/                     the 11-chapter walkthrough (docs are the product)
plans/                         executor plans, 001–042 all DONE
```

¹ `posterize` is an extension not present in upstream Framewise.

## 5. The library API

Everything public is exported from `src/framewise-lite/index.ts`:

| Export                                                                                                                        | Purpose                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCurrentFrame()`                                                                                                           | Read the current frame number (context only)                                                                                                                                                                                                                                  |
| `useVideoConfig()`                                                                                                            | `{width, height, fps, durationInFrames}`; throws outside a composition                                                                                                                                                                                                        |
| `<AbsoluteFill>`                                                                                                              | Positioned full-size `<div>` building block                                                                                                                                                                                                                                   |
| `interpolate(input, inRange, outRange, opts?)`                                                                                | Multi-segment range mapping; defaults to **extend** (linear extrapolation); `extrapolateLeft/Right`: extend \| clamp \| identity \| wrap; easing curves or arrays; `posterize` snaps output to steps; outputs may be tuples (lane-wise) or string templates like `'scale(2)'` |
| `interpolateColors(input, inRange, colorRange, opts?)`                                                                        | Blends hex / rgb() / hsl() (formats mix freely) into an `rgba()` string; same easing contract, extend \| clamp extrapolation only                                                                                                                                             |
| `Easing`                                                                                                                      | `bezier(...)`, `linear`, `step0/step1`, `poly(n)`, plus `back`, `bounce`, and `elastic(bounciness)` curves and `in/out/inOut` combinators over `quad/cubic/sin`                                                                                                               |
| `spring({frame, fps, config?, from?, to?, delay?, durationInFrames?, reverse?})`, `measureSpring({fps, config?, threshold?})` | Physics-based animation; verbatim upstream math except clamping happens in **output space**; O(N) via integer-chain cache. `durationInFrames` warps the natural run to a target length, `reverse` plays it backward — both measured by `measureSpring`                        |
| `<Sequence from durationInFrames layout name?>`                                                                               | Re-bases `useCurrentFrame()` to 0 at `from`; unmounts children outside `[from, from+duration)`                                                                                                                                                                                |
| `<Series>` / `<Series.Sequence>`                                                                                              | Plays clips back-to-back via auto-computed offsets; teaching-first validation                                                                                                                                                                                                 |
| `<Loop durationInFrames times?>`                                                                                              | Repeats children with the clock re-based every cycle; unmounts after `times`                                                                                                                                                                                                  |
| `<Player component inputProps width height fps durationInFrames loop autoPlay controls maxHeight?>`                           | Preview frame source with controls, scrubber, keyboard shortcuts, delayRender-pending badge                                                                                                                                                                                   |
| `<Img src>`                                                                                                                   | Like `<img>` plus `delayRender` gating                                                                                                                                                                                                                                        |
| `<Audio src volume? startFrom? endAt?>`                                                                                       | Plays in preview; contributes to the ffmpeg mix in export; `volume` may be a function of the local frame for fades/ducks                                                                                                                                                      |
| `<Video src volume? startFrom? endAt?>`                                                                                       | Live element, seeked per frame in export; audio muxed                                                                                                                                                                                                                         |
| `<OffthreadVideo src volume? startFrom? muted?>`                                                                              | Same props/audio as `<Video>`; in a render the frame is ffmpeg-extracted and shown via `<Img>` — frame-accurate by construction; previews as a live `<Video>`                                                                                                                 |
| `delayRender(label?, timeout?)` / `continueRender(handle)`                                                                    | Block capture until resolved; timeout logs a labeled error                                                                                                                                                                                                                    |
| `getPendingDelayRenders()` / `useDelayRenderPending()`                                                                        | Inspect/subcribe to outstanding handles (powers the badge)                                                                                                                                                                                                                    |
| `staticFile(path)`                                                                                                            | Root-relative asset URL consistent with `public/` and the renderer                                                                                                                                                                                                            |
| `random(seed)`                                                                                                                | Deterministic `[0, 1)` for number/string seeds — identical in every worker                                                                                                                                                                                                    |

A minimal composition looks like `HelloWorld.tsx` — read the frame, compute
style values, return JSX:

```tsx
const Title = ({text}: {text: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = spring({frame, fps, config: {damping: 12}});
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return <h1 style={{transform: `scale(${scale})`, opacity}}>{text}</h1>;
};
```

## 6. Compositions and the registry

Seven demos ship in `src/compositions/`, registered in `src/render/registry.ts`
(the minimal analog of Framewise's `<Composition>` declarations). All are
1280×720 @ 30fps.

| id              | Duration | Demonstrates                                                                     |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| `HelloWorld`    | 150 f    | spring pop-in, hue drift, `<Sequence>` timing, seeded `random()`                 |
| `AsyncImage`    | 90 f     | `<Img>` + a `delayRender`-gated simulated fetch (`fetchDelayMs` prop)            |
| `WithAudio`     | 150 f    | `<Audio>` background tone + offset blip inside a `<Sequence>`                    |
| `WithVideo`     | 150 f    | embedded clip with frame-accurate seek + React overlay                           |
| `WithSeries`    | 150 f    | three `<Series>` cards, a nested `<Series>`, and a `<Loop>` pulse                |
| `WithOffthread` | 150 f    | `<OffthreadVideo>` — same layout as WithVideo for A/B comparison                 |
| `Countdown`     | dynamic  | `calculateMetadata`: duration derived from `props.seconds`                       |
| `MediaSized`    | probed   | async `calculateMetadata`: duration = the embedded clip's real length (plan 040) |

The preview app (`npm run dev`) reads the **same registry** via a dropdown in
`src/App.tsx`; switching compositions remounts the `<Player>` (`key={comp.id}`)
to reset the clock and clear stale delayRender handles. The dropdown page also
has a live props editor (plan 027) and a gallery view (plan 029).

**To add a composition:**

1. Create `src/compositions/<Name>.tsx` — a component taking props, reading
   `useCurrentFrame()`/`useVideoConfig()`.
2. Register it in `src/render/registry.ts` with id, dimensions, fps, duration,
   and `defaultProps`.
3. Add static assets under `public/` and reference them via `staticFile()`.
4. Check it in preview (`npm run dev`), then verify determinism by rendering:
   `npm run render -- --comp <Name> --concurrency 2 --out out/test.mp4`
   (a hash mismatch means you used wall-clock time or `Math.random()`).
5. If it teaches something new, mention it in the relevant chapter of
   `docs/code/`.

## 7. Rendering a composition

Pipeline (`scripts/render.mjs`, ~730 lines; pure logic extracted and tested in
`scripts/render-lib.mjs`):

1. Parse flags; preflight `ffmpeg` and resolve Chrome (fail fast with actionable
   messages).
2. Start a Vite dev server programmatically; launch headless Chrome against
   `render.html?comp=<id>&props=<json>`.
3. Probe composition metadata via `window.framewiseLite` (config, ids).
4. Split the frame range into chunks (`planChunks`), render each chunk in its
   own browser concurrently (default 4), writing PNGs named by absolute frame
   number into one temp dir. Each frame: set frame → wait until
   `getPending()` empties (unless `--no-wait`) → screenshot.
5. Aggregate per-frame audio reports into segments (`aggregateAudioSegments`).
6. One ffmpeg pass assembles frames + audio into the output (`planEncode`
   computes codec/filter args per format). For `--format png-seq` no ffmpeg is
   invoked — raw frames are copied to the output directory.
7. Verify determinism: the sha256 over the sorted PNG bytes must be identical
   regardless of `--concurrency`. Clean up temp state fault-isolated.

### CLI reference

```
npm run render -- [--comp <id>] [--out <path>] [options]
```

| Flag                  | Default      | Notes                                                                  |
| --------------------- | ------------ | ---------------------------------------------------------------------- |
| `--comp <id>`         | first reg.   | Composition id (`--list` prints them; needs neither Chrome nor ffmpeg) |
| `--out <path>`        | format-aware | File (mp4/webm/gif) or directory (png-seq)                             |
| `--format <fmt>`      | `mp4`        | `mp4` \| `webm` \| `gif` \| `png-seq`                                  |
| `--still <frame>`     | —            | Single-frame PNG; mutually exclusive with `--format`/`--concurrency`   |
| `--concurrency <N>`   | `4`          | Parallel browsers; `1` = sequential                                    |
| `--props '<json>'`    | —            | Shallow-merged over the comp's `defaultProps`                          |
| `--no-wait`           | off          | Ignore delayRender (renders async comps broken — teaching mode)        |
| `--crf <n>`           | `18`         | Quality (lower = better/larger)                                        |
| `--codec <name>`      | per-format   | e.g. `libx265`                                                         |
| `--audio-bitrate <k>` | `192k`       | `aac` for mp4, `libopus` for webm                                      |
| `--public-dir <path>` | `public`     | Asset base dir                                                         |
| `--chrome <path>`     | auto-detect  | Or env `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH`                     |
| `--no-sandbox`        | off          | Chrome sandbox is ON by default; root auto-falls back with a warning   |

Format behaviors worth knowing: **gif drops audio** (warned if the comp has
audio segments) and ignores `--crf`/`--codec` (warned — palette encode uses
neither); **mp4** is encoded with `-movflags +faststart` for progressive
playback; **webm** uses VP9 + Opus; **png-seq** skips ffmpeg entirely. Default
output paths and their extension/mkdir rules come from the pure `planOutput()`
planner in `scripts/render-lib.mjs`.

## 8. Working in this repository

### Setup

```bash
npm install        # Node ≥ 20
npm run dev        # http://localhost:5173 — Space = play/pause, ←/→ = step a frame
```

Preview requires nothing beyond npm packages. Rendering additionally requires
system Chrome/Chromium and ffmpeg on PATH.

### Command reference

| Command                | What it does                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ |
| `npm test`             | Vitest once (all 291 tests)                                                    |
| `npm run test:watch`   | Vitest in watch mode                                                           |
| `npm run typecheck`    | `tsc -b`                                                                       |
| `npm run lint`         | ESLint (flat config)                                                           |
| `npm run format`       | Prettier write                                                                 |
| `npm run format:check` | Prettier check                                                                 |
| `npm run build`        | Typecheck + production bundle                                                  |
| `npm run verify`       | **The gate:** typecheck + lint + prettier + tests + build                      |
| `npm run build:lib`    | Build the publishable library (`dist-lib/framewise-lite.js` + types, plan 028) |
| `npm run render -- …`  | Export compositions (see §7)                                                   |

CI runs `npm run verify` on Node 20.x and 22.x. Run it locally before pushing;
it is the definition of "done" used throughout the docs and plans.

### Everyday tasks

**Add a library primitive** (e.g. `<Series>`):

1. Implement `src/framewise-lite/Series.tsx` following the style of the nearest
   sibling (`Sequence.tsx`); keep it dependency-free and deterministic.
2. Export it from `index.ts`.
3. Colocate `Series.test.tsx` following the testing conventions below.
4. Write or extend a chapter in `docs/code/` **in the same commit** — chapters
   mirror the source, and new primitives get an entry in the
   `docs/code/README.md` source map.
5. Consider a small demo usage in an existing composition if it aids teaching.
6. Gate: `npm run verify`.

**Change rendering behavior:** pure logic belongs in `scripts/render-lib.mjs`
with tests in `scripts/render-lib.test.mjs`; `render.mjs` should stay the thin
orchestration shell (arg parsing, process control, logging). Preserve the two
hard contracts there: the delayRender timeout ordering (imports constants from
`delay-render-defaults.mjs`, never re-declares them) and the concurrency-
independent frame-hash verification.

**Break something intentionally for teaching:** the `--no-wait` flag exists so
you can watch async compositions capture too early — pair it with chapter 8's
before/after experiment.

### Testing conventions

- Vitest globals are on (`vite.config.ts`); default environment is node.
- DOM suites start with `// @vitest-environment jsdom` and set
  `globalThis.IS_REACT_ACT_ENVIRONMENT = true` (see
  `src/framewise-lite/delay-render.test.tsx:1,13`).
- Tests are colocated as `src/**/X.test.ts(x)`; renderer helpers are tested in
  `scripts/render-lib.test.mjs`.
- Suites touching `delayRender` drain the registry in `afterEach` so handles
  never leak between tests.
- Characterization tests document deliberate quirks (e.g. the spring cache's
  known divergence at fractional frames, pinned by plan 013's tests) — read the
  comment above a failing test before "fixing" production code.

### Documentation rules

Docs are treated as part of the product: any change to a module that has a
chapter updates that chapter **in the same commit**, and new primitives get a
chapter/section plus a row in the `docs/code/README.md` source map. Prose
follows Prettier (printWidth 100).

### Plans workflow

Large changes go through `plans/`: each plan is a numbered markdown executor
script with priority, effort estimate, dependencies, STOP conditions, and a
status row in `plans/README.md` (TODO → IN PROGRESS → DONE/BLOCKED/REJECTED).
All thirty plans (001–030) are DONE — including 017, the manual output-format
smoke test executed on this machine. Keep the same discipline for future ones.

## 9. Architecture invariants — do not break these

These are the five properties the whole system rests on (mirrored from
`CLAUDE.md`):

1. **`useCurrentFrame()` only reads context** and knows nothing about clocks
   (`src/framewise-lite/VideoConfig.tsx:20-25`). Decoupling frame-source from
   consumer is the entire design.
2. **Preview and export render through the same `CompositionHost`**
   (`src/framewise-lite/CompositionHost.tsx:18-37`). Preview passes
   `playback`; render passes none. Null `PlaybackContext` is how `<Audio>` /
   `<Video>` detect render mode.
3. **A frame is a pure function of its number.** Use `random(seed)`
   (`src/framewise-lite/random.ts:24-37`), never `Math.random()`. The renderer
   enforces this with the sha256 frame-set hash check, identical at any
   `--concurrency` (`scripts/render.mjs:453-455`).
4. **The no-dependency `useLayoutEffect`s in `Audio.tsx` / `Video.tsx` /
   `Img.tsx` are load-bearing.** The file comments explain why
   (`Audio.tsx:36-41`, `Video.tsx:50-54,79-129`, `Img.tsx:10-18`). The shared
   preview sync lives in `useMediaSync.ts` with an explicit deps list — do not
   inline it back into either component.
5. **`delayRender` timeout constants have a single source of truth**
   (`src/framewise-lite/delay-render-defaults.mjs` + `.d.mts`), shared by TS
   and `render.mjs`. The renderer's backstop must fire AFTER the in-app labeled
   error (ordering contract documented in `delay-render-defaults.mjs:5-8`).

## 10. Deliberate decisions — do not "fix"

- **`interpolate` defaults to `extend`, not clamp** — it keeps mapping linearly
  past the ends (`src/framewise-lite/interpolate.ts:5-6`). Ported exactly from
  upstream, including validation errors.
- **`posterize` is an extension** not in upstream Framewise
  (`src/framewise-lite/interpolate.ts:8-11`).
- **`spring`'s `overshootClamping` clamps in output space**, fixing upstream's
  normalized-space clamp that silently did nothing unless `to === 1`
  (`src/framewise-lite/spring.ts:10-14`). Everything else in the math is
  verbatim upstream.

Related rejected ideas are recorded in `plans/README.md` ("Findings considered
and rejected") so nobody re-audits them — notably: auto-removing timed-out
delayRender handles (log-and-stay-pending is load-bearing), evicting the spring
integer-chain cache (bounded in practice; pinned by tests), and memoizing the
Player controls subtree.

## 11. Troubleshooting & FAQ

| Symptom                                                               | Cause & fix                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` errors `Cannot find package 'jsdom'` while most tests pass | Stale/partial `node_modules` after pulling changes — run `npm install`. jsdom is a devDependency loaded lazily by vitest for DOM suites. |
| Render fails: "Chrome … not found"                                    | Install Chrome/Chromium, or set `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH`, or pass `--chrome <path>`.                                  |
| Chrome won't start in a container / as root                           | Sandbox can't start there: pass `--no-sandbox` (running as root falls back automatically with a warning).                                |
| Render fails immediately mentioning ffmpeg                            | Install ffmpeg and ensure it's on PATH; the preflight fails fast before doing work.                                                      |
| GIF output is silent                                                  | By design — GIF has no audio track; a warning prints if the comp has audio segments. Use webm/mp4.                                       |
| `--still` rejects my command                                          | `--still` is mutually exclusive with explicit `--format` and `--concurrency`.                                                            |
| `useVideoConfig() was called outside of a composition`                | Wrap the tree in a `<Player>` (or another `VideoConfigProvider`).                                                                        |
| Async composition captures a loading screen                           | You passed `--no-wait`, or an async source didn't wrap in `delayRender` — see chapter 8.                                                 |
| Output hash mismatch between concurrency levels                       | Something broke purity: look for `Date.now()`, `Math.random()`, or untracked network state in the composition.                           |
| Preview badge shows pending forever                                   | A `delayRender` handle was never continued — the stuck badge is intentional UI; find the unmatched `continueRender`.                     |

## 12. Where to read next

Recommended order (all under `docs/code/`):

1. `01-frame-engine.md` — contexts, hooks, why the seam matters
2. `02-interpolate.md` — range mapping and the surprising `extend` default
3. `03-spring.md` — the damped-oscillator physics and why it's iterated
4. `04-sequence.md` — how ~20 lines power timelines
5. `05-player.md` — the wall-clock loop and the #1 playback bug
6. `06-demo-and-wiring.md` — primitives combining into a real animation
7. `07-renderer.md` — Puppeteer screenshots + ffmpeg, and why naive
8. `08-delay-render.md` — making async assets block the capture (with experiment)
9. `09-audio.md` — collecting audio per frame; mixing/muxing
10. `10-video.md` — frame-accurate embedded video
11. `11-parallel-rendering.md` — deterministic chunked parallelism

## 13. Project history & status

The project advanced through four recorded waves, all complete:

- **Backlog (review-driven fixes)** — items 01–19, all shipped: cross-platform
  Chrome resolution, spring clamp fix, shared `CompositionHost`, core test
  coverage, renderer preflight/config/props, spring O(N²)→O(N) cache,
  delayRender timeout consolidation, fidelity/docs cleanup, the next primitives
  (`staticFile`, `random`, progress/`--list`), and the review rounds that
  followed the roadmap run (packaging, distributed formats, the audio gain
  envelope, async metadata). Review findings lived in a `backlog/` queue until
  it emptied (items 01–22 all shipped) and the folder was removed —
  `git log -- backlog/` holds the record of what closed and when.
- **Audit plans (July 2026)** — plans 001–016 in `plans/README.md`: verification
  baseline + CI, render-lib extraction, renderer robustness, characterization
  tests, the Video seek-race fix, CompositionHost docs, ESLint/Prettier gates,
  CLAUDE.md, sandbox gating, demo wiring, `useMediaSync` extraction, Player
  improvements, spring fractional-frame tests, React 19 upgrade, output formats
  (`--format`/`--still`), and the `Easing` module. A follow-up wave added the
  remaining easing curves (`back`/`bounce`/`elastic`), the pure `planOutput()`
  out-path planner, mp4 `+faststart`, Prettier inside the verify gate, and plan
  017 (a manual output-format smoke test on a Chrome+ffmpeg machine).
- **Original build-out roadmap** — README's stages (player/core → renderer →
  delayRender → audio → embedded video → parallel rendering), each verified
  with concrete experiments (frame extraction comparisons, dB-level audio
  checks, byte-identical hashes at different concurrencies).
- **The five-phase roadmap (August 2026)** — plans 017–030 executed the §14
  proposal end to end: the remaining primitives (Series/Loop, measureSpring
  family, interpolateColors + tuple/string outputs), media fidelity
  (`<OffthreadVideo>`, volume automation, the measured sync analysis), renderer
  capability (perf trio, `calculateMetadata`, assetPath containment), authoring
  experience (props editor, publishable packaging, gallery), and distributed
  chunk-encode + concat.

Test count along the way: 17 → 51 → 116 → 160 → 185 → 291.

## 14. Roadmap status

**Status: fully executed.** The five-phase proposal below was written when
every item was unbuilt; all of it has since shipped as plans 017–030 (all
DONE in `plans/README.md`), and README's Roadmap section now lists seven ✅
stages. The phases are kept here as the historical record of what was proposed
and how each item landed. For future direction, the open ideas live in
chapter 11's distributed-rendering notes (true cross-machine audio mux) and
chapter 10's comparison table (which path to prefer when) — plus whatever the
next audit surfaces.

### Phase 1 — Complete the primitive surface ✅ COMPLETE

Every item from the repo's deferred lists now ships: `<Series>`/`<Loop>` (plan
018), the `measureSpring` family (plan 019), `Easing` incl.
`back`/`bounce`/`elastic` (plan 016 + follow-up), and tuple/string-template
`interpolate` outputs plus `interpolateColors` (plan 020 — backlog item B, the
last one).

### Phase 2 — Media fidelity ✅ COMPLETE

| Item                                                   | Origin                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~OffthreadVideo-style frame extraction~~ ✅ plan 021  | README "deliberately omitted"; ch. 10 names the approach | Shipped as `<OffthreadVideo>`: on-demand ffmpeg extraction served by the renderer, rendered through `<Img>`; verified frame-accurate at comp frames 30/75/120.                                                                                                                                                                                                                                                                                                           |
| ~~Per-frame volume automation~~ ✅ plan 022            | README "deliberately omitted"                            | `volume` accepts a function of the local frame on all three media components; automation renders as one segment with an in-ffmpeg gain envelope (`volume=…:eval=frame`, plan 034) instead of per-frame splices; evaluation grid pinned to the video frame via `asetnsamples` (plan 038) and each step placed at the frame midpoint so no boundary comparison sits on a near-equal float (plan 039); measured worst per-video-frame deviation 0.100 → 0.034 → **0.0001**. |
| ~~Sample-accurate A/V sync investigation~~ ✅ plan 023 | README "deliberately omitted"                            | Measured: render-path placement lands at ±0.5 ms end-to-end (blip onset within +0.3 ms of its exact frame time); analysis and reproducible commands live in ch. 9.                                                                                                                                                                                                                                                                                                       |

### Phase 3 — Renderer capability and performance ✅ COMPLETE

| Item                                          | Origin                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~Renderer perf trio~~ ✅ plan 024            | plans README "rejected findings" (real, just unplanned): serve a built bundle vs dev-server tradeoff; fold the two CDP round-trips per frame into one; probe registry metadata without launching a whole browser | Folded per-frame CDP to one round trip + adopted probe browser: **−69% c4 / −58% c1 wall time**, byte-identical hashes. Bundle-vs-devserver measured verdict: keep dev server (numbers in ch. 7).                                                                                                                                                                                                      |
| ~~Dynamic composition metadata~~ ✅ plan 025  | plans README notes the probe's "by-design tension"                                                                                                                                                               | `calculateMetadata` on registry entries: props-derived duration/dimensions resolved once at page init in preview AND render (Countdown demo); bad props fail fast with a named error. The tension is resolved — the runtime probe carries it. Since plan 040 the hook may be async (MediaSized probes its clip's real duration; hung hooks get a named 30 s deadline ahead of the generic ready-wait). |
| ~~`assetPath` containment check~~ ✅ plan 026 | plans README review note                                                                                                                                                                                         | Traversal attempts (`../…`) now throw with an actionable message; return shape unchanged for legitimate paths; characterization flipped + new cases.                                                                                                                                                                                                                                                   |

### Phase 4 — Authoring experience and packaging ✅ COMPLETE

| Item                                          | Origin                                                               | Notes                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Preview props editor~~ ✅ plan 027          | audit direction item, not selected                                   | Live JSON textarea in App, same resolver as renderer; Countdown demonstrates dynamic duration.                                                                                                                                                                                  |
| ~~Publishable library packaging~~ ✅ plan 028 | the source-tree comment calls `framewise-lite/` "what you'd publish" | `vite.lib.config.ts` + `tsconfig.lib.json` → `dist-lib/framewise-lite.js` + `dist-lib/index.d.ts`; `package.json` exports/files/sideEffects; `npm run build:lib` smoke-tested via node import. (Plan 031 later moved the output to `dist-lib/` so the app build can't wipe it.) |
| ~~Composition gallery~~ ✅ plan 029           | new suggestion                                                       | Toggle Single/Gallery in App; static `CompositionHost` posters (no clock/audio) per registry entry; click poster jumps to single.                                                                                                                                               |

### Phase 5 — Scale out ✅ COMPLETE

| Item                                  | Origin                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~Distributed rendering~~ ✅ plan 030 | README "deliberately omitted"; ch. 11 explains the difference | `--distributed` sim: chunk-encode via `planChunkVideoEncode` then concat demuxer stream-copy (`buildConcatList`); HelloWorld c4 hash identical to local (16.4 s vs 20.5 s); audio falls back to single-stitch with warning — true distributed would mux global segments at concat time. (Plan 032: chunks now follow the format — webm gets VP9 `.webm` chunks, mp4 concat gained `+faststart`.) |

### How it was sequenced

Phase 1 first (independent, small, high teaching value), then the quick wins of
Phase 3, then Phase 2's extraction work (larger, touches `<Video>`'s
contracts), then Phase 4, with Phase 5 as the capstone — which is the order
execution actually followed. House rules held throughout: every primitive
landed with colocated tests, a barrel export, a same-commit docs
chapter/section, a source-map entry, and — for anything multi-file — a plan in
`plans/` under the TODO/DONE discipline.
