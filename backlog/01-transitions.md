# 01 — Transitions (`TransitionSeries` + presentations)

**Status:** ready · **highest user-facing value in this backlog**
**Effort:** M · **Depends on:** nothing (built on `Sequence` + `interpolate`/`spring`)
**Unblocks:** scene-based videos — the #1 authored-content need; lets
`README.md:152` drop "Transitions" from the deliberately-omitted list

## Audit verdict

Sound as drafted, and correctly identified as the best value-per-effort item
here: every mechanism it needs already exists and is tested. Three things the
first draft under-specified, all of which are where the bugs will actually be:

1. **Child validation** is more complex than `<Series>`'s. `Series` rejects
   anything that isn't a `Series.Sequence` (`Series.tsx:53-59`). A
   `TransitionSeries` must additionally reject _adjacency_ mistakes — leading or
   trailing `Transition`, two consecutive `Transition`s — and those errors are
   what authors will hit first. They need the same named, actionable tone as the
   existing ones.
2. **Audio behavior during an overlap was hand-waved** as "no audio-path changes
   at all". True, but the _consequence_ was not stated: both scenes' `<Audio>`
   report on the overlap frames (`Audio.tsx:53-55`), producing two overlapping
   segments that `amix` sums (`render-lib.mjs:217-223`). Visually you get a
   cross-fade; audibly you get both tracks at full volume. That is a real
   surprise and must be documented, with the `volume` callback as the escape
   hatch.
3. **A transition longer than its neighbour** is the off-by-one generator. Pin
   the rule explicitly rather than discovering it.

## Why this is worth building

Scene-to-scene transitions are the most-requested primitive for real videos, and
this codebase already has every piece: overlapping `<Sequence>`s
(`Sequence.tsx:16-42`), `interpolate` with clamping
(`interpolate.ts`), `spring` + `measureSpring` (`spring.ts`), and `Series`'s
offset-computation pattern to copy (`Series.tsx:53-71`). Nothing new is needed
in the renderer, the audio path, or the host.

## Design

### Public API

```tsx
<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({durationInFrames: 15})}
  />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

### Timing

```ts
type TransitionTiming = {
  /** How many frames the two neighbours overlap. */
  getDurationInFrames: () => number;
  /** 0 → 1 across the overlap. Pure function of the local frame. */
  getProgress: (frame: number, fps: number) => number;
};

