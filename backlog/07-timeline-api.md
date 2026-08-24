# 07 — Timeline introspection API (`buildTimeline`)

**Status:** **NEEDS DECISION** — the first draft's mechanism does not work.
Read "The mechanism problem" before writing a plan.
**Effort:** **L** (was M) · **Depends on:** nothing mechanically
**Unblocks:** 08b (timeline panel), audio-lane visualization, richer
`describe_composition` in item 15

## Audit verdict

The _value_ is real and the API shape is good. The _mechanism_ was wrong, and it
was wrong in a way that would not surface until the first nested demo:

> "run the composition **once** under a collector context where timing
> components self-report spans… Static composition is possible because `Series`
> computes offsets synchronously and `Loop` knows `times`. No O(duration) frame
> simulation needed."

`Sequence` returns `null` when the frame is outside its window
(`Sequence.tsx:33-36`). So in a single render at frame 0:

- a `<Sequence from={60}>` renders nothing → its children never mount → they
  never report;
- `<Series>` _does_ compute all offsets synchronously (`Series.tsx:53-71`) and
  emits all its `<Sequence>` wrappers, but only the wrapper active at frame 0
  mounts its child, so nested structure inside later clips is invisible;
- `<Loop>` renders only iteration `floor(frame / durationInFrames)`
  (`Loop.tsx:41-45`), so only one iteration's subtree exists;
- `<Audio>`/`<Video>` inside any of the above never report at all —
  `reportAudio` is called from a mount-time effect (`Audio.tsx:53-55`).

A one-render collector therefore returns _the frame-0-active subtree_, which for
the existing `WithSeries` demo is one clip out of several. It would look like it
worked, which is worse than failing.

Also worth knowing: **this is not a solved problem upstream either.** Remotion's
Studio timeline registers sequences from mounted components, so it likewise
reveals nested structure progressively as the playhead enters it. Any design
here inherits an honesty boundary; the job is to choose which one and document
it, not to pretend there isn't one.

## Three viable mechanisms — pick one, in the plan, with the trade-off written down

### A. Collector render mode (recommended for v1)

Add a `TimelineCollectorContext`. When it is present:

- `Sequence` **renders its children regardless of activity**, wrapped in
  `<FrameProvider value={0}>`, and reports `{from, durationInFrames, name?}`.
- `Loop` renders iteration 0 only and reports `{durationInFrames, times}`; the
  collector expands the window arithmetically.
- `Series` needs no change — it already computes every offset.
- `Audio`/`Video`/`OffthreadVideo`/`Img` report their `src` and suppress their
  real side effects (no `delayRender` handle, no element seek, no
  `reportAudio`).

Gives the full **structural** timeline in one pass, cheaply.

- **Cost:** every subtree mounts at once. A composition whose components do real
  work on mount (fetch, decode) pays for all of it. Mitigate by suppressing
  `delayRender` in collector mode and bounding total collector time.
- **Honesty boundary — must be documented verbatim in the API docs:** structure
  produced by _your own_ frame-conditional logic (`frame < 30 ? <A/> : <B/>`)
  is invisible; only `Sequence`/`Series`/`Loop`/media report.
- **Hazard:** a composition that recurses on frame (`<Sequence from={n}>` built
  from a frame-derived list) could mount unboundedly. Cap collector depth and
  span count, and fail with a named error rather than hanging.

### B. Frame sampling

Drive `renderFrame(0..n-1)` and record what mounts. Correct for everything,
including third-party components — and it is exactly what the renderer already
does, so it reuses proven code. Cost is O(duration) React renders (no
screenshots), which for a 150-frame comp is fast and for a 10-minute comp is not.

Best as the **`--sample` fallback** the first draft already proposed, kept for
"my component hides its timing" cases.

### C. Do not build it; build 08b differently

The only concrete consumer is the studio timeline panel. That panel could be
driven by **audio/media lanes only** (which the audio registry already collects
per frame during a render, `audio-registry.ts:24-49`) plus a
scrubber — no general timeline API at all. If 08b is the only reason 07 exists,
this is dramatically cheaper.

**Recommendation:** ship **A** with the honesty boundary documented and **B**
behind `--sample`; revisit C if A's collector mode turns out to fight the
component tree. Whoever writes the plan must state the choice and why.

## API (unchanged from the first draft — it was good)

