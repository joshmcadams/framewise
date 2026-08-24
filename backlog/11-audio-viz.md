# 11 — Audio visualization (`getAudioData` / `visualizeAudio` / `<Waveform>`)

**Status:** ready — with a determinism hole fixed
**Effort:** M · **Depends on:** nothing
**Unblocks:** audiograms, music visualizers, beat-synced edits

## Audit verdict

Good item — the hard parts really do already exist, and the LRU-bounding
instinct is right. One correction, and it is a serious one:

> "Runs in-browser on both preview and render pages
> (`AudioContext.decodeAudioData`) — same file → same samples → deterministic"

**`new AudioContext().sampleRate` follows the host audio device** (44 100 Hz on
one machine, 48 000 on another, 96 000 on an interface), and `decodeAudioData`
**resamples the file to the context's rate**. So the decoded samples — and
therefore the bins, the bar heights, the pixels, and the sha256 gate — would
differ between machines and even between the same machine with different audio
hardware attached. This would violate invariant 1 in the most confusing possible
way: identical code, identical inputs, different output, no error.

**Fix: decode through `new OfflineAudioContext(1, 1, 48000)`.** An offline
context takes its sample rate as a constructor argument, so it is pinned by us
rather than by the machine, and 48 000 already matches the encode-side
assumption baked into the volume-envelope grid (`render-lib.mjs:196-203`). Mono
downmix (`numberOfChannels: 1`) also removes a stereo/mono variance source and
is what a visualization wants anyway. Make the rate a named exported constant so
it can be cited from the docs, and put "pinned, not device-derived, and why" in
the source comment.

Two smaller notes:

- **Per-worker decode cost is real.** With `-c 4`, four browser pages each fetch
  and decode the whole file. For a 5-minute track that is four × (download +
  decode + a float array of ~57 MB at 48 kHz mono float32). The LRU bounds
  _retention_, not peak. Document the ceiling and pick demo audio that is short.
- **`volume` automation does not apply here** — correctly flagged in the first
  draft, and worth keeping loud.

## Design

```ts
export const VISUALIZATION_SAMPLE_RATE = 48_000;

type AudioData = {
  sampleRate: number;          // always VISUALIZATION_SAMPLE_RATE
  durationSeconds: number;
  channelData: Float32Array;   // mono
};

getAudioData(src: string): Promise<AudioData>

visualizeAudio(opts: {
  audioData: AudioData;
  frame: number;
  fps: number;
  numberOfSamples?: number;    // default 32; must be a power of two
  smoothingWindowSeconds?: number;  // default one frame
}): number[]                   // length numberOfSamples, each 0..1
```

- `getAudioData` fetches as an `ArrayBuffer` and decodes through the offline
  context; gated by `delayRender('audio data: <src>')`, clearing the handle
  before throwing on failure (same rule as items 06 and 10).
- `visualizeAudio` is **pure** — RMS over a window centered on `frame / fps`
  seconds, log-spaced bins, normalized to 0..1. No hidden state, no
  `AnalyserNode` (which is inherently time-based and therefore disqualified).
- Cache decoded buffers module-level, keyed by `src`, bounded by an LRU mirroring
  the spring cache (`spring.ts:129-166` — reuse that pattern, do not invent a
  second one).
- `<Waveform>` — one minimal bar renderer, so the genre is reachable out of the
  box without an author writing SVG.

### Determinism checklist for this item

State it in the chapter, because a reader will reasonably wonder:

| Source of variance   | How it is pinned                                               |
| -------------------- | -------------------------------------------------------------- |
| context sample rate  | `OfflineAudioContext(1, 1, 48000)` — never device rate         |
| channel count        | mono downmix, fixed                                            |
| decoder version      | pinned browser build (item 03) — same caveat as pixels         |
| binning math         | pure function, unit-tested against synthetic input             |
| frame → time mapping | `frame / fps`, integer fps guaranteed by `registry.ts:164-171` |

The decoder-version row is the honest one: audio decoding is not guaranteed
bit-identical across Chrome versions any more than text rasterization is. Item
03's pin is what makes both reproducible.

## Files touched

New `src/framewise-lite/audio-viz.ts` + test, `Waveform.tsx` + test, barrel
exports, demo `WithVisualization` + registry entry + **pinned id list update in
the same commit** (`render-lib.test.mjs:288-306`), a short public-domain audio
file in `public/` (license recorded).

## STOP — decisions the executor must not make alone

1. **Do not use a live `AudioContext` or `AnalyserNode`.** They are time-driven;
   this whole feature must be a function of the frame number.
2. **Do not add an FFT dependency.** RMS bins over log-spaced ranges are enough
   for v1 and keep the zero-dep rule. If a true spectrum is wanted later, that is
   its own proposal with its own justification.
3. **Do not decode on the preview path eagerly for every composition** — decode
   on first use, per composition, like every other async asset here.

## Risks

- **jsdom has no `AudioContext`/`OfflineAudioContext`.** Mock at module level,
  the `probe-media` convention (`src/render/AGENTS.md`). The mocked suite proves
  bookkeeping; the artifact render proves the decode. Be explicit about which
  test proves which — this is the exact place where a mocked suite can create
  false confidence.
- **Memory** — see the per-worker note above; document the ceiling.
- **Handle leaks** on fetch/decode failure — assert an empty pending registry
  after a failed `getAudioData`.
- **Confusion with `volume` automation.** A `volume={f => …}` callback shapes the
  _mix_ (`render-lib.mjs:107-142`); `visualizeAudio` reads the _source file_.
  They will not match, by design. Say so in bold in the chapter.

## Verification

- **Pure math against synthetic `AudioData`:** a 440 Hz sine at full scale
  produces the expected energy distribution; silence produces all-zero bins; a
  step from silence to tone moves the bins at the expected frame
- `numberOfSamples` non-power-of-two → named error
- offline-context rate is `VISUALIZATION_SAMPLE_RATE` regardless of any mocked
  device rate (the regression test for this audit finding — write it even though
  it looks tautological, because it pins the constructor argument)
- **Artifact:** render `WithVisualization`; extract a still at a chosen frame and
  compare bar heights against `visualizeAudio` computed independently in Node
  for the same frame (a small script in the plan, not in the repo)
- hash identical at `-c 1` vs `-c 4` — this is also what proves the four
  independent decodes agree

**Does not cover:** identical bars across two different Chrome builds. That is
the decoder-version row above and is bounded by item 03's pin, not by this item.

## Docs

Chapter 9 gains "Reading audio data" — the offline-context pinning and why,
the determinism table, and the loud note that visualization ignores `volume`.
Tutorial gains an audiogram recipe. Source-map entry.

## Definition of done

- [ ] `getAudioData` decodes through a pinned `OfflineAudioContext`, mono
- [ ] `visualizeAudio` pure and tested against synthetic signals
- [ ] LRU bound reuses the spring-cache pattern
- [ ] no stranded handles on failure (asserted)
- [ ] `WithVisualization` demo registered; pinned id list updated same commit
- [ ] still-vs-Node bar-height comparison recorded in the PR
- [ ] hash identical at `-c 1` vs `-c 4`
- [ ] chapter 9 section incl. determinism table; audio license recorded
