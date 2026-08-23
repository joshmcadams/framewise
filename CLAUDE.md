# CLAUDE.md

## What this is

framewise-lite is a minimal, educational reimplementation of Framewise's core. Library in
`src/framewise-lite/`, compositions in `src/compositions/`, registry + render entry in
`src/render/`, Node renderer in `scripts/render.mjs`, teaching chapters in `docs/code/`
(11 chapters). The one idea everything hangs off: **a video is a pure function of the frame
number** — a composition asks "what frame are we on?" and renders accordingly, identically
in preview and export.

## Commands

| Purpose      | Command                                      | Notes                                                                |
| ------------ | -------------------------------------------- | -------------------------------------------------------------------- |
| dev          | `npm run dev`                                | Vite preview app                                                     |
| test         | `npm test`                                   | vitest run                                                           |
| typecheck    | `npm run typecheck`                          | tsc -b                                                               |
| build        | `npm run build`                              | tsc -b && vite build                                                 |
| build:lib    | `npm run build:lib`                          | Publishable library → dist/framewise-lite.js + dist/*.d.ts           |
| render       | `npm run render -- --comp <id> --out <path>` | Needs system Chrome + ffmpeg; `--list` needs neither                 |
| verify       | `npm run verify`                             | tsc -b && eslint . && prettier --check . && vitest run && vite build |
| lint         | `npm run lint`                               | eslint .                                                             |
| format       | `npm run format`                             | prettier --write .                                                   |
| format:check | `npm run format:check`                       | prettier --check .                                                   |

## Architecture invariants — do not break these

1. **`useCurrentFrame()` only reads context**; it knows nothing about clocks.
   `src/framewise-lite/VideoConfig.tsx:20-25` — whoever renders the tree decides what the
   frame is. This decoupling is the whole point.

2. **Preview and export render through the same `CompositionHost`**
   (`src/framewise-lite/CompositionHost.tsx:18-37`). Preview passes `playback`, render
   passes none — a null `PlaybackContext` is how `<Audio>` / `<Video>` detect render mode.

3. **Determinism: a frame is a pure function of its number.** Compositions use `random(seed)`
   (`src/framewise-lite/random.ts:24-37`), never `Math.random()`. The renderer verifies a
   sha256 frame-set hash, identical at any `--concurrency` (`scripts/render.mjs:453-455`).

4. **No-deps `useLayoutEffect`s in `Audio.tsx`/`Video.tsx`/`Img.tsx` are load-bearing.**
   The file comments explain why: `Audio.tsx:36-41`, `Video.tsx:50-54,79-129`,
   `Img.tsx:10-18`. The preview media-sync is extracted into `useMediaSync.ts`
   (`src/framewise-lite/useMediaSync.ts`) with a full deps list — shared by both components,
   must not be inlined back.

5. **`delayRender` timeout constants have a single source of truth:**
   `src/framewise-lite/delay-render-defaults.mjs` (+ `.d.mts`), shared by TS and
   `render.mjs`. The renderer's backstop must fire AFTER the in-app labeled error
   (ordering contract: `delay-render-defaults.mjs:5-8`).

## Deliberate decisions — do not "fix" these

- **`interpolate` defaults to `extend`**, not clamp — runs linearly past the range.
  `src/framewise-lite/interpolate.ts:5-6`.
- **`posterize` is an extension not in upstream Framewise.** `src/framewise-lite/interpolate.ts:8-11`.
- **`spring` is verbatim upstream math except `overshootClamping`**, which clamps in output
  space (not upstream's incorrect norm-space clamp). `src/framewise-lite/spring.ts:10-14`.

## Docs are the product

`docs/code/` chapters mirror the source; a change to a module with a chapter updates the
chapter in the same commit. New primitives get a chapter/section and an entry in the
`docs/code/README.md` source map.

## Testing conventions

- Vitest globals on (`vite.config.ts:7`).
- DOM suites start with `// @vitest-environment jsdom` and set
  `IS_REACT_ACT_ENVIRONMENT = true`. Example: `src/framewise-lite/delay-render.test.tsx:1,13`.
- Tests colocated as `src/**/X.test.ts(x)`.
- Drain the delayRender registry in `afterEach` (see
  `src/framewise-lite/delay-render.test.tsx:17-21`).

## Plans

Implementation plans live in `plans/` with a status index at `plans/README.md`. Each plan
is a step-by-step executor script. Executors update their row when done. All thirty
(001–030) are DONE; new work follows the same pattern (write the plan, execute, flip the
row).
