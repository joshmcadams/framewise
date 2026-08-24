# 20 — `calculateMetadata` cannot be async

**Type:** Feature gap (fidelity) · **Priority:** P2 · **Effort:** M

## Problem

`calculateMetadata` is declared sync-only (`src/render/registry.ts:41-44`):

```ts
calculateMetadata?: (args: {
  props: Record<string, unknown>;
  composition: Composition;
}) => CalculatedMetadata;
```

So metadata can only be derived from arithmetic over props — which is all the
`Countdown` demo needs (`seconds` → `durationInFrames`). Upstream's primary use
case is the one thing this repo cannot express: **derive the composition's
duration from the media itself.** "Make this comp exactly as long as
`clip.mp4`" requires an `await`, and there is no seam for one.

This is the last real fidelity gap. Every other item on the README's
"deliberately omitted" list now ships.

## Why now

Plan 021 shipped `<OffthreadVideo>` and `scripts/offthread-server.mjs`, so the
renderer already has ffmpeg plumbing and a containment-checked public-dir
resolver (`assetPath`). Probing a duration is a small addition to machinery
that exists, not new machinery.

The ready-check seam is also already correct. `main-render.tsx` publishes both
`config` and `configError`, and `openWorker` waits on
`config || configError` (`scripts/render.mjs:344-351`) — an async resolve fits
that contract without touching the probe protocol.

## Shape

1. `CalculatedMetadata` return type becomes `T | Promise<T>`.
2. `resolveCompositionConfig` becomes async; both callers await it.
3. `main-render.tsx` awaits before publishing `window.framewiseLite` — the
   renderer's existing wait already covers the delay.
4. `App.tsx` needs a resolving state (it currently resolves during render).
5. A demo composition that sizes itself to `clip.mp4` — the case that motivates
   the whole feature.

## The interesting part (make the chapter about this)

Metadata resolution now sits **before first paint on both paths**. That raises
questions the sync version never had to answer:

- What does the preview show while it resolves?
- What happens when it *fails* — the current `configError` banner assumes the
  failure is instant and deterministic.
- Does it need its own timeout, and where does that sit in the ladder
  documented at `render.mjs:78-84` (30 s / 35 s / 40 s / 45 s)?

## Acceptance

- A composition whose `durationInFrames` comes from probing a real video file
  renders correctly, and `--list`/`--props` still work.
- A rejecting `calculateMetadata` surfaces a named error on both paths, fast —
  same guarantee the sync version gives today.
- Chapter section + `docs/code/README.md` source-map entry, same commit.
