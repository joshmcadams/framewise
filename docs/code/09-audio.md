# Chapter 9 — Audio (Stage 4)

**Files:** `src/framewise-lite/audio-registry.ts`, `src/framewise-lite/playback.ts`,
`src/framewise-lite/Audio.tsx`, `src/compositions/WithAudio.tsx`, changes to
`scripts/render.mjs`, `src/render/main-render.tsx`, `src/framewise-lite/Player.tsx`

Up to now the renderer has been all video: set a frame, screenshot, repeat.
Audio breaks that model, because **audio is not a property of any single frame** —
it's a continuous signal that spans many frames. You can't screenshot sound. So
audio takes a completely different path: the renderer _collects_ which audio is
playing (and from where, and how loud) at each frame, aggregates that into
timeline segments, and hands them to ffmpeg to mix and mux onto the silent video.

## The core realization

A screenshot captures the visual state _at_ frame `f`. There is no equivalent
for audio — "the sound at frame f" isn't a thing you can capture; sound only
exists over a span. So the rendering strategy splits in two:

- **Video:** rendered _per frame_ (screenshots), as before.
- **Audio:** _collected_ per frame as metadata (`{which file, position, volume}`),
  then reconstructed _as continuous segments_ and mixed by ffmpeg afterward.

Everything in this chapter is plumbing around that split.

## `<Audio>` — placed in time like anything else

```tsx
<Audio src="/bg.wav" volume={0.3} />

<Sequence from={60} durationInFrames={15} layout="none">
  <Audio src="/blip.wav" volume={0.7} />
</Sequence>
```

The key elegance: `<Audio>` is timed by `<Sequence>` exactly like a visual
element. It reads the (re-based) current frame and derives its **mediaTime** —
how many seconds into the file it should be:

```ts
const mediaTime = (frame + startFrom) / fps;
```

Inside `<Sequence from={60}>`, frame 60 on the outer timeline is local frame 0,
so `mediaTime` is 0 there — the blip starts from its beginning, at 2.0s on the
master timeline. No absolute-offset bookkeeping is needed anywhere; the
frame-shifting from [chapter 4](04-sequence.md) does all the work.

`<Audio>` has two completely separate jobs depending on mode.

### Job 1 (render): report for collection

```tsx
const id = useId();
useLayoutEffect(() => {
  reportAudio({id, src, mediaTime, volume});
}); // ← intentionally NO dependency array
```

Each frame, the component reports its state into a per-frame sink. Three
subtleties:

- **`useLayoutEffect`, not `useEffect`** — same reason as `<Img>` (chapter 8):
  the renderer reads the reports right after a synchronous `flushSync`, which
  flushes _layout_ effects but defers passive ones.
- **No dependency array** — the effect runs after _every_ commit. This matters
  because the renderer can render the same frame number twice (the render entry
  renders frame 0 on load, then the loop renders frame 0 again). A `[mediaTime]`
  dependency wouldn't re-fire for the repeated frame 0, and that frame's audio
  would silently vanish. Running every commit is bulletproof.
- **`useId()` as the key** — reports are aggregated by _instance_, not by `src`.
  Two `<Audio src="/same.wav">` (a looped background, or the same SFX in two
  places) must become two segments; keying by `src` would wrongly merge them.

`reportAudio()` is a no-op unless a render is actively collecting (see the sink
below), so in preview this effect does nothing.

### Job 2 (preview): drive a real `<audio>` element

```tsx
const playback = usePlayback(); // null during a render
useLayoutEffect(() => {
  if (!playback) return; // render mode: never touch the element
  const el = ref.current;
  if (!el) return;
  el.volume = clamp(volume);
  if (playback.playing) {
    if (Math.abs(el.currentTime - mediaTime) > 0.3) el.currentTime = mediaTime;
    void el.play().catch(() => {});
  } else {
    el.pause();
    el.currentTime = mediaTime; // scrub to the exact frame
  }
}, [playback, playback?.playing, mediaTime, volume]);
```

This keeps a hidden `<audio>` element roughly in step with the clock. It is
**deliberately best-effort, not sample-accurate** — frame-perfect A/V sync in a
live browser is a tar pit and isn't the lesson. The drift threshold (0.3s) avoids
constant re-seeking stutter. Crucially, when there's no Player (a headless
render), `usePlayback()` returns `null` and this entire effect is skipped, so the
render never plays media — audio in a render comes only from ffmpeg.

## The collection sink (`audio-registry.ts`)

A tiny module-level bucket, armed only during rendering:

```ts
let collecting = false;
let currentFrame = new Map<string, AudioReport>(); // keyed by instance id

export function beginAudioFrame() {
  collecting = true;
  currentFrame = new Map();
}
export function reportAudio(r) {
  if (collecting) currentFrame.set(r.id, r);
}
export function readAudioFrame() {
  return [...currentFrame.values()];
}
```

`beginAudioFrame()` is called by the render entry _before_ each frame's render,
so the `<Audio>` layout effects push into a freshly-cleared bucket. After
`flushSync` returns, `readAudioFrame()` holds exactly the audio active in that
frame. In the Player, `beginAudioFrame()` is never called, so `collecting` stays
`false` and the sink is inert.

