# 09 — Feature backlog: the next primitives to build on the core

> **Partially done (A, F, G).** The three "Small" items were implemented:
>
> - **A. `staticFile(path)`** — `src/framewise-lite/staticFile.ts` returns a
>   root-relative URL (`'photo.png'` → `'/photo.png'`) consistent with both Vite's
>   public-dir serving and render.mjs's `assetPath()` mapping. Exported from
>   `index.ts`, tested.
> - **F. `random(seed)`** — `src/framewise-lite/random.ts` implements a seeded
>   PRNG (FNV-1a 32-bit hash → mulberry32) that returns identical [0, 1) values for
>   the same seed across preview and all parallel render workers. Accepts number or
>   string seeds. Exported from `index.ts`, tested (7 cases).
> - **G. Render progress + `--list`** — `scripts/render.mjs` now logs per-chunk
>   progress every 10 frames (frame N/total, percentage). `--list` prints all
>   registered composition IDs from `src/render/registry.ts` without launching
>   Chrome (`node scripts/render.mjs --list` → HelloWorld, AsyncImage, …).
>
> Remaining (B–E are Medium complexity):
> - **B.** `interpolate` string/tuple outputs + color interpolation
> - **C.** `Easing` library (bezier, in/out/inOut, linear)
> - **D.** `<Series>` sequential sequences + `<Loop>` repeat helper
> - **E.** `measureSpring` / spring `durationInFrames` / `reverse`

The README's "Deliberately omitted" section already lists the natural next
features. This file turns them into discrete, buildable units, roughly ordered
by value-for-effort. Each is independent; pick one per PR.

## A. `staticFile(path)` asset helper
Today assets are referenced by raw URL (`/photo.png`, `/bg.wav`) and the renderer
re-derives the filesystem path with `join('public', ...)` (`render.mjs:215`).
Add a `staticFile('photo.png')` helper that returns the correct URL in preview
and that the renderer understands when mapping to disk. This removes the
hardcoded `public/` assumption (ties into backlog 05) and matches Framewise's
API. **Small.**

## B. `interpolate` string/tuple outputs (e.g. `"scale(2)"`, colors)
The numeric path is done; add the string-template path so `interpolate(frame,
[0,1], ['scale(0)', 'scale(2)'])` and color interpolation work. Pair with an
`interpolateColors(frame, range, [from, to])` helper. The README calls these out
as "buildable on what's here." **Medium.**

## C. `Easing` library
A small set of easing functions (`Easing.bezier`, `ease`, `in/out/inOut`,
`linear`) consumable by `interpolate`'s existing `easing` option (already
supported per-segment, interpolate.ts:155-162). No core changes — just a new
module + tests. **Small–Medium.**

## D. `<Series>` and a `loop` helper
`<Series>` lays out sequential `<Sequence>`s without manual `from` math; a
`<Loop durationInFrames>` repeats a child. Both build directly on `<Sequence>`
(Sequence.tsx is the substrate). **Medium.**

## E. `measureSpring` / spring `durationInFrames` / `reverse`
Restore the upstream spring options that were dropped (spring.ts:5-7). Requires a
`measureSpring` that finds when the spring settles within a threshold. Enables
duration-normalized springs. **Medium.**

## F. Deterministic `random(seed)`
A seeded PRNG so compositions can use randomness that's identical in preview and
across parallel render chunks (the whole determinism story depends on purity).
Without it, `Math.random()` in a comp would differ per browser and break the
sha256 determinism check. **Small, high-leverage for correctness.**

## G. Render progress + ergonomics
A live progress indicator (frames done / total / ETA) during render, and a
`--list` flag to print available composition ids from the registry. Quality-of-
life for the CLI. **Small.**

## Notes
- Keep each addition tested and, where it claims Framewise parity, faithful — see
  backlog 08 on fidelity discipline.
- Items A and F also harden existing behavior (asset paths, determinism), so they
  pay off beyond just being new features.