linearTiming({durationInFrames, easing?}): TransitionTiming
springTiming({config?, durationInFrames?}): TransitionTiming
```

`springTiming` derives its overlap length from `measureSpring(config, fps)`
(already exported, `spring.ts` / barrel `index.ts:5`) when `durationInFrames` is
omitted, and **rounds up to a whole frame** — a fractional overlap would make the
offset arithmetic below non-integral, which is where gaps come from.

### Presentation

```ts
type PresentationState = {
  progress: number; // 0..1 across the overlap
  passage: 'entering' | 'exiting';
  width: number; // from useVideoConfig, so clip-paths can use px
  height: number;
};
type Presentation = (state: PresentationState) => {
  style?: CSSProperties;
  /** Optional wrapper for presentations that need an element (e.g. a mask). */
  wrap?: (children: ReactNode) => ReactNode;
};
```

Ship four: `fade()`, `slide({direction})`, `wipe({direction})` (linear
`clip-path`), `clockWipe()` (radial `clip-path`). All four are **pure functions
of `progress`** — no refs, no effects, no time. That is what keeps invariant 1
intact and makes them unit-testable without a DOM.

### The offset arithmetic (state the rule, then test it)

Given items `S₀ T₀ S₁ T₁ S₂ …` with scene durations `d₀ d₁ d₂ …` and transition
overlaps `t₀ t₁ …`:

```
from(S₀) = 0
from(Sₖ) = from(Sₖ₋₁) + dₖ₋₁ − tₖ₋₁
total    = Σ dₖ − Σ tₖ
```

Each scene is wrapped in a real `<Sequence from={from(Sₖ)} durationInFrames={dₖ}>`,
so during `[from(Sₖ), from(Sₖ) + tₖ₋₁)` both `Sₖ₋₁` and `Sₖ` are mounted — that
overlap _is_ the transition. Invariants 2 and 3 hold untouched: still one host,
still a pure function of the frame.

**Constraint to enforce with a named error:** `tₖ ≤ min(dₖ, dₖ₊₁)`. A transition
longer than a neighbouring scene would make that scene never appear alone, and
for `tₖ > dₖ` the offsets go backwards. Message shape:

```
<TransitionSeries.Transition> at index 1 has a 45-frame timing, but the
scene before it is only 30 frames. A transition cannot be longer than either
scene it joins.
```

### Children validation

Reuse `Series`'s context+identity check pattern (`Series.tsx:55-59`,
`:96-105`). Rules, each with its own error and its own test:

- only `TransitionSeries.Sequence` / `TransitionSeries.Transition` children
- must not start or end with a `Transition`
- no two consecutive `Transition`s
- every `Sequence` needs a positive whole `durationInFrames` (reuse
  `assertDuration`'s wording from `Series.tsx:20-29` — same tone, same shape)

## Files touched

- **New** `src/framewise-lite/transitions.tsx` + `transitions.test.tsx`
- **New** `src/framewise-lite/presentations.ts` + `presentations.test.ts`
  (keep the pure math out of the JSX file so it tests without jsdom)
- `src/framewise-lite/index.ts` — barrel exports (after `Loop`, line 8, to keep
  the timeline primitives together)
- **New** `src/compositions/WithTransitions.tsx` — one demo exercising all four
  presentations plus one `springTiming`
- `src/render/registry.ts` — new entry
- `scripts/render-lib.test.mjs:288-306` — **pinned id list must be updated in the
  same commit** (`src/render/AGENTS.md`)

## STOP — decisions the executor must not make alone

1. **Do not implement drag-editing, or any transition that needs to know the
   _outgoing_ scene's rendered pixels** (dissolve-by-luminance, morph). Those
   need a second render pass and would break invariant 3.
2. **Do not make transitions ease the audio automatically.** Ducking is a policy
   decision with no obviously right answer; document the manual `volume`
   callback instead (below) and let a later item revisit it.

## Risks

- **Off-by-ones at boundaries** — gaps or double-frames. Property test: for any
  valid random configuration, the union of child windows is exactly contiguous
  over `[0, total)`, each overlap is exactly `tₖ` frames, and `total` matches the
  formula above.
- **Style leakage after the overlap.** Unmount handles most of it
  (`Sequence.tsx:33-36`), but a presentation that sets `filter` or `clip-path` on
  a shared wrapper could persist. Assert the post-transition DOM has no residual
  inline style from the presentation.
- **Audio double-plays across the overlap** (see audit verdict #2). Not a bug —
  a documented consequence. The demo composition should model the fix: give at
  least one scene's `<Audio>` a `volume` callback that fades across the overlap,
  and say in the chapter why it isn't automatic.
- **`layout="none"`** interacts with presentations that need a positioned box.
  Decide and document: presentations assume `absolute-fill`; with
  `layout="none"` the presentation's `style` is applied to a wrapper the
  transition owns.

## Verification

**Unit (jsdom + pure):**

- offsets/total for 0, 1, 2, 5 transitions; property test for contiguity
- every validation error fires with its named message
- progress is monotonic in `[0,1]`, exactly `0` at the first overlap frame and
  exactly `1` at the last (pin the endpoint convention — half-open or closed —
  in the test name, because presentations depend on it)
- `springTiming` overlap equals `ceil(measureSpring(config, fps))`
- a custom user presentation receives the documented `PresentationState`
- render at first / middle / last overlap frame; assert both scenes are mounted
  and the expected opacity/clip-path is on each

**Artifact:**

- render `WithTransitions` to mp4; extract stills at overlap start/mid/end with
  `ffmpeg -ss`; confirm cross-fade states visually
- frame-set sha256 identical at `-c 1` and `-c 4`
- `ffprobe` the output: duration equals `total / fps`, not `Σ dₖ / fps` — the
  overlap arithmetic reaching the encoded file is the thing worth proving

**Does not cover:** the sha256 gate compares PNGs before encode, so it says
nothing about whether the cross-fade survives h264 chroma subsampling. The
still-extraction step is what covers that.

## Docs

- New chapter `docs/code/12-transitions.md` — the offset arithmetic, why a
  presentation must be pure, and the audio-overlap consequence
- Source-map entry in `docs/code/README.md`
- `docs/tutorial.md` — a transition step between the `<Series>` and media steps
  (typecheck the snippets per repo convention)
- `README.md:152` — remove "Transitions" from _Deliberately omitted_; add a
  roadmap row

## Definition of done

- [ ] `TransitionSeries` + 4 presentations + 2 timings exported from the barrel
- [ ] Contiguity property test green; all validation errors named and tested
- [ ] `WithTransitions` demo registered; pinned id list updated same commit
- [ ] Rendered artifact inspected at overlap boundaries; `ffprobe` duration
      matches the overlap-adjusted total
- [ ] Hash identical at `-c 1` vs `-c 4`
- [ ] Chapter 12 + source map + tutorial + README updated
- [ ] `npm run verify` green
