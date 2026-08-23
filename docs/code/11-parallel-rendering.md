# Chapter 11 — Parallel Chunked Rendering (Stage 6)

**File:** `scripts/render.mjs`

The last stage isn't a new primitive — it's a renderer-architecture change that
makes renders _fast_. Every stage before this rendered frames one at a time in a
single browser. Stage 6 splits the frame range into chunks and renders them
**concurrently across separate browsers**, then reassembles.

## Why this is even possible

Recall the founding idea: **a frame is a pure function of its number.** Frame 75
depends on nothing except the number 75 — not on frame 74, not on render order,
not on which machine drew it. That makes rendering _embarrassingly parallel_:
you can compute any subset of frames independently and the result is identical.
Stage 6 is just cashing in that property.

## Determinism needs seeded randomness

Parallel rendering's frame-hash guarantee depends on **every** source of
variation being deterministic. `Math.random()` is not — each call advances a
hidden global state, so the sequence diverges across workers (and across preview
replays). The result: frame 75 shows a different pixel in each worker, and the
sha256 check fails — silently, because nothing logs a warning.

The library ships `random(seed)` for this reason. It's a seeded PRNG: the same
seed always produces the same pseudo-random number in `[0, 1)`, everywhere and
always. Compositions call `random('dot:' + cycle)` or `random(frame)` instead of
`Math.random()`. The only legitimate reference to `Math.random` in the source
tree is the doc comment in `random.ts` explaining why NOT to use it (proved by
`grep -rn "Math.random" src/ | grep -v "random.ts"` — empty).

Asset paths also matter for determinism. The `staticFile()` utility
(`src/framewise-lite/staticFile.ts`) resolves asset names to rooted paths
(`'photo.png'` → `'/photo.png'`) in the Vite public-dir convention — the same
convention used by both the dev server (serving) and `render.mjs`'s `assetPath`
(mixing). Compositions use `staticFile()` instead of hardcoding `src="/…"` so
that asset resolution stays consistent across all render contexts.

## The architecture

```
                     ┌─ browser w0 ── frames [0,38)  ─┐
   one Vite server ──┼─ browser w1 ── frames [38,76) ─┼──▶ shared frames dir
   (render.html)     ├─ browser w2 ── frames [76,114)─┤    frame-00000.png …
                     └─ browser w3 ── frames [114,150)┘    frame-00149.png
                                                                  │
                                                      one ffmpeg pass (+ audio)
                                                                  ▼
                                                              out.mp4
```

- **Contiguous chunks.** `[0, durationInFrames)` is split into `concurrency`
  contiguous ranges (`--concurrency`, default 4). Contiguous (not round-robin)
  keeps `<Video>` seeking local within a worker.
- **A browser per chunk.** Each chunk gets its own `puppeteer.launch()` — fully
  separate OS processes, so the CPU-bound work (React render, video decode,
  screenshot) actually runs on multiple cores. (Real Framewise uses multiple tabs
  locally and separate Lambda functions in the cloud; separate browsers here give
  the cleanest speedup with the least shared-state subtlety.)
- **Shared frames dir.** Every worker writes `frame-NNNNN.png` keyed by its
  _absolute_ frame number into one directory. Because the ranges are disjoint,
  there are no collisions, and the existing single ffmpeg pass reads the complete
  `frame-%05d.png` sequence — **no video concatenation needed.** The chunking
  parallelizes the slow part (screenshotting); the fast part (stitching) stays
  one pass.

The whole thing reduces to: `renderChunk()` is the old per-frame loop scoped to
a range, and the driver runs `concurrency` of them at once.

```js
const results = await Promise.allSettled(
  chunks.map(([s, e], i) => renderChunk(url, s, e, {…, label: `w${i}`})),
);
```

## Three robustness details

**1. Each worker owns its browser in a `try/finally`.** `Promise.allSettled`
(not `Promise.all`) means one worker throwing doesn't abandon the others
mid-render — every chunk settles, every browser closes itself, and only then does
the outer `finally` tear down the shared Vite server and frames dir. With `all`,
a single failure would leak the sibling Chrome processes (the Stage-2 leak, ×N).

**2. A frame-count assertion before stitching.**

```js
if (files.length !== durationInFrames)
  throw new Error(
    `expected ${durationInFrames} frames but found ${files.length} — chunk range bug?`,
  );
```

A chunk-boundary off-by-one (a gap or overlap) is the most likely bug in this
refactor and is otherwise invisible — ffmpeg would silently stitch a short or
misordered sequence. One line guards every render.

**3. Identical launch flags everywhere.** The config probe, every worker, and the
concurrency-1 baseline all use the same `LAUNCH_ARGS`. Otherwise a
sequential-vs-parallel determinism check could differ for a flag reason
(`--force-color-profile` etc.) rather than a real one.

