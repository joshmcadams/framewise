# 00b — Render pipeline API (`renderVideo()` + event emitter)

**Status:** ready · **do this first among engineering items** (item 00 is the only thing ahead of it)
**Effort:** M · **Depends on:** nothing
**Unblocks:** 04 (progress), 08a (studio render button), 12 (batch), 14
(resumable), 15 (MCP). All five of those describe calling the renderer as a
function. Today none of them can.

## Audit verdict

This item did not exist in the first draft, and its absence is the biggest
structural problem in the backlog. Five items say some version of "wrap the
existing pipeline in a loop" or "stream its events". `scripts/render.mjs` is not
a pipeline you can wrap — it is a script whose entire body runs at module load:

| What                          | Where                | Why it blocks reuse                                      |
| ----------------------------- | -------------------- | -------------------------------------------------------- |
| argv parsing + validation     | `render.mjs:86-184`  | options come from `process.argv`, not a caller           |
| `--list` short-circuit        | `render.mjs:174-184` | calls `process.exit(0)` mid-module                       |
| Chrome resolution             | `render.mjs:244`     | throws at import time on a machine without Chrome        |
| temp frames dir + Vite server | `render.mjs:471-481` | created once, at module scope                            |
| signal handlers + `cleanup()` | `render.mjs:496-535` | process-global; a second render would double-register    |
| the render itself             | `render.mjs:537-773` | one top-level `try/finally`, results go to `console.log` |

So "batch = a row loop around the pipeline" (item 12) actually means either
re-`import()`ing a module with side effects, or spawning `node render.mjs` per
row — which is exactly the cold-start cost item 12 exists to remove. Same story
for the studio render button and the MCP server, both of which would otherwise
have to scrape human-readable stdout.

Fixing this once is cheaper than working around it five times, and it is a pure
refactor: **no behavior change, no new flags, same output bytes.**

## Design

### The API

New `scripts/render-pipeline.mjs`:

```js
/**
 * Render one composition. Pure of process globals: no argv, no process.exit,
 * no console.log. Everything observable goes through `emit`.
 *
 * @param {RenderOptions} options  fully-resolved, already-validated options
 * @param {(event: RenderEvent) => void} emit
 * @returns {Promise<RenderResult>}
 */
export async function renderVideo(options, emit = () => {}) { … }

/** Resources shared across several renderVideo() calls (batch, MCP, studio). */
export async function createRenderContext({publicDir, chromePath, ...}) { … }
//   → {url, server, browserPool, close()}   — one Vite server, one Chrome path
```

