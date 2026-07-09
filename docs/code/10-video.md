# Chapter 10 — Embedded Video (Stage 5)

**Files:** `src/framewise-lite/Video.tsx`, `src/compositions/WithVideo.tsx`,
`public/clip.mp4`

Embedding a video is the hardest primitive in the project, and it's a good one
to end the "hard half" on because it doesn't introduce a new rendering mechanism
— it **combines the two you already built**. A `<Video>` is simultaneously:

- a **visual source** that must show the _exact right frame_ in every screenshot
  (gated through `delayRender`, Stage 3), and
- an **audio source** whose track must be mixed into the output (reported to the
  audio-registry, Stage 4).

That it needed no new renderer code is the payoff of the earlier stages.

## The hard part, stated plainly

The renderer screenshots each frame. For the embedded video to be correct, its
`<video>` element must be **seeked to this frame's timestamp, and that frame must
be decoded and painted, before the screenshot fires**. HTML `<video>` seeking is
asynchronous and historically imprecise — this is exactly the problem that made
Framewise ship its own Chromium and later build `<OffthreadVideo>`.

## De-risking with a spike (do this before writing the component)

Before building anything, a one-capture spike answered the three unknowns:
load a `<video src="/clip.mp4">` in headless Chrome, seek to ~frame 75, screenshot,
and **read the number off the frame**. Results:

- ✅ **Headless system Chrome paints a _seeked_ video frame** into screenshots —
  no special GPU flags needed. (System Chrome has the proprietary H.264/AAC
  codecs that bare Chromium lacks — that's why this works here.)
- ✅ **Seeking is frame-accurate** with a half-frame nudge (below).
- ❌ **`requestVideoFrameCallback` never fires in headless Chrome.** So the
  "frame is ready" signal can't be rVFC — it has to be the `seeked` event plus
  the renderer's existing paint-wait.

That last finding directly shaped the design. Spiking the riskiest unknown first
turned "will this whole approach even work?" into a 10-minute yes/no before any
component code existed.

## The half-frame nudge

```ts
const mediaTime = (frame + startFrom) / fps; // where in the file this frame is
const seekTarget = mediaTime + 0.5 / fps; // seek to the MIDDLE of the interval
```

Seeking to exactly `N/fps` is ambiguous — it sits on the boundary between frame
`N-1` and `N`, and the decoder may present either. Nudging half a frame forward
lands squarely inside frame `N`. With the demo clip at 30fps starting at comp
frame 0, this makes comp frame 75 show video frame **75** exactly (verified).

## `<Video>`'s three jobs

```tsx
// 1. AUDIO (render): report the file as a segment — ffmpeg extracts its track.
useLayoutEffect(() => {
  if (!muted) reportAudio({id, src, mediaTime, volume});
});

// 2. VISUAL (render): seek + block the capture until `seeked` fires.
useLayoutEffect(() => {
  if (playback) return; // not in render mode
  const el = ref.current;
  if (!el) return;
  if (el.readyState >= 2 && Math.abs(el.currentTime - seekTarget) < 0.5 / fps) return; // guard
  const handle = delayRender(`<Video> seek ${src} @${mediaTime}s`);
  const finish = once(() => continueRender(handle));
  const seekNow = () => {
    el.addEventListener('seeked', finish, {once: true});
    el.currentTime = seekTarget;
  };
  if (el.readyState >= 1) seekNow();
  else el.addEventListener('loadedmetadata', seekNow, {once: true});
  return () => {
    /* remove listeners */ finish();
  };
});

// 3. VISUAL (preview): best-effort sync of the visible element to the clock.
useLayoutEffect(() => {
  if (!playback) return; /* seek/play/pause like <Audio> */
}, [playback, playback?.playing, mediaTime, volume]);
```

The render-visual effect is the crux:

- **`delayRender` per frame** — each frame registers a handle cleared on `seeked`.
  The renderer's Stage 3 loop ("wait until no handles are pending, then capture")
  blocks until the video frame is decoded. No renderer changes; the video just
  participates in the wait that images already used.
- **No dependency array** — like the audio report and `<Img>`, it runs every
  commit, so a re-rendered same frame is handled.
- **The same-time guard** — if the element is already parked on this frame's time
  (the duplicate frame-0 render, where the page-load render already seeked there),
  setting `currentTime` to the same value would fire no `seeked` and the handle
  would hang until timeout. The guard returns early in that case.
- **`readyState` gating** — if metadata isn't loaded yet, wait for
  `loadedmetadata` before seeking.

Job 1 reuses the exact `reportAudio` path from [chapter 9](09-audio.md): the
segment's `src` is the video file, and the renderer's ffmpeg step extracts
`[k:a]` from the mp4 like any other audio input. So the video's **audio is muxed
with zero new code** — `WithVideo` produced `▶ audio: 1 segment(s) · /clip.mp4`.

Mode is decided by `usePlayback()` (chapter 9): `null` ⇒ render (seek + block),
non-null ⇒ preview. Critically, **preview never calls `delayRender`** — doing so
would pin the Player's pending badge and jank playback.

## How it was verified

Rendering `WithVideo` (clip full-frame, a React banner overlaid):

- **Frame-accuracy** — extracting comp frames 30, 75, and 120 from the output, the
  embedded video read **"30", "75", "120"** respectively, each matching its
  overlay's "comp frame N". Three points rule out a constant offset; the React
  banner sitting on top proves true compositing, not just playback.
- **Audio** — `ffprobe` shows an `aac` track (5.0s) muxed from the clip;
  `volumedetect` reads −21 dB mean (non-silent — the clip's tone came through).
- **Preview** — selecting `WithVideo` and scrubbing the timeline to frame 90 moved
  the `<video>` element's `currentTime` to 3.0s (90 / 30 fps), with no errors.

## The honest alternative: `<OffthreadVideo>`

This `<Video>` works, and the spike proved it's frame-accurate here. But relying
on a live `<video>` element's seeking is fragile in general — it depends on the
browser's compositor painting the seeked frame, which broke historically and is
why Framewise built **`<OffthreadVideo>`**: instead of seeking an element, it
asks ffmpeg to **extract the exact frame as an image** and renders _that_ through
the same `<Img>` + `delayRender` path from Stage 3. That's more robust (no
compositor dependency, frame-accurate by construction) and reuses Stages 3+4
even more directly. Had the spike come back black, that was the planned pivot —
worth knowing as the production-grade approach.

## Intentionally simplified

- **Constant per-segment volume** and **best-effort preview sync**, same as
  [chapter 9](09-audio.md).
- **A silent clip would break the audio path** — `[k:a]` has nothing to map.
  Pass `muted` for a video with no audio track (it also skips the report).
- **No `<OffthreadVideo>`-style ffmpeg extraction** — we use the live element,
  which the spike validated for this environment.

## What's left

The last item on the roadmap is **parallel chunked rendering** — splitting the
frame range across worker processes / browser tabs and concatenating, which is
what makes real renders fast. That's a renderer-architecture change rather than a
new primitive. With `<Video>` done, every _content_ primitive (visuals, timing,
async assets, audio, video) is in place.

---

← Back to the [walkthrough index](README.md)