## Proving parallelism is transparent

The headline claim — _concurrency changes speed, not output_ — is checked with a
content hash of the rendered PNGs:

```js
const hash = createHash('sha256');
for (const f of files) hash.update(await readFile(join(framesDir, f)));
console.log(`▶ frames: ${files.length} · sha256 ${hash.digest('hex').slice(0, 16)}`);
```

Rendering **HelloWorld** (pure CSS/math, so byte-determinism is unambiguous) at
concurrency 1 and 4 produced the **identical** hash `2e0775f6c750f877`. So the
rendered _frames_ are byte-for-byte identical regardless of concurrency. (The
final mp4s may still differ bit-wise — libx264 is multithreaded, so identical
input frames can encode to slightly different bitstreams — but the pixels going
in are provably the same, which is the property that matters.)

> The hash check is run on `HelloWorld` and `AsyncImage`, deliberately **not** on
> `WithVideo`. H.264 decode can vary subtly across simultaneously-launched
> browsers (HW vs SW paths under load), so a video hash mismatch would be a decode
> confound, not a chunking bug. For `WithVideo`, correctness is instead checked the
> robust way: comp frame 75 in the parallel render still reads **"75"**, proving the
> right frame reached the right slot.

`AsyncImage` is the richer determinism proof: its identical hash (`5489ccf3…`)
means each chunk's browser **independently** waited on its own `delayRender`
handles (the simulated fetch) and produced the same fully-resolved frames — with
no "pending at capture" leaks. That's the "fresh context per chunk" idea from
[chapter 8](08-delay-render.md) shown working: in this model, _every_ chunk's
first frames re-wait for assets, exactly like real Framewise's per-chunk contexts.

## The speedup (and why it's sublinear)

Render-phase wall-clock, this machine:

| composition | concurrency 1 | concurrency 4 | speedup  |
| ----------- | ------------- | ------------- | -------- |
| HelloWorld  | 18.7s         | 7.2s          | **2.6×** |
| WithVideo   | 14.6s         | 5.8s          | ~2.5×    |
| AsyncImage  | 12.3s         | 6.8s          | ~1.8×    |

It's **sublinear**, and honestly so — three things cap it: physical core count,
the fixed cost of launching N browsers, and the serial ffmpeg stitch at the end
(Amdahl's law). `AsyncImage` gains least because its ~3s `delayRender` floor is
paid by _every_ chunk's browser in parallel — that latency doesn't parallelize
away, it just stops being paid 150 times.

## Audio across chunk boundaries

Audio is collected per chunk and merged before aggregation. A subtle question:
`bg.wav` spans all four chunks — does it become one segment or four? Each chunk is
a separate page, but they render the _identical_ React tree, so React's `useId`
assigns the _same_ instance id in every page. Aggregating by id therefore merges
the four chunks' reports back into **one** `bg` segment `[0,149]` — verified in
the log (`audio: 2 segment(s)` for `WithAudio`, same as sequential). Even had it
split into adjacent per-chunk segments, the output would still be correct
(adjacent `atrim`s reconstruct the continuous track) — just with a sub-millisecond
`adelay`-rounding seam at each boundary. It didn't split, so there's no seam.

## The production variant (what real distribution adds)

This renderer shares one filesystem, so a shared frames dir + single stitch is
ideal. Framewise **Lambda** can't assume that — its workers are separate machines.
So it does the other thing: each worker **encodes its chunk to a partial video**,
uploads it, and a final function **concatenates** the partials (and muxes the
global audio). That's more moving parts (codec-consistent concat, boundary
keyframes, audio spanning chunks) but it's the same core idea — split the pure
frame range, render in parallel, reassemble in order. Our version teaches the
concept; theirs survives a network between the workers.

## Distributed on one machine (`--distributed`)

For teaching, `--distributed` simulates Lambda on one box: each chunk's frames
are encoded to a temporary video (`planChunkVideoEncode` — `-start_number` +
`-frames:v` per chunk, same codec/crf), then the concat demuxer stitches them
with stream copy (`buildConcatList` → `file '…'` list → `ffmpeg -f concat -c
copy`). On this machine HelloWorld c4 renders identically (hash `3203283d…`) at
16.4 s distributed vs 20.5 s local. With audio, the simulation falls back to
single-stitch with a warning — true distributed audio would mux the globally-
aggregated segments at concat time, which is the same filter graph as today
fed by the concat video instead of the image sequence.

## Where the project stands

With Stage 6, the arc is complete: a frame-as-state engine (1), the animation
primitives (2–4), a player (5), a renderer (7), deterministic async assets (8),
audio (9), embedded video (10), and now parallel rendering (11). Every core idea
behind Framewise — and the reason each is shaped the way it is — has a small,
working, verified implementation here.

---

← Back to the [walkthrough index](README.md)
