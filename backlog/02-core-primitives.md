# 02 — Core primitives parity (`cancelRender`, `<Freeze>`, preload, `playbackRate`)

**Status:** ready — **but ship as four separate plans**, not one
**Effort:** 02a S · 02b S · 02c S · 02d **M** (was S; see audit verdict)
**Depends on:** 02c wants 06 (`loadFont`) to exist first
**Unblocks:** error UX everywhere; speed-ramping; scrub-smooth previews;
`<Freeze>` is used by two of item 01's presentations and by item 08's filmstrip

## Audit verdict

Three of the four are genuinely small and correct as drafted. The fourth is not:

- **`playbackRate`'s audio math was wrong.** The draft said "audio segments
  shorten (`atrim` end computed in media seconds)". Shortening the trim plays the
  _first fraction_ of the audio at normal speed and then stops early — it does
  not speed anything up. A rate change needs `atempo` in the filter chain, and it
  needs the renderer to _know_ the rate, which means a new field on `AudioReport`
  (`audio-registry.ts:14-22`) and a new split condition in
  `aggregateAudioSegments` (`render-lib.mjs:73-105`, which today splits only on
  frame gaps). Reclassified **S → M** and given its own sub-item below.
- **`<Freeze>`'s "media components mute inside frozen ranges" needs a mechanism,
  not just an assertion.** Overriding the frame context alone is not enough:
  `<Audio>` computes `mediaTime` from the frame it is handed
  (`Audio.tsx:47`) and reports every commit (`:53-55`), so under a naive Freeze
  it reports a _constant_ `mediaTime` across N frames. `aggregateAudioSegments`
  would see one contiguous run and emit `atrim start=<constant>
duration=N/fps` — i.e. the audio plays forward normally while the picture is
  frozen. Freeze therefore needs its own context that media components read.
- `cancelRender` and the preload family are fine as drafted; detail added below.

---

## 02a — `cancelRender(reason)` · Effort S

### Why

Today a bad composition fails via a thrown React error or by starving the
delayRender ladder. There is no canonical "abort this render with a named
reason", which is exactly the named-before-generic philosophy of invariant 5.

### Design

```ts
export class CancelledRenderError extends Error {
  readonly framewiseCancelled = true;
}
export function cancelRender(reason: string | Error): never; // always throws
```

Three consumers, each already has the right seam:

1. **Render page** (`src/render/main-render.tsx:123-142`): `renderFrame` runs
   inside `flushSync`. Wrap it so a `CancelledRenderError` is caught and
   published on `window.framewiseLite` as a **new** field
   `cancelledReason` — _not_ reused `configError`, which means "metadata failed
   at boot" and is checked before the frame loop (`render.mjs:446-452`).
2. **Renderer** (`render.mjs:385-405`): after each frame's `page.evaluate`, read
   `cancelledReason`; if set, fail the chunk with
   `` `cancelRender at frame ${f}: ${reason}` `` — a named error that reaches the
   existing chunk-failure aggregation (`render.mjs:622-628`) and exits non-zero.
3. **Player** (`Player.tsx`): an error boundary around the composition renders
   the reason in place of the frame, instead of a blank stage.

**Ordering contract (invariant 5):** cancelRender must surface _before_ the 30 s
delayRender console.error, because it is synchronous — assert this explicitly in
a test rather than assuming it. State the mechanism in the chapter: it is not
"cancel is faster", it is "cancel is checked on the same CDP round trip that
renders the frame, before any wait begins".

### Verification

- unit: throws, carries the reason, `instanceof` check survives a re-throw
- jsdom: the render page publishes `cancelledReason` and does not publish a
  frame
- **artifact:** a temporary composition that calls `cancelRender('boom')` at
  frame 3 → CLI stderr contains `cancelRender at frame 3: boom`, exit code ≠ 0,
  and **the temp frames dir is removed** (the cleanup path,
  `render.mjs:496-517`, must still run — this is the part that regresses)

---

## 02b — `<Freeze frame={n}>` · Effort S

### Design

```tsx
<Freeze frame={30}>
  <Scene /> {/* sees frame 30 no matter what the outer clock says */}
</Freeze>
```