`RenderOptions` is the parsed shape of today's flags — `{compId, inputProps,
out, format, stillFrame, concurrency, distributed, crf, codec, audioBitrate,
publicDir, chromePath, noWait, noSandbox}` — as a plain object with defaults
applied by a pure `resolveRenderOptions(partial)` in `render-lib.mjs`.

`RenderResult` is `{outFile, sha256, frameCount, config, seconds,
audioSegments}` — everything today's final `console.log` lines contain, as data.

### The event stream

`emit` is the seam item 04 turns into `--log=json`. Define the event union
**here**, in this item, so 04 is only a formatter:

```
{type:'meta',   compId, config, totalFrames, concurrency, chunks}
{type:'chunk',  index, from, to, status:'start'|'ok'|'error', error?}
{type:'frame',  frame, ms, worker}
{type:'pending',frame, labels}            // today's "pending at capture" line
{type:'audio',  segments}
{type:'encode', stage:'chunk'|'concat'|'single'|'copy', detail}
{type:'warn',   message}                  // today's console.warn lines, verbatim
{type:'done',   outFile, sha256, frameCount, seconds}
```

Rule: the _message strings_ of today's warnings and named errors move verbatim.
The ladder in invariant 5 is about which error a user sees first; wrapping it in
an event object must not reword it.

### The CLI becomes a thin shell

`scripts/render.mjs` keeps: argv parsing, `--list`, `--help`, Chrome resolution,
signal handling, and a **console formatter** that turns events into the exact
lines it prints today. Target: `render.mjs` under ~200 lines, all of it I/O and
process concerns.

### Resource ownership — the part that is easy to get wrong

Today `cleanup()` (`render.mjs:496-517`) tears down browsers, the Vite server,
_and_ `rm(framesDir)`. Split those responsibilities:

- `renderVideo()` owns its **frames dir** and its **browsers**, and cleans both
  up in its own `finally`. It must be safe to call twice sequentially.
- `createRenderContext()` owns the **Vite server** and lives across calls.
- The **process-global** concerns — signal handlers, `process.exit`, the
  `handleSIGINT:false` dance and the Vite-SIGTERM-listener removal
  (`render.mjs:455-481`) — stay in `render.mjs`, and call
  `context.close()` + any in-flight `renderVideo`'s abort.
- Add an `AbortSignal` to `RenderOptions` so a caller (studio Cancel button, MCP
  job cancel, batch `--fail-fast`) can stop a render without killing the process.
  Check it between frames in the capture loop (`render.mjs:378-424`), and treat
  abort as a named error, not a generic one.

### What must NOT change

- The exact ffmpeg argv produced by `planEncode` / `planChunkVideoEncode`. Pin it:
  the existing `render-lib.test.mjs` argv assertions must pass untouched.
- The sha256 of a rendered frame set. This is the acceptance test (below).
- Every user-visible stdout line, byte for byte, for a default `--log=info` run.

## Files touched

- **New** `scripts/render-pipeline.mjs` (the extracted pipeline) + colocated
  tests in `scripts/render-pipeline.test.mjs`.
- `scripts/render.mjs` — reduced to argv + formatter + signals.
- `scripts/render-lib.mjs` — gains `resolveRenderOptions()` (pure, unit-tested);
  everything already there stays put.
- `scripts/AGENTS.md` — document the new three-layer split
  (`render.mjs` → `render-pipeline.mjs` → `render-lib.mjs`) and which layer new
  code belongs in. Without this note the next agent will add a flag in the wrong
  layer.

## STOP — decisions the executor must not make alone

1. **Do not change any flag's name, default, or semantics in this item.** If you
   find a flag bug, write it down and ship it separately. A refactor that also
   changes behavior cannot be verified by hash identity, which is the only
   strong check available here.
2. **Do not introduce a browser _pool_ that outlives a render** unless item 12
   is being executed at the same time. `createRenderContext` may hold the Vite
   server only; pooled browsers across renders is a separate, riskier change
   (state leakage between compositions) and item 12 owns that decision.
3. **Do not move `resolveChromePath` into the pipeline.** Item 03 is about to
   rewrite it, and it must stay callable without a render in flight.

## Risks

- **Silent behavior drift during extraction.** Mitigation is mechanical: capture
  a full stdout transcript and the frame-set sha256 of four runs _before_
  touching anything, and diff after. Commit the transcripts to the plan, not the
  repo.
- **Double cleanup / leaked temp dirs** when `renderVideo` is called twice. Test
  it explicitly (below) — this is the failure mode item 12 would otherwise hit
  in production.
- **Top-level await removal.** `render.mjs` uses top-level `await` today
  (`render.mjs:176`, `:471`, `:551`). Keep `type: "module"` semantics; wrap the
  new CLI body in an async `main()` and make its rejection path print the same
  named error and exit non-zero.

## Verification

Hash identity is the whole test here.

1. **Golden transcripts, pre/post.** For each of
   `--comp HelloWorld`, `--comp HelloWorld -c 4`,
   `--comp WithAudio`, `--comp WithSeries --distributed -c 4`,
   `--comp HelloWorld --still 45`, `--comp HelloWorld --format png-seq`:
   record stdout and the `▶ frames: … sha256 …` line before the refactor,
   re-run after, diff both. Any diff is a bug in the refactor, not an
   improvement.
2. **Callable twice.** A test that calls `renderVideo()` twice against the same
   context asserts: both produce output, the two temp frames dirs are gone
   afterwards (`readdir(tmpdir())` shows no `framewise-lite-*` left by the test),
   and the second run's hash equals the first's for identical options.
3. **Abort.** Start a render, abort after ~3 frames, assert: rejects with a named
   abort error, browsers are closed (`browser.process()` gone), frames dir
   removed, and the process is still alive and able to render again.
4. **Events.** Assert the event sequence for a 3-frame comp: exactly one `meta`,
   `frameCount` `frame` events, exactly one `done`, and `done.sha256` equals the
   value in the human transcript.
5. **Unchanged unit surface.** `scripts/render-lib.test.mjs` passes with zero
   edits. If it needs edits, the refactor changed something it should not have.

**What this does not cover:** nothing here proves the _encoded file_ is
unchanged — the sha256 gate hashes PNGs before encoding. Add one `ffprobe`
comparison (codec, pix_fmt, duration, dimensions, audio stream presence) on the
mp4 and webm runs, pre and post.

## Docs

Chapter 7 (`docs/code/07-renderer.md`) gains a short "The three layers" section:
what lives in the CLI, what lives in the pipeline, what lives in the pure lib,
and why the split exists (so the renderer can be _called_, not only _run_).
Source-map entry in `docs/code/README.md`. This is also the natural place to
state the sha256 gate's honest scope.

## Definition of done

- [ ] `renderVideo()` and `createRenderContext()` exported and unit-tested
- [ ] `render.mjs` is argv + formatter + signals only
- [ ] All six golden transcripts byte-identical, all six hashes identical
- [ ] `render-lib.test.mjs` untouched and green
- [ ] Two sequential renders leave no temp dirs; abort path tested
- [ ] `ffprobe` pre/post comparison recorded in the PR
- [ ] `npm run verify` green; chapter 7 + source map updated
- [ ] `scripts/AGENTS.md` documents which layer new renderer code goes in
