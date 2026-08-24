# 040 — `calculateMetadata` can be async

**Status:** DONE — 2026-08-24 — hook may return a promise;
`resolveCompositionConfig` is async; `probe-media.ts` probes via detached
`<video>` (both paths serve public/ statically); MediaSized demo sized to
clip.mp4 with deliberately-wrong static 30f; App resolves in a cancellable
effect with statics fallback + `· resolving…`; posters show declared statics.
Live: MediaSized renders 5.000000 s / frames 0–149; Countdown `--props
{"seconds":3}` → 3.0 s; rejecting props fail named in ~3.4 s.

**Backlog item:** #20 (`20-async-calculate-metadata.md`) — P2, M

## Problem

`calculateMetadata` is sync-only, so metadata can only be arithmetic over props.
The flagship upstream use case — **size the composition to the media itself** —
needs an `await`, and there is no seam for one. This is the last fidelity gap on
the README's "deliberately omitted" list.

## Fix shape

1. Hook signature: `CalculatedMetadata | Promise<CalculatedMetadata>`;
   `resolveCompositionConfig` goes async, both callers await it.
2. New `src/render/probe-media.ts`: `probeMediaDurationInSeconds(src)` — detached
   `<video>` + `loadedmetadata`. Vite serves `public/` in dev AND in the render
   page (`createServer()` at `render.mjs:472`), so ONE helper covers both paths.
   No offthread-server dependency.
3. Demo `MediaSized`: durations itself to `clip.mp4` via the probe. Static
   `durationInFrames: 30` is DELIBERATELY wrong (file is 5.000 s) so a correct
   render proves the probe ran.
4. `main-render.tsx`: module body moves into an async boot; publishes
   `configError` on rejection (named error, fast — same contract as today). A
   hung hook gets its own named deadline (`orTimeout`, 30 s, exported from
   registry.ts and unit-tested): it sits AHEAD of the 60 s ready-wait so the
   failure names `calculateMetadata` instead of a generic page-timeout. Preview
   adds no timeout — a hanging hook is visible as a spinner in your own dev
   server; export must fail loudly and named.
5. `App.tsx`: resolution becomes a state machine (`resolving | ok | error`)
   driven by an effect with cancellation; while resolving, the Player keeps
   rendering statics ("statics guarantee something to render" — unchanged).
   `Poster` switches to declared statics: posters never probe (N probes per
   gallery open); Countdown's static already matches its default calc.
6. Tests: registry async cases (+ rejecting, + non-promise back-compat,
   + `orTimeout`), App adapted to flush effects, MediaSized with mocked probe.

## Acceptance

1. `--list` shows MediaSized; rendering it produces duration == probed clip
   length (±1 frame), NOT the static 30.
2. Rejecting `calculateMetadata` still fails fast + named on BOTH paths;
   `--props` / `--list` unchanged.
3. Chapter sections (6, 7) + source-map entries in the same commit.