Two providers, not one:

```tsx
<FrozenProvider value={true}>
  <FrameProvider value={frame}>{children}</FrameProvider>
</FrozenProvider>
```

- `FrameProvider` already exists (`VideoConfig.tsx:30`) — no change to
  `useCurrentFrame` (invariant 1: it still only reads context).
- **New** `FrozenContext` in `VideoConfig.tsx`, read by `<Audio>`, `<Video>`,
  `<OffthreadVideo>`. When frozen, they **skip `reportAudio`** entirely
  (`Audio.tsx:53-55`, `Video.tsx:50-55`, `OffthreadVideo.tsx:57-61`) — matching
  Remotion, and avoiding the constant-`mediaTime` segment described in the audit
  verdict. `<Video>`'s seek still happens (the picture must be right); only the
  audio report is suppressed.
- Preview: a frozen `<Audio>` should also pause its element — `useMediaSync`
  needs the frozen flag, or `<Freeze>` must not be usable around live media in
  preview. Pick one and say which in the chapter.

### Verification

- unit: children see `n` for any outer frame; nesting a `Sequence` inside a
  `Freeze` re-bases from the frozen value; a `Freeze` inside a `Sequence` freezes
  the _shifted_ frame (pin which — this is the question authors will ask)
- unit: no audio report while frozen (assert `readAudioFrame()` is empty)
- **artifact:** a comp with `<Freeze frame={10}>` over frames 0–29 renders 30
  byte-identical PNGs, and its frame-set hash equals a hand-pinned
  `<Sequence>`-free comp that hard-codes frame 10
- **pending handles:** a `delayRender` opened inside a frozen subtree must still
  clear. Test that freezing does not strand a handle (drain the registry in
  `afterEach`, per testing conventions)

---

## 02c — `preloadAudio` / `preloadVideo` / `preloadFont` · Effort S · after 06

### Design

```ts
preloadAudio(src): () => void   // returns an "unpreload" disposer
preloadVideo(src): () => void
preloadFont(font): () => void   // delegates to item 06's loadFont cache
```

- **No-ops on the render path.** The render path is already deterministic —
  `<Img>`/`<Video>` gate on `delayRender`, so a warm cache changes speed, never
  pixels. Detect render mode the one legal way: a null `PlaybackContext`
  (`playback.ts:18`, invariant 2). Do not add a second mode flag.
- Preview: create a detached element with `preload="auto"`, hold it in a
  module-level map, return a disposer that drops the reference.
- Bound the map (LRU, mirroring the spring cache) so a long preview session
  cannot grow without limit.

### Verification

- unit: calling twice returns the same underlying entry; the disposer releases it
- unit: under a null playback context, `preloadAudio` creates no element at all
- **explicitly not covered:** nothing here is provable by a render hash, and that
  is the point. State in the docs that preload is a _preview-only performance
  affordance with zero render semantics_, so nobody later "fixes" it into the
  render path.

---

## 02d — `playbackRate` on `<Audio>` / `<Video>` / `<OffthreadVideo>` · Effort M

### Why it is M, not S

It touches the one part of the system with measured tolerances — the ±0.5 ms
audio-placement harness and the gain-envelope grid described at
`render-lib.mjs:190-215`.

### Design

**Picture.** Media time becomes `mediaTime = (startFrom + localFrame * rate) / fps`.

- `<Video>` (`Video.tsx:43-47`): the half-frame nudge still applies, but scaled —
  the nudge exists to land inside the target _video_ frame, so it stays
  `+ 0.5 / fps` in **media** seconds only when `rate === 1`. At rate `r` one
  composition frame covers `r` media frames; the nudge becomes `+ 0.5 * r / fps`.
  Say this in the code comment, and verify it, don't assume it.
- `<OffthreadVideo>` (`OffthreadVideo.tsx:70-72`): the extract URL carries
  `videoFrame` and `?fps=`. With a rate the requested video frame is
  `round(startFrom + localFrame * r)`, and `?fps=` stays the **composition** fps
  so the server's `frame / fps` seek (`offthread-server.mjs:106-109`) is still
  correct. Alternative — send an effective fps — silently changes the cache key
  (`offthread-server.mjs:44`) and re-extracts everything; prefer computing the
  frame number client-side. **Pin whichever you choose in a test on the URL
  string**, because both look right from the component side.