```ts
type Span =
  | {kind: 'sequence'; from: number; durationInFrames: number; name?: string}
  | {kind: 'loop'; from: number; durationInFrames: number; times: number}
  | {kind: 'audio'; from: number; durationInFrames: number; src: string}
  | {kind: 'video'; from: number; durationInFrames: number; src: string};

type TimelineNode = {span: Span; children: TimelineNode[]};
type Timeline = {
  config: VideoConfig;
  roots: TimelineNode[];
  /** How this was produced, so consumers can show the caveat. */
  source: 'collector' | 'sample';
  /** Things the collector knows it could not see. */
  warnings: string[];
};

buildTimeline({compositionId, inputProps}): Promise<Timeline>
```

Two additions worth making:

- **`name?: string` on `<Sequence>`** — a display label for the panel. Small,
  purely additive, and the thing that makes a timeline readable. Add it in this
  item.
- **`warnings`** — where "this composition branches on the frame; structure may
  be incomplete" lives. Make the caveat data, not just prose.

## Files touched

`Sequence.tsx`, `Series.tsx`, `Loop.tsx`, `Audio.tsx`, `Video.tsx`,
`OffthreadVideo.tsx` (collector-aware; inert when the context is absent),
`VideoConfig.tsx` (new context), new `src/framewise-lite/timeline.ts` + test,
`src/render/main-render.tsx` (expose `window.framewiseLite.buildTimeline` next
to the existing seam, `:146-170`), new `scripts/timeline.mjs`
(`npm run timeline -- --comp X` prints JSON).

`buildTimeline` must resolve props through `resolveCompositionConfig`
(`registry.ts:211-250`) — the shared path, not a second resolver. It is async
(`registry.ts:211`), which is why `buildTimeline` returns a promise.

## STOP — decisions the executor must not make alone

1. **Which mechanism (A / B / C).** Write the choice and the honesty boundary
   into the plan before writing code.
2. **Do not let the collector context change anything on the normal path.** If
   `Sequence` gets an `if (collecting)` branch, the very first test is that the
   HelloWorld frame-set sha256 is unchanged, byte for byte, before and after the
   instrumentation.
3. **Do not make `<Sequence name>` required or reorder its props** — it is
   additive and optional.

## Risks

- **Instrumentation leaking into renders.** Highest-severity risk here; the hash
  test above is the guard.
- **Collector mounting media components for real** — a `<Video>` that seeks, or
  an `<Img>` that takes a `delayRender` handle, would make `buildTimeline` slow
  and possibly hang. Suppression must be explicit and tested per component, not
  assumed from "the context is present".
- **Unbounded expansion** from infinite `<Loop times={Infinity}>` — clamp loop
  span expansion to the composition duration (`Loop.tsx:37-39` already validates
  `times`; the collector must handle `Infinity` deliberately).

## Verification

- **Golden JSON** for `HelloWorld`, `WithSeries`, `WithAudio`, and a new
  nested-structure fixture (`Series` containing a `Loop` containing an `Audio`) —
  the nested fixture is the case that would have passed under the broken
  mechanism, so it is the regression test for this entire audit finding
- **Determinism untouched:** HelloWorld frame-set sha256 identical before/after
  the instrumentation commit, at `-c 1` and `-c 4`
- **No side effects in collector mode:** after `buildTimeline`,
  `getPendingDelayRenders()` is empty and `readAudioFrame()` is empty
- `calculateMetadata` interplay: a timeline for `Countdown` with
  `{"seconds": 3}` reflects the _derived_ 90-frame duration, proving the shared
  resolver path
- If **B** is also shipped: `--sample` and collector agree on `WithSeries`

**Does not cover:** neither mechanism can see structure your own component
creates conditionally on the frame. That limit is permanent; it belongs in the
docs and in `Timeline.warnings`, not in a future "fix".

## Docs

Chapter 4 (`docs/code/04-sequence.md`) appendix "Observing your timeline" — the
mechanism chosen, why a one-pass collector needs `Sequence` to behave
differently, and the honesty boundary stated plainly. Note the pattern kinship
with the audio registry (`audio-registry.ts:1-12`) — a collector armed by the
host, inert otherwise. Source-map entry.

## Definition of done

- [ ] mechanism chosen and justified in the plan
- [ ] nested fixture (`Series` → `Loop` → `Audio`) produces the correct tree
- [ ] frame-set hash byte-identical before/after instrumentation
- [ ] collector leaves no pending handles and no audio reports
- [ ] `warnings` populated for a frame-conditional composition
- [ ] `npm run timeline -- --comp WithSeries` prints valid JSON
- [ ] chapter 4 appendix + source map; caveat documented as data and as prose