The bucket is a **`Map` keyed by instance id, not an array** — and that's
load-bearing. The report effect has no dependency array, so it fires on _every_
commit, but `beginAudioFrame()` only clears inside `renderFrame()`. If a
composition with an `<Audio>` also commits mid-frame for another reason (say a
`delayRender`-gated `flushSync(setState)` resolving between `renderFrame(f)` and
the renderer's read), that `<Audio>` would report frame `f` twice. With an array
that becomes a duplicate, overlapping segment; with a `Map`, the identical report
just overwrites itself (the mediaTime for frame `f` is fixed, so it's genuinely
the same value). It also hardens the duplicate-frame-0 render the no-deps effect
was designed for. (A unit test in `audio-registry.test.ts` pins this down.)

`playback.ts` is the matching idea for preview: the Player provides a
`PlaybackContext`; the render entry does not. The two contexts are the on/off
switches that route `<Audio>` down the right path per mode.

## Render entry + Player wiring

`main-render.tsx` arms collection and exposes it:

```ts
const renderFrame = (frame) => {
  beginAudioFrame();                 // clear the bucket first
  flushSync(() => root.render(…));   // <Audio> effects push into it
};
window.framewiseLite = {…, getAudioFrame: readAudioFrame};
```

`CompositionHost` (called by the Player with `playback` set) wraps the
composition in `<PlaybackProvider>` — the Player passes down `playbackValue`
(memoized on `[playing]` so it only changes on play/pause), enabling Job 2
in preview.

## The renderer: collect → aggregate → mix

In the frame loop, the renderer records each frame's reports:

```js
const reports = await page.evaluate(() => window.framewiseLite.getAudioFrame());
if (reports.length) audioByFrame.push({frame: f, reports});
```

After the loop, `aggregateAudioSegments()` turns those per-frame points into
segments — grouped by instance id, split wherever the active frames have a gap:

```js
// for each id, walk frames in order; a frame that isn't endFrame+1 starts a new run
run = {src, startFrame, endFrame, trimStart: mediaTimeAtFirstFrame, volume};
```

For `WithAudio` this produces exactly:

```
/bg.wav    frames 0–149  @0.00s  trim 0.00s  vol 0.3
/blip.wav  frames 60–74  @2.00s  trim 0.00s  vol 0.7
```

— the blip correctly placed at 2.0s and clipped to its 15-frame window, straight
from the `<Sequence from={60} durationInFrames={15}>`.

### The ffmpeg filter graph

Each segment becomes one input and one filter chain:

```
[k:a] atrim=start={trimStart}:duration={dur},   // take the right slice of the file
      asetpts=PTS-STARTPTS,                       // reset timestamps to 0
      volume={volume},                            // scale it
      adelay={startFrame/fps*1000}:all=1          // place it on the timeline (all channels)
      [sK]
```

then, if there's more than one, mix them:

```
[s0][s1]…amix=inputs=N:normalize=0[aout]
```

Three deliberate choices:

- **`adelay=…:all=1`** delays _all_ channels — without `:all=1`, only channel 1
  is delayed, which silently desyncs stereo files.
- **`normalize=0`** makes amix _sum_ rather than average. Averaging would duck the
  background every time the blip plays (the classic amix "the music gets quieter
  when other sounds happen" bug). Summing keeps levels stable — at the cost that
  you must keep volumes from summing past 1.0 (here 0.3 + 0.7 = 1.0, no clip).
- **One input per segment** (re-listing the same file if reused) avoids needing
  `asplit` to fan a single input into multiple chains.

The whole thing muxes in one pass: `-map 0:v -map [aout] … -c:a aac`. A
composition with no `<Audio>` produces no segments, and the command falls back to
the exact video-only ffmpeg call from Stage 2 — verified unchanged.

## How it was verified

Rendering `WithAudio` and probing the output:

- **Streams** — `ffprobe` shows an `aac` audio stream, 5.0s, alongside the video.
- **Offset + mix** — `volumedetect` on three 0.2s windows:

  | window | content           | mean_volume  |
  | ------ | ----------------- | ------------ |
  | 0.5s   | background only   | −31.5 dB     |
  | 2.1s   | background + blip | **−23.4 dB** |
  | 3.5s   | background only   | −31.5 dB     |

  The 2.1s window is ~8 dB louder (the blip landed at 2.0s and summed with the
  background), and the two background-only windows are _identical_ (the
  background plays continuously with no amix ducking or gap). This supports
  "audio present, correct offset to within the window resolution, sources mixed
  by summing" — it does **not** claim sample-accuracy.

- **Preview** — selecting `WithAudio` and pressing play, the `<audio>` element's
  `currentTime` advanced with the clock and no errors fired; the blip's element
  was correctly absent at frame 0 (its `<Sequence>` hadn't started).

## What's intentionally simplified

- **Constant volume per segment.** Per-frame volume (a `volume={(f) => …}`
  function, for fades) would need ffmpeg volume _automation_ — real, but a big
  step up in complexity, and orthogonal to the core "collect-then-mux" idea.
- **No media-duration `delayRender`.** Real Framewise delays the render until it
  has read each media file's true duration. We compute timing purely from frames,
  so we don't need the file loaded to collect — but we also can't detect "your
  audio is shorter than its placement" (ffmpeg just runs out of samples).
- **Best-effort preview sync**, as above.

Embedded **`<Video>`** (which is _both_ a video frame source to composite _and_ an
audio source to mix, decoded frame-accurately) is the natural next step — and the
last big piece of the hard half.

---

← Back to the [walkthrough index](README.md)