**Audio.** This is the corrected part.

1. `AudioReport` (`audio-registry.ts:14-22`) gains `playbackRate: number`.
2. `aggregateAudioSegments` (`render-lib.mjs:73-105`) splits a run when the rate
   changes, exactly as it splits on a frame gap. Segments gain `playbackRate`.
   Do **not** split on rate the way volume was _deliberately not_ split
   (`render-lib.mjs:65-72`) — volume is expressible as one in-filter envelope;
   a rate change is not, so splitting is correct here. Document the asymmetry.
3. `planEncode` (`render-lib.mjs:204-215`) builds, for a segment at rate `r`:

   ```
   atrim=start=<trimStart>:duration=<dur * r>,
   asetpts=PTS-STARTPTS,
   atempo=<r>,                       ← chain for r outside [0.5, 100]
   [aresample=48000,asetnsamples=…]  ← only when the volume is automated
   volume=…,
   adelay=<delayMs>:all=1
   ```

   Order is load-bearing: **`atempo` comes before the envelope grid**, so the
   envelope is evaluated on the _composition_ timeline (`t` = output seconds),
   which is what `volumeFilterToken`'s midpoint boundaries assume
   (`render-lib.mjs:107-142`). Putting it after would put the steps in
   source-time and silently mis-time every fade.

4. `atempo` accepts `0.5 ≤ r ≤ 100`; chain factors for anything outside
   (`atempo=0.5,atempo=0.5` for 0.25). Write a pure helper
   `atempoChain(rate) → string[]` and unit-test the edges (0.25, 0.5, 1, 2, 100, 200) — this is exactly the kind of pure logic `render-lib.mjs` exists for.
5. Reject `rate ≤ 0` and non-finite rates with a named error at the component,
   not at ffmpeg.

### Risks

- **`--distributed`**: the audio fallback already forces single-stitch when any
  segments exist (`render.mjs:679-688`) — so rate + distributed + audio takes the
  documented fallback path. Assert it, don't assume it.
- **Non-integer effective frame rates** — the envelope grid assumes
  `48000 / fps` is exact (`render-lib.mjs:196-203`). `atempo` does not change
  the output rate, so that stays true. Verify with a measurement, because this is
  the assumption most likely to be wrong.

### Verification

- pure: `atempoChain` edges; segment splitting on rate change; the full ffmpeg
  argv for a rate-2 automated segment pinned as a golden array
- **artifact, and this is the one that matters:** extend the existing dB /
  placement harness (chapter 9's "How sample-accurate is it?" commands) to a
  rate-2 render — a blip authored at composition second 2.0 must land at 2.0 s
  ±0.5 ms in the output, and the _content_ must be the source's 4.0 s mark
- **artifact (picture):** a rate-2 `<OffthreadVideo>` of the frame-numbered demo
  clip at composition frames 0/15/30 shows source frames 0/30/60
- hash identical at `-c 1` vs `-c 4`

**Does not cover:** a dB measurement confirms an envelope; it cannot see splice
artifacts _inside_ a segment. If you hear clicks at rate boundaries, that is a
separate finding — record it, don't paper over it.

## Docs

Chapter 8 (`cancelRender` + the ordering mechanism), chapter 4 (`<Freeze>`,
next to `Sequence`), chapter 9 (audio: the `atempo` chain, the split-on-rate
asymmetry vs volume), chapter 10 (video: the scaled seek nudge, the extract-URL
decision). Source-map entries for any new module. Tutorial gains a speed-ramp
recipe once 02d lands.

## Definition of done (per sub-item)

- [ ] 02a: named error reaches CLI stderr with exit ≠ 0 and cleanup still runs
- [ ] 02b: frozen render hash equals hand-pinned equivalent; no audio reported
- [ ] 02c: documented as preview-only with zero render semantics
- [ ] 02d: rate-2 dB/placement measurement inside ±0.5 ms, numbers in the PR
- [ ] `npm run verify` green; chapters updated in the same commit
